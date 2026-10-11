// Projects and their runs. A project is a directory (a git repo) under the data dir; its run is one Director. Every
// event is appended to .studio/events.jsonl with a sequence number, so the panel can reconnect and replay from where
// it left off, and a page reload shows the whole conversation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createProject, linkProject } from '@frametell/engine/tools/project.mjs';
import { createCatalog, RELAY_BASE_URL } from '@frametell/models';
import { elevenLabsTts, volcengineTts } from '@frametell/voice';
import { Director, piRuntime, type AgentRuntime, type StudioEvent, type Storyboard, type UserRef } from '@frametell/agent';
import { PROJECTS_DIR, loadConfig } from './config.js';
import { prepareMaterials } from './materials.js';
import { applyProxy } from './net.js';
import { withRefs } from './refs.js';
import type { LoggedEvent, ProjectMeta, ProjectSummary, RunStatus } from './types.js';
import { tr } from './i18n.js';

export type Logged = LoggedEvent;

const dirOf = (id: string) => path.join(PROJECTS_DIR, id);
const lockFile = (id: string) => path.join(dirOf(id), '.studio', 'run.lock');
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
/** the pid of another live process running this project (the CLI server and the desktop app can share a data dir) */
function heldElsewhere(id: string): number | undefined {
  try { const pid = +fs.readFileSync(lockFile(id), 'utf8'); return pid && pid !== process.pid && alive(pid) ? pid : undefined; } catch { return undefined; }
}
const metaFile = (id: string) => path.join(dirOf(id), '.studio', 'project.json');

