// The director: runs a project through its stages. The model writes; the orchestrator checks. Storyboard lint, page
// lint and contact sheets are produced here and handed to the agent, so the quality bar doesn't depend on the model
// remembering to look. Every change is committed; state is persisted so an interrupted run resumes where it stopped.
import fs from 'node:fs';
import path from 'node:path';
import { narrate, type TtsProvider } from '@frametell/voice';
import { Project, type LintIssue, type PageTiming, type Storyboard } from './project.js';
import { checkPrompt, pagePrompt, pageSystem, plannerSystem, reviewPrompt, scriptPrompt, storyboardFixPrompt, storyboardPrompt, type Brief } from './prompts.js';
import { addUsage, emptyUsage, type AgentRuntime, type AgentSession, type TokenUsage, type TurnResult } from './runtime/types.js';
import type { PageStatus, Stage, StudioEvent } from './events.js';

export interface Prices { input: number; output: number; cacheRead: number; cacheWrite: number; currency: 'CNY' | 'USD' }

export interface DirectorOptions {
  dir: string;
  runtime: AgentRuntime;
  style: string;
  brief: Brief;
  tts?: TtsProvider;
  voice?: { speaker: string; rate?: number; instruction?: string };
  /** model price per million tokens, for the running cost */
  prices?: Prices;
  /** page sessions running at once */
  concurrency?: number;
  emit?: (e: StudioEvent) => void;
  signal?: AbortSignal;
}

interface PageState { status: PageStatus; rounds: number; issues: string[]; ref?: string }
interface State {
  stage: Stage | 'approval' | 'done';
  planner?: string;
  pages: Record<string, PageState>;
  usage: TokenUsage;
  video?: string;
}

/** components every page of a style can use, registered before the page sessions start */
const STYLE_EXTRAS: Record<string, string[]> = { 'warm-story': ['engine/lib/warm.js'] };

const MAX = { storyboardFix: 2, planTurns: 30, pageTurns: 40, pageRounds: 3, reviewRounds: 2 };

export class Director {
  readonly project: Project;
  private state: State;
  private commits: Promise<unknown> = Promise.resolve();

  constructor(private o: DirectorOptions) {
    this.project = new Project(o.dir);
    const f = this.project.file('.studio/state.json');
    this.state = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { stage: 'storyboard', pages: {}, usage: emptyUsage() };
  }

  get stage() { return this.state.stage; }
  get usage() { return this.state.usage; }

