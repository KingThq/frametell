// Projects and their runs. A project is a directory (a git repo) under the data dir; its run is one Director. Every
// event is appended to .studio/events.jsonl with a sequence number, so the panel can reconnect and replay from where
// it left off, and a page reload shows the whole conversation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createProject, linkProject } from '@frametell/engine/tools/project.mjs';
import { createCatalog, RELAY_BASE_URL } from '@frametell/models';
import { elevenLabsTts, volcengineTts } from '@frametell/voice';
import { Director, piRuntime, claudeRuntime, codexRuntime, type AgentRuntime, type StudioEvent, type Storyboard } from '@frametell/agent';
import { PROJECTS_DIR, loadConfig, type RuntimeId, type VoiceChoice } from './config.js';

export interface ProjectMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  style: string;
  durationSec: number;
  model: string;
  runtime: RuntimeId;
  voice?: VoiceChoice;
  subtitles: boolean;
  topic?: string;
  notes?: string;
  materials: string[];
}
export type RunStatus = 'idle' | 'running' | 'awaiting_approval' | 'done' | 'failed' | 'stopped';
export type Logged = StudioEvent & { seq: number; at: number };

const dirOf = (id: string) => path.join(PROJECTS_DIR, id);
const metaFile = (id: string) => path.join(dirOf(id), '.studio', 'project.json');

export function listProjects(): (ProjectMeta & { status: RunStatus; stage?: string; video?: string })[] {
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
  const catalog = await createCatalog({ keys: Object.entries(cfg.keys).map(([providerId, apiKey]) => ({ providerId, apiKey })), custom: cfg.custom });
  const [provider, ...rest] = meta.model.split('/');
  const id = rest.join('/');
  const model = catalog.get(provider, id);
  if (!model) throw new Error(`模型 ${meta.model} 不可用：检查设置里的 key`);
  const info = catalog.info(model);
  const prices = { ...info.cost, currency: info.currency };
  if (meta.runtime === 'claude-agent-sdk') {
    const key = provider === 'relay' ? cfg.keys.relay : cfg.keys.anthropic;
    return { runtime: claudeRuntime({ apiKey: key || '', baseUrl: provider === 'relay' ? RELAY_BASE_URL : undefined, model: id }), prices };
  }
  if (meta.runtime === 'codex') {
    const key = provider === 'relay' ? cfg.keys.relay : cfg.keys.openai;
    return { runtime: codexRuntime({ apiKey: key || '', baseUrl: provider === 'relay' ? RELAY_BASE_URL + '/v1' : undefined, model: id }), prices };
  }
  return { runtime: piRuntime(catalog.models, model), prices };
}

class Runner {
  private subs = new Set<(e: Logged) => void>();
  private seq = 0;
  private abort?: AbortController;
  private gate?: (feedback: string | undefined) => void;
  /** an approval that arrived before the run reached the gate (e.g. right after a server restart) */
  private pending?: { feedback?: string };
  status: RunStatus = 'idle';
  private log: string;

  constructor(readonly id: string) {
    this.log = path.join(dirOf(id), '.studio', 'events.jsonl');
    if (fs.existsSync(this.log)) {
      const lines = fs.readFileSync(this.log, 'utf8').trim().split('\n').filter(Boolean);
      this.seq = lines.length;
      const last = lines.length ? (JSON.parse(lines[lines.length - 1]) as Logged) : undefined;
      // a run in progress when the server stopped is shown as stopped; the user can continue it
      this.status = last?.type === 'done' ? 'done' : last?.type === 'approval' ? 'awaiting_approval' : lines.length ? 'stopped' : 'idle';
    }
  }

  summary() {
    const st = path.join(dirOf(this.id), '.studio', 'state.json');
    const s = fs.existsSync(st) ? JSON.parse(fs.readFileSync(st, 'utf8')) : {};
    return { status: this.status, stage: s.stage as string | undefined, video: s.video ? path.relative(dirOf(this.id), s.video) : undefined };
  }

  private emit = (e: StudioEvent) => {
    const logged = { ...e, seq: ++this.seq, at: Date.now() } as Logged;
    fs.appendFileSync(this.log, JSON.stringify(logged) + '\n');
    for (const fn of this.subs) fn(logged);
  };

  /** events after `since` (replayed from disk), then live ones */
  subscribe(fn: (e: Logged) => void, since = 0) {
    if (fs.existsSync(this.log)) {
      for (const l of fs.readFileSync(this.log, 'utf8').split('\n')) {
        if (!l) continue;
        const e = JSON.parse(l) as Logged;
        if (e.seq > since) fn(e);
      }
    }
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }

  /** start or continue the run; it pauses at storyboard approval */
  async start() {
    if (this.status === 'running') return;
    const meta = readMeta(this.id);
    const cfg = loadConfig();
    const dir = dirOf(this.id);
    linkProject(dir);
    this.abort = new AbortController();
    this.status = 'running';
    let director: Director;
    try {
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
      this.emit({ type: 'error', message: (e as Error).message });
      return;
    }
    director.run(async (sb: Storyboard) => {
      void sb;
      if (this.pending) { const p = this.pending; this.pending = undefined; return p.feedback; }
      this.status = 'awaiting_approval';
      return new Promise<string | undefined>((resolve) => { this.gate = resolve; });
    }).then(() => { this.status = 'done'; writeMeta(readMeta(this.id)); })
      .catch((e: Error) => {
        if (e.name === 'AbortError' || this.abort?.signal.aborted) { this.status = 'stopped'; this.emit({ type: 'error', message: '已停止，可以继续制作' }); }
        else { this.status = 'failed'; this.emit({ type: 'error', message: e.message }); }
      });
  }

  /** the user confirmed the storyboard (optionally with change requests) */
  approve(feedback?: string) {
    if (this.gate) { const g = this.gate; this.gate = undefined; this.status = 'running'; g(feedback?.trim() || undefined); return true; }
    if (this.status === 'awaiting_approval' || this.status === 'stopped') { this.pending = { feedback: feedback?.trim() || undefined }; void this.start(); return true; }
    return false;
  }

  stop() { this.abort?.abort(); }
}

const runners = new Map<string, Runner>();
export function runner(id: string): Runner {
  if (!fs.existsSync(metaFile(id))) throw new Error('项目不存在');
  let r = runners.get(id);
  if (!r) { r = new Runner(id); runners.set(id, r); }
  return r;
}
export const projectDir = dirOf;