export function listProjects(): ProjectSummary[] {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs.readdirSync(PROJECTS_DIR)
    .filter((id) => fs.existsSync(metaFile(id)))
    .map((id) => ({ ...readMeta(id), ...runner(id).summary() }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function readMeta(id: string): ProjectMeta { return JSON.parse(fs.readFileSync(metaFile(id), 'utf8')); }
function writeMeta(m: ProjectMeta) { m.updatedAt = new Date().toISOString(); fs.writeFileSync(metaFile(m.id), JSON.stringify(m, null, 2)); }

export function newProject(input: Omit<ProjectMeta, 'id' | 'createdAt' | 'updatedAt' | 'materials'>, files: { name: string; data: Buffer }[]): ProjectMeta {
  const id = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(6).toString('hex')}`;
  const dir = dirOf(id);
  createProject(dir, { title: input.title, style: input.style });
  fs.mkdirSync(path.join(dir, 'materials'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
  const materials: string[] = [];
  for (const f of files) {
    const name = path.basename(f.name).replace(/[\\/:*?"<>|]/g, '_');
    fs.writeFileSync(path.join(dir, 'materials', name), f.data);
    materials.push(name);
  }
  const now = new Date().toISOString();
  const meta: ProjectMeta = { ...input, id, createdAt: now, updatedAt: now, materials };
  fs.writeFileSync(metaFile(id), JSON.stringify(meta, null, 2));
  return meta;
}

async function buildRuntime(meta: ProjectMeta): Promise<{ runtime: AgentRuntime; prices: { input: number; output: number; cacheRead: number; cacheWrite: number; currency: 'CNY' | 'USD' } }> {
  const cfg = loadConfig();
  applyProxy(cfg.proxy);
  // the user's own base URL per provider and the model ids they typed in are applied by the catalog
  const catalog = await createCatalog({ keys: Object.entries(cfg.keys).map(([providerId, apiKey]) => ({ providerId, apiKey })), custom: cfg.custom, baseUrls: cfg.baseUrls, models: cfg.models });
  const [provider, ...rest] = meta.model.split('/');
  const id = rest.join('/');
  const model = catalog.get(provider, id);
  if (!model) throw new Error(tr(`模型 ${meta.model} 不可用：检查设置里的 key`, `Model ${meta.model} is not available: check its key in Settings`));
  const info = catalog.info(model);
  const prices = { ...info.cost, currency: info.currency };
  // Every project runs on Pi, which works with any provider. The Claude Agent SDK and Codex runtimes are parked: their
  // code stays in packages/agent (claudeRuntime, codexRuntime) but Studio does not offer them — two more agent loops to
  // keep in step was not worth it yet. To bring one back, branch on meta.runtime here, e.g.:
  //   if (meta.runtime === 'claude-agent-sdk') return { runtime: claudeRuntime({ apiKey, baseUrl, model: id }), prices };
  //   if (meta.runtime === 'codex') return { runtime: codexRuntime({ apiKey, baseUrl, model: id }), prices };
  return { runtime: piRuntime(catalog.models, model), prices };
}

class Runner {
  private subs = new Set<(e: Logged) => void>();
  private seq = 0;
  private abort?: AbortController;
  private gate?: (feedback: string | undefined) => void;
  /** an approval that arrived before the run reached the gate (e.g. right after a server restart) */
  private pending?: { feedback?: string };
  /** notes the user left while nothing was running; handed to the director when the run continues */
  private parked: string[] = [];
  private director?: Director;
  /** an export is running; change requests that arrive meanwhile wait for it */
  private exporting = false;
  private afterExport: string[] = [];
  status: RunStatus = 'idle';
  private log: string;

  constructor(readonly id: string) {
    this.log = path.join(dirOf(id), '.studio', 'events.jsonl');
    if (fs.existsSync(this.log)) {
      const lines = fs.readFileSync(this.log, 'utf8').trim().split('\n').filter(Boolean);
      this.seq = lines.length;
      const last = lines.length ? (JSON.parse(lines[lines.length - 1]) as Logged) : undefined;
      this.status = last?.type === 'approval' ? 'awaiting_approval' : this.stateStage() === 'done' ? 'done' : lines.length ? 'stopped' : 'idle';
      // an export cut short by the app closing: the film is still there to preview, the export can simply run again
      // (the last export began and never ended: any render line may come after its start)
      const renders = lines.map((l) => JSON.parse(l) as Logged).filter((e) => e.type === 'stage' && e.stage === 'render');
      const cut = renders.at(-1)?.type === 'stage' && (renders.at(-1) as Extract<Logged, { type: 'stage' }>).status === 'start';
      if (this.status === 'done' && cut && !heldElsewhere(this.id)) {
        this.emit({ type: 'stage', stage: 'render', status: 'failed', detail: tr('导出被打断了，可以重新导出', 'The export was interrupted. You can export again.') });
      }
      // a run that was in progress when its process went away (app closed, crash): say so in the log, so every client
      // shows it as paused with a way to continue, instead of a stage that never ends
      if (this.status === 'stopped' && last && last.type !== 'paused' && !heldElsewhere(this.id)) {
        this.emit({ type: 'paused', reason: 'interrupted', stage: this.stateStage() });
      }
    }
  }

  private stateStage(): string | undefined {
    try { return JSON.parse(fs.readFileSync(path.join(dirOf(this.id), '.studio', 'state.json'), 'utf8')).stage; } catch { return undefined; }
  }

  summary() {
    const st = path.join(dirOf(this.id), '.studio', 'state.json');
    const s = fs.existsSync(st) ? JSON.parse(fs.readFileSync(st, 'utf8')) : {};
    const status: RunStatus = this.status !== 'running' && heldElsewhere(this.id) ? 'running' : this.status;
    return { status, stage: s.stage as string | undefined, video: s.video ? path.relative(dirOf(this.id), s.video) : undefined, stale: s.video ? s.exported === false : undefined };
  }

  private emit = (e: StudioEvent) => {
    // live progress of a response being written goes to whoever is watching, not into the log: it is only "now"
    if (e.type === 'agent' && e.event.type === 'progress') {
      const live = { ...e, seq: this.seq + ++this.tick / 1e4, at: Date.now() } as Logged;
      for (const fn of this.subs) fn(live);
      return;
    }
    this.tick = 0;
    const logged = { ...e, seq: ++this.seq, at: Date.now() } as Logged;
    fs.appendFileSync(this.log, JSON.stringify(logged) + '\n');
    for (const fn of this.subs) fn(logged);
  };
  private tick = 0;

  /** events after `since` (replayed from disk), then live ones */
  subscribe(fn: (e: Logged) => void, since = 0) {
    let last = since;
    const replay = () => {
      if (!fs.existsSync(this.log)) return;
      for (const l of fs.readFileSync(this.log, 'utf8').split('\n')) {
        if (!l) continue;
        const e = JSON.parse(l) as Logged;
        if (e.seq > last) { last = e.seq; fn(e); }
      }
    };
    replay();
    const live = (e: Logged) => { if (e.seq > last) { last = e.seq; fn(e); } };
    this.subs.add(live);
    // a run in another process (the CLI server or another window) appends to the same log: follow the file
    const follow = () => { if (this.status !== 'running' && heldElsewhere(this.id)) replay(); };
    fs.watchFile(this.log, { interval: 700 }, follow);
    return () => { this.subs.delete(live); fs.unwatchFile(this.log, follow); };
  }

  /** start or continue the run; it pauses at storyboard approval */
  start() {
    return this.launch((d) => d.run(async () => {
      if (this.pending) { const p = this.pending; this.pending = undefined; return p.feedback; }
      this.status = 'awaiting_approval';
      return new Promise<string | undefined>((resolve) => { this.gate = resolve; });
    }));
  }

  /** a change to a finished film, in the user's words */
  revise(request: string) { return this.launch((d) => d.revise(request)); }

  /** render the finished film to mp4 (only on request: the live preview is the film until then) */
  export(): boolean {
    if (this.status === 'running' || this.stateStage() !== 'done') return false;
    void this.launch((d) => d.render(), { exporting: true });
    return true;
  }

  /** build the director and run `task` with it: one run at a time, across processes; the outcome is always logged */
  private async launch(task: (d: Director) => Promise<unknown>, o: { exporting?: boolean } = {}) {
    if (this.status === 'running') return;
    const other = heldElsewhere(this.id);
    if (other) { this.emit({ type: 'error', message: tr(`这个项目正在另一个画说窗口里制作（进程 ${other}），请在那里继续`, `This project is being made in another Frametell window (process ${other}). Continue there.`) }); return; }
    fs.writeFileSync(lockFile(this.id), String(process.pid));
    const release = () => { try { if (+fs.readFileSync(lockFile(this.id), 'utf8') === process.pid) fs.rmSync(lockFile(this.id)); } catch {} };
    const meta = readMeta(this.id);
    const cfg = loadConfig();
    const dir = dirOf(this.id);
    linkProject(dir);
    this.abort = new AbortController();
    this.status = 'running';
    let director: Director;
    try {
      // PDF/Word/PPT/EPUB → Markdown the director can read (skipped when already done); a file that cannot be read is
      // reported but does not stop the run
      const { files } = await prepareMaterials(path.join(dir, 'materials'));
      for (const f of files) if (f.kind === 'document' && !f.parsedTo) this.emit({ type: 'error', message: tr(`资料 ${f.name} 读不了：${f.warning}`, `Couldn't read ${f.name}: ${f.warning}`) });
      const { runtime, prices } = await buildRuntime(meta);
      const ttsKey = meta.voice?.provider === 'elevenlabs' ? cfg.tts.elevenlabs : cfg.tts.volcengine;
      const tts = meta.voice && ttsKey ? (meta.voice.provider === 'elevenlabs' ? elevenLabsTts(ttsKey) : volcengineTts(ttsKey)) : undefined;
      const voice = meta.voice && tts ? { speaker: meta.voice.id, rate: 0, instruction: '像跟朋友分享一个实用的发现，语气轻松、真诚、自然，有轻重缓急' } : undefined;
      director = new Director({
        dir, runtime, style: meta.style, prices, tts, voice, concurrency: cfg.defaults.concurrency,
        brief: { durationSec: meta.durationSec, topic: meta.topic, notes: meta.notes },
        emit: this.emit, signal: this.abort.signal,
      });
    } catch (e) {
      this.status = 'failed';
      release();
      this.emit({ type: 'error', message: (e as Error).message });
      this.emit({ type: 'paused', reason: 'error', message: (e as Error).message });
      return;
    }
    this.director = director;
    this.exporting = !!o.exporting;
    for (const n of this.parked.splice(0)) director.message(n);
    const next = () => { const w = this.afterExport.splice(0); if (w.length) void this.revise(w.join('\n')); };
    task(director).finally(() => { release(); this.director = undefined; this.exporting = false; })
      .then(() => { this.status = 'done'; writeMeta(readMeta(this.id)); if (o.exporting) next(); })
      .catch((e: Error) => {
        const stage = this.stateStage();
        // a failed or cancelled export leaves a finished film: say what happened to the export, nothing is paused
        if (o.exporting) {
          const aborted = e.name === 'AbortError' || !!this.abort?.signal.aborted;
          this.status = 'done';
          if (!aborted) this.emit({ type: 'error', message: e.message });
          this.emit({ type: 'stage', stage: 'render', status: 'failed', detail: aborted ? tr('已取消导出', 'Export canceled') : tr(`导出失败：${e.message}`, `Export failed: ${e.message}`) });
          next();
          return;
        }
        if (e.name === 'AbortError' || this.abort?.signal.aborted) { this.status = 'stopped'; this.emit({ type: 'paused', reason: 'user', stage }); }
        else { this.status = 'failed'; this.emit({ type: 'error', message: e.message }); this.emit({ type: 'paused', reason: 'error', stage, message: e.message }); }
      });
  }

  /** the user confirmed the storyboard (optionally with change requests) */
  approve(feedback?: string) {
    if (this.gate) { const g = this.gate; this.gate = undefined; this.status = 'running'; g(feedback?.trim() || undefined); return true; }
    if (this.status === 'awaiting_approval' || this.status === 'stopped') { this.pending = { feedback: feedback?.trim() || undefined }; void this.start(); return true; }
    return false;
  }

  stop() { this.abort?.abort(); }

  /**
   * The user said something. At the storyboard it is the change request; while the director works it is a note the
   * next step picks up; after the film it starts a revision; while paused it is kept for when the run continues.
   */
  say(said: string, refs: UserRef[] = []): boolean {
    said = said.trim();
    if (!said && !refs.length) return false;
    this.emit({ type: 'user', text: said, ...(refs.length ? { refs } : {}) });
    const text = withRefs(said, refs);   // what the director reads: the references, then the words
    if (this.gate || this.status === 'awaiting_approval') return this.approve(text);
    if (this.status === 'running' && this.exporting) {
      this.afterExport.push(text);
      this.emit({ type: 'note', text: tr('记下了，导出完就接着改', 'Noted. I’ll make the change once the export finishes.') });
      return true;
    }
    if (this.status === 'running' && this.director) {
      this.director.message(text);
      this.emit({ type: 'note', text: tr('收到，接下来的步骤会照这个来', 'Got it. The next steps will follow this.') });
      return true;
    }
    if (this.status === 'done' || this.stateStage() === 'done') { void this.revise(text); return true; }
    this.parked.push(text);
    this.emit({ type: 'note', text: tr('记下了，继续制作时会照这个来', 'Noted. I’ll follow this when work resumes.') });
    return true;
  }
}

const runners = new Map<string, Runner>();
export function runner(id: string): Runner {
  if (!fs.existsSync(metaFile(id))) throw new Error(tr('项目不存在', 'Project not found'));
  let r = runners.get(id);
  if (!r) { r = new Runner(id); runners.set(id, r); }
  return r;
}
export const projectDir = dirOf;