  private emit(e: StudioEvent) { this.o.emit?.(e); }
  private save() {
    fs.mkdirSync(this.project.file('.studio'), { recursive: true });
    fs.writeFileSync(this.project.file('.studio/state.json'), JSON.stringify(this.state, null, 2));
  }
  /** commits are serialized: page sessions run in parallel but share one git index */
  private commit(message: string) {
    this.commits = this.commits.then(() => { const id = this.project.commit(message); if (id) this.emit({ type: 'commit', id, message }); });
    return this.commits;
  }
  cost(u: TokenUsage = this.state.usage) {
    const p = this.o.prices;
    if (!p) return { amount: 0, currency: 'USD' as const };
    return { amount: (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6, currency: p.currency };
  }
  private track(r: TurnResult) {
    this.state.usage = addUsage(this.state.usage, r.usage);
    this.save();
    this.emit({ type: 'cost', usage: this.state.usage, ...this.cost() });
  }
  private async session(name: string, system: string, maxTurns: number, resume?: string): Promise<AgentSession> {
    return this.o.runtime.open({ name, system, cwd: this.o.dir, maxTurns, signal: this.o.signal, onEvent: (event) => this.emit({ type: 'agent', session: name, event }) }, resume);
  }
  private async send(s: AgentSession, text: string, images?: string[]) {
    const r = await s.send({ text, images });
    this.track(r);
    if (r.stopReason === 'aborted') throw new DOMException('aborted', 'AbortError');
    return r;
  }
  private fail(stage: Stage, message: string): never {
    this.emit({ type: 'stage', stage, status: 'failed', detail: message });
    this.emit({ type: 'error', stage, message });
    throw new Error(message);
  }

  // ── ① storyboard ──────────────────────────────────────────────────────────────────────────────
  async storyboard(): Promise<Storyboard> {
    this.emit({ type: 'stage', stage: 'storyboard', status: 'start' });
    if (!fs.existsSync(this.project.file('.git'))) this.project.initHistory();
    const materials = fs.existsSync(this.project.file('materials')) ? fs.readdirSync(this.project.file('materials')) : [];
    const s = await this.session('planner', plannerSystem(this.o.style), MAX.planTurns, this.state.planner);
    let r = await this.send(s, storyboardPrompt(this.o.brief, this.o.style, materials));
    this.state.planner = s.ref; this.save();
    if (!this.project.exists('storyboard.json')) this.fail('storyboard', `没有写出 storyboard.json：${r.error || r.text}`);
    for (let round = 1; ; round++) {
      const issues = this.project.storyboardIssues();
      this.emit({ type: 'storyboard_check', round, issues });
      const reds = issues.filter((i) => i.level === 'red');
      if (!reds.length || round > MAX.storyboardFix) break;
      r = await this.send(s, storyboardFixPrompt(issues));
    }
    await this.commit('分镜');
    await s.close();
    const sb = this.project.storyboard();
    this.state.stage = 'approval'; this.save();
    this.emit({ type: 'stage', stage: 'storyboard', status: 'done' });
    this.emit({ type: 'approval', storyboard: sb });
    return sb;
  }

  // ── ② narration script ───────────────────────────────────────────────────────────────────────
  async script(feedback?: string) {
    this.emit({ type: 'stage', stage: 'script', status: 'start' });
    this.state.stage = 'script'; this.save();
    // the server owns these META fields; the planner writes title and pages
    this.setMeta({ style: this.o.style, voice: this.o.voice, gap: 0.8, pace: { maxHold: 1.0, gap: 0.8 }, extras: STYLE_EXTRAS[this.o.style] ?? [] });
    const s = await this.session('planner', plannerSystem(this.o.style), MAX.planTurns, this.state.planner);
    const r = await this.send(s, scriptPrompt(feedback));
    this.state.planner = s.ref; this.save();
    const check = this.project.scriptCheck();
    if (check.code) this.fail('script', `口播脚本有错：${check.err || check.out} ${r.error ?? ''}`);
    await this.commit('口播');
    await s.close();
    this.state.stage = 'narrate'; this.save();
    this.emit({ type: 'stage', stage: 'script', status: 'done', detail: check.out.split('\n').pop() });
  }

  /** Server-owned META fields, rewritten in place in script.js (the planner must not change them). */
  private setMeta(fields: Record<string, unknown>) {
    const f = this.project.file('script.js');
    let src = fs.readFileSync(f, 'utf8');
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      const json = JSON.stringify(v);
      const re = new RegExp(`(\\n\\s*)${k}:\\s*(\\{[^\\n]*\\}|\\[[^\\n]*\\]|'[^'\\n]*'|"[^"\\n]*"|[\\d.]+)\\s*,`);
      src = re.test(src) ? src.replace(re, `$1${k}: ${json},`) : src.replace(/const META = \{/, `const META = {\n    ${k}: ${json},`);
    }
    fs.writeFileSync(f, src);
  }

  // ── ③ narration ──────────────────────────────────────────────────────────────────────────────
  async narrate() {
    this.emit({ type: 'stage', stage: 'narrate', status: 'start' });
    this.state.stage = 'narrate'; this.save();
    if (!this.o.tts || !this.o.voice) {
      this.state.stage = 'pages'; this.save();
      this.emit({ type: 'stage', stage: 'narrate', status: 'skipped', detail: '没有配置配音，用估算时长' });
      return;
    }
    const r = await narrate(this.o.dir, { tts: this.o.tts, voice: this.o.voice, signal: this.o.signal, onProgress: (e) => this.emit({ type: 'narrate', ...e }) });
    await this.commit('配音');
    this.state.stage = 'pages'; this.save();
    this.emit({ type: 'stage', stage: 'narrate', status: 'done', detail: `${r.duration.toFixed(1)}s${r.warnings.length ? '；' + r.warnings.join('；') : ''}` });
  }

  // ── ④ pages ──────────────────────────────────────────────────────────────────────────────────
  async pages(only?: string[]) {
    this.emit({ type: 'stage', stage: 'pages', status: 'start' });
    this.state.stage = 'pages'; this.save();
    const sb = this.project.storyboard();
    const tl = this.project.timeline();
    const todo = tl.pages.filter((p) => (!only || only.includes(p.id)) && !['ok', 'flagged'].includes(this.state.pages[p.id]?.status ?? ''));
    for (const p of todo) this.setPage(p.id, { status: 'queued', rounds: 0, issues: [] });
    const queue = [...todo];
    const worker = async () => { for (let p = queue.shift(); p; p = queue.shift()) await this.page(sb, p); };
    await Promise.all(Array.from({ length: Math.min(this.o.concurrency ?? 3, todo.length) }, worker));
    const bad = Object.entries(this.state.pages).filter(([, s]) => s.status === 'failed').map(([id]) => id);
    this.emit({ type: 'stage', stage: 'pages', status: bad.length ? 'failed' : 'done', detail: bad.length ? `失败：${bad.join('、')}` : undefined });
    if (bad.length) throw new Error(`这些页没有画出来：${bad.join('、')}`);
    this.state.stage = 'review'; this.save();
  }

  private setPage(id: string, s: PageState, extra: { sheet?: string; note?: string } = {}) {
    this.state.pages[id] = s; this.save();
    this.emit({ type: 'page', id, status: s.status, round: s.rounds, issues: s.issues, ...extra });
  }

  /** moments worth looking at: right after the page turns, each beat in progress, and the settled end */
  private sheetTimes(sb: Storyboard, t: PageTiming) {
    const beats = sb.pages.find((p) => p.id === t.id)?.beats || [];
    const cueAt = (at: string) => { const m = /^c(\d+)/.exec(at); const c = t.cues[Math.min(+(m?.[1] ?? 0), t.cues.length - 1)]; return c ? t.start + c.at : t.start; };
    const raw = [t.start + 0.6, ...beats.map((b) => cueAt(b.at) + 1.0), t.end - 0.35].map((x) => Math.min(t.end - 0.2, Math.max(t.start + 0.4, x))).sort((a, b) => a - b);
    const out: number[] = [];
    for (const x of raw) if (!out.length || x - out[out.length - 1] > 0.6) out.push(x);
    while (out.length > 6) out.splice(Math.floor(out.length / 2), 1);
    return out.map((abs) => ({ t: abs, local: abs - t.start }));
  }

  private async page(sb: Storyboard, t: PageTiming) {
    const id = t.id;
    const st: PageState = { status: 'drawing', rounds: 0, issues: [] };
    this.setPage(id, st);
    try {
      const s = await this.session(`page-${id}`, pageSystem(this.o.style), MAX.pageTurns);
      let r = await this.send(s, pagePrompt(sb, id, t));
      if (!this.project.exists(`pages/${id}.js`)) r = await this.send(s, `还没有 pages/${id}.js，请写出来再停下。`);
      if (!this.project.exists(`pages/${id}.js`)) throw new Error(r.error || '没有写出页面文件');
      st.ref = s.ref;
      await this.commit(`${id}：初稿`);
      let issues: LintIssue[] = [];
      for (let round = 1; round <= MAX.pageRounds; round++) {
        st.status = 'checking'; st.rounds = round; this.setPage(id, st);
        issues = this.project.lint([id]);
        const times = this.sheetTimes(sb, t);
        const sheet = this.project.snap(`${id}-r${round}`, times.map((x) => x.t), [id]);
        this.setPage(id, { ...st, issues: issues.map((i) => i.msg) }, { sheet });
        r = await this.send(s, checkPrompt(round, issues, times), [sheet]);
        await this.commit(`${id}：第 ${round} 轮修改`);
        const reply = r.text.trim();
        if (/^FLAGGED/i.test(reply)) { st.status = 'flagged'; st.issues = [reply.replace(/^FLAGGED:?\s*/i, '')]; break; }
        if (/^DONE\b/i.test(reply) && !issues.length) { st.status = 'ok'; st.issues = []; break; }
        if (r.stopReason === 'max_turns') break;
      }
      if (st.status !== 'ok' && st.status !== 'flagged') {
        issues = this.project.lint([id]);
        st.status = issues.length ? 'flagged' : 'ok';
        st.issues = issues.map((i) => `${i.local}s：${i.msg}`);
      }
      await s.close();
      this.setPage(id, st);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      this.setPage(id, { ...st, status: 'failed', issues: [(e as Error).message] });
    }
  }

  // ── ⑤ review ─────────────────────────────────────────────────────────────────────────────────
  async review() {
    this.emit({ type: 'stage', stage: 'review', status: 'start' });
    this.state.stage = 'review'; this.save();
    const issues = this.project.lint(undefined, ['--determinism']);
    const flagged = Object.entries(this.state.pages).filter(([, s]) => s.status === 'flagged').map(([id, s]) => `${id}（${s.issues.join('，')}）`);
    if (!issues.length && !flagged.length) {
      this.state.stage = 'render'; this.save();
      this.emit({ type: 'stage', stage: 'review', status: 'skipped', detail: '全片 lint 通过，各页自检通过' });
      return;
    }
    const tl = this.project.timeline();
    const sheet = this.project.snap('review', tl.pages.flatMap((p) => [(p.start + p.end) / 2, p.end - 0.35]), undefined, 400);
    const s = await this.session('review', pageSystem(this.o.style), MAX.pageTurns);
    for (let round = 1; round <= MAX.reviewRounds; round++) {
      const r = await this.send(s, reviewPrompt(round === 1 ? issues : this.project.lint(), flagged), [sheet]);
      await this.commit(`全片检查：第 ${round} 轮`);
      if (/^DONE\b/i.test(r.text.trim())) break;
    }
    await s.close();
    this.state.stage = 'render'; this.save();
    this.emit({ type: 'stage', stage: 'review', status: 'done' });
  }

  // ── ⑥ render ─────────────────────────────────────────────────────────────────────────────────
  async render(o: { workers?: number } = {}) {
    this.emit({ type: 'stage', stage: 'render', status: 'start' });
    this.state.stage = 'render'; this.save();
    const out = await this.project.render({ workers: o.workers, signal: this.o.signal, onLine: (line) => { if (!line.startsWith('[chunk')) this.emit({ type: 'render', line }); } });
    const g = this.project.gate(out.withSubs);
    this.emit({ type: 'gate', red: g.red, blank: g.gates.find((x) => x.key === 'blank')?.value ?? [], report: g.report.map((r) => ({ name: r.name, value: r.value, unit: r.unit })) });
    this.state.stage = 'done'; this.state.video = out.withSubs; this.save();
    this.emit({ type: 'stage', stage: 'render', status: 'done' });
    this.emit({ type: 'done', video: out.withSubs, videoNoSubs: out.noSubs, duration: g.duration });
    return out;
  }

  /** Whole run. `approve` is called with the storyboard and resolves with optional feedback (the user's edits). */
  async run(approve: (sb: Storyboard) => Promise<string | undefined> = async () => undefined) {
    if (this.state.stage === 'storyboard') await this.storyboard();
    if (this.state.stage === 'approval') await this.script(await approve(this.project.storyboard()));
    if (this.state.stage === 'script') await this.script();
    if (this.state.stage === 'narrate') await this.narrate();
    if (this.state.stage === 'pages') await this.pages();
    if (this.state.stage === 'review') await this.review();
    if (this.state.stage === 'render') return this.render();
    return { withSubs: this.state.video!, noSubs: this.state.video!.replace('有字幕', '无字幕') };
  }
}

export const projectFile = (dir: string, rel: string) => path.join(dir, rel);
