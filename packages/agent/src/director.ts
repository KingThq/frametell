// The director: runs a project through its stages. The model writes; the orchestrator checks. Storyboard lint, page
// lint and contact sheets are produced here and handed to the agent, so the quality bar doesn't depend on the model
// remembering to look. Every change is committed; state is persisted so an interrupted run resumes where it stopped.
import fs from 'node:fs';
import path from 'node:path';
import { narrate, type TtsProvider } from '@frametell/voice';
import { Project, type LintIssue, type PageTiming, type Storyboard, type Renderer } from './project.js';
import { checkPrompt, langNote, pagePrompt, pageSystem, plannerSystem, replyNote, reviewPrompt, scriptPrompt, storyboardFixPrompt, storyboardPrompt, type Brief } from './prompts.js';
import { addUsage, emptyUsage, type AgentRuntime, type AgentSession, type Thinking, type TokenUsage, type TurnResult } from './runtime/types.js';
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
  /** where exports are drawn; this process when absent */
  renderer?: Renderer;
}

interface PageState { status: PageStatus; rounds: number; issues: string[]; ref?: string }
interface State {
  stage: Stage | 'approval' | 'done';
  planner?: string;
  pages: Record<string, PageState>;
  usage: TokenUsage;
  video?: string;
  /** the mp4 shows the film as it is now (false once a revision changes a page, until the next export) */
  exported?: boolean;
  /** what the user told the director while it worked; each session picks up the notes it hasn't seen yet */
  notes?: string[];
  cursors?: Record<string, number>;
  /** per-page instructions of the revision in progress */
  revision?: Record<string, string>;
  /** the change to the finished film being made, until it is done: "Continue" after a failure picks it up again */
  change?: string;
}

/** components every page of a style can use, registered before the page sessions start */
const STYLE_EXTRAS: Record<string, string[]> = { 'warm-story': ['engine/lib/warm.js'] };

/** the part of a crash that says what broke: the error and the page's own lines, not Node's internals */
export function crashText(raw: string, id: string): string {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const err = lines.find((l) => /(Error|error):/.test(l) && !/^node:internal/.test(l))?.replace(/^page\.evaluate:\s*/, '') ?? lines[0] ?? raw;
  const at = lines.filter((l) => l.includes(`pages/${id}.js`) || /engine\/(runtime|lib)\//.test(l)).map((l) => l.replace(/^.*?((pages|engine)\/[^\s)]+).*$/, '$1')).slice(0, 4);
  return [err.replace(/ at file:\/\/\S+/, ''), ...at.map((a) => `  at ${a}`)].join('\n').slice(0, 800);
}

const crashPrompt = (id: string, crash: string) => `pages/${id}.js throws when it runs, so it cannot be checked with screenshots yet:
${crash}
Fix this error first: it is most likely a call to a function that does not exist, or wrong arguments. Go by this film's components and worked example, never guess the engine's API. Fix it with edit, all edits in one reply, each with finish: true: the round ends once they apply, no reply needed.`;

/**
 * A page that already works, changed: the current code is handed over, and the change is made with targeted edits.
 * Rewriting a 300-line page to change one thing is minutes of output (seen: 10k tokens, 3 minutes, for a title).
 */
const revisionNote = (id: string, fix: string, code: string) => `

This page is a **revision**: the film is finished and the user asked for a change to this page. The change: ${fix}
Here is the current pages/${id}.js; it is already given, so don't read it again:
\`\`\`js
${code}
\`\`\`
Change only what needs changing, with edit; **never rewrite the whole file with write**. **Put all the edits in one reply** (one reply can call edit several times), each with finish: true: you're done once they apply, no reply needed and no need to read the file again; the check screenshots will show the result.`;

// A page is drafted at the model's full thinking level; its check rounds (look at the contact sheet, fix what is off) are
// small edits and run at medium, which on a gateway's …-high model means its …-medium sibling: most of a check round's
// time was the model thinking before a short answer.
const CHECK_THINKING: Thinking = 'medium';
const MAX = { pagesAtOnce: 10, storyboardFix: 2, planTurns: 30, pageTurns: 40, pageRounds: 3, revisionRounds: 2, reviewRounds: 2 };

export class Director {
  readonly project: Project;
  private state: State;
  private commits: Promise<unknown> = Promise.resolve();

  constructor(private o: DirectorOptions) {
    this.project = new Project(o.dir, o.renderer);
    const f = this.project.file('.studio/state.json');
    this.state = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { stage: 'storyboard', pages: {}, usage: emptyUsage() };
  }

  get stage() { return this.state.stage; }

  /** a note from the user mid-run: sessions read it the next time they are spoken to */
  message(text: string) {
    (this.state.notes ??= []).push(text.trim());
    this.save();
  }
  /** the notes a session hasn't seen yet, as a block to append to its next message */
  private unseen(key: string): string {
    const all = this.state.notes ?? [], cur = (this.state.cursors ??= {})[key] ?? 0;
    if (cur >= all.length) return '';
    this.state.cursors[key] = all.length; this.save();
    return `\n\nThe user just added (follow it if it concerns this page, otherwise ignore it):\n${all.slice(cur).map((n) => `- ${n}`).join('\n')}`;
  }
  get usage() { return this.state.usage; }
  /** what the user reads (notes, failures, the film's history), in the user's language */
  private say(zh: string, en: string) { return this.o.brief.replyLang === 'en' ? en : zh; }

  private emit(e: StudioEvent) { this.o.emit?.(e); }
  private save() {
    fs.mkdirSync(this.project.file('.studio'), { recursive: true });
    fs.writeFileSync(this.project.file('.studio/state.json'), JSON.stringify(this.state, null, 2));
  }
  /** commits are serialized: page sessions run in parallel but share one git index */
  private commit(message: string) {
    this.commits = this.commits.then(async () => { const id = await this.project.commit(message); if (id) this.emit({ type: 'commit', id, message }); });
    return this.commits;
  }
  cost(u: TokenUsage = this.state.usage) {
    const p = this.o.prices;
    if (!p) return { amount: 0, currency: 'USD' as const };
    return { amount: (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6, currency: p.currency };
  }
  /** usage is counted per model turn as it happens, so the running cost is live even inside a long exchange */
  private countTurn(u: TokenUsage) {
    this.state.usage = addUsage(this.state.usage, u);
    this.save();
    this.emit({ type: 'cost', usage: this.state.usage, ...this.cost() });
  }
  private async session(name: string, system: string, maxTurns: number, resume?: string): Promise<AgentSession> {
    return this.o.runtime.open({ name, system, cwd: this.o.dir, maxTurns, signal: this.o.signal, onEvent: (event) => {
      this.emit({ type: 'agent', session: name, event });
      if (event.type === 'turn') { this.countTurn(event.usage); if (name.startsWith('page-')) this.firstTurn?.(); }
    } }, resume);
  }
  private async send(s: AgentSession, text: string, images?: string[], thinking?: Thinking) {
    const r = await s.send({ text, images, thinking });
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
    // only what the agent can read: md/txt/images. PDF/Word/PPT/EPUB are parsed beforehand into x.md (or x.pdf.md)
    const all = fs.existsSync(this.project.file('materials')) ? fs.readdirSync(this.project.file('materials')).filter((f) => !f.startsWith('.')) : [];
    const materials = all.filter((f) => /\.(md|markdown|txt|png|jpe?g|webp|gif)$/i.test(f));
    const s = await this.session('planner', plannerSystem(this.o.style), MAX.planTurns, this.state.planner);
    let r = await this.send(s, storyboardPrompt(this.o.brief, this.o.style, materials));
    this.state.planner = s.ref; this.save();
    // a turn can end without the file (seen: a gateway answering a one-token "." mid-turn); ask once more, as for pages
    if (!this.project.exists('storyboard.json') && r.stopReason !== 'max_turns') r = await this.send(s, 'storyboard.json does not exist yet; write it, then stop and report. ' + replyNote(this.o.brief.replyLang, this.o.brief.lang));
    if (!this.project.exists('storyboard.json')) this.fail('storyboard', this.say(`没有写出分镜：${r.error || r.text}`, `No storyboard was written: ${r.error || r.text}`));
    // the film's language is the server's to say (the page agents and the checks read it from here)
    try {
      const j = this.project.storyboard();
      if (j.lang !== (this.o.brief.lang ?? 'zh')) fs.writeFileSync(this.project.file('storyboard.json'), JSON.stringify({ ...j, lang: this.o.brief.lang ?? 'zh' }, null, 2));
    } catch {}
    for (let round = 1; ; round++) {
      const issues = this.project.storyboardIssues();
      this.emit({ type: 'storyboard_check', round, issues });
      const reds = issues.filter((i) => i.level === 'red');
      if (!reds.length || round > MAX.storyboardFix) break;
      r = await this.send(s, storyboardFixPrompt(issues, this.o.brief));
    }
    await this.commit(this.say('分镜', 'Storyboard'));
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
    this.serverMeta();
    const s = await this.session('planner', plannerSystem(this.o.style), MAX.planTurns, this.state.planner);
    const r = await this.send(s, scriptPrompt(feedback, this.o.brief) + this.unseen('planner'));
    this.state.planner = s.ref; this.save();
    // the planner rewrites script.js: put the server-owned fields back (a lost META.voice once rendered a silent film)
    this.serverMeta();
    const check = await this.project.scriptCheck();
    if (check.code) this.fail('script', this.say(`口播脚本有错：`, `The narration script has an error: `) + `${check.err || check.out} ${r.error ?? ''}`);
    await this.commit(this.say('口播', 'Narration'));
    await s.close();
    this.state.stage = 'narrate'; this.save();
    this.emit({ type: 'stage', stage: 'script', status: 'done', detail: check.out.split('\n').pop() });
  }

  /** Style, voice, pacing and the style's components: owned by the server, re-applied after every agent edit. */
  private serverMeta() {
    const extras = new Set<string>(STYLE_EXTRAS[this.o.style] ?? []);
    try {   // keep components the page agents registered (use-extra.mjs appends to META.extras)
      const m = /extras:\s*(\[[^\]\n]*\])/.exec(fs.readFileSync(this.project.file('script.js'), 'utf8'));
      if (m) for (const e of JSON.parse(m[1].replace(/'/g, '"'))) extras.add(e);
    } catch {}
    // a style component copied into extras/ by use-extra is the same file: load it once, from the engine
    const base = new Set((STYLE_EXTRAS[this.o.style] ?? []).map((e) => path.basename(e)));
    const list = [...extras].filter((e) => !(e.startsWith('extras/') && base.has(path.basename(e))));
    this.setMeta({ style: this.o.style, lang: this.o.brief.lang ?? 'zh', voice: this.o.voice, gap: 0.8, pace: { maxHold: 1.0, gap: 0.8 }, extras: list });
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
      this.emit({ type: 'stage', stage: 'narrate', status: 'skipped', detail: this.say('没有配置配音，用估算时长', 'No voice set up; using estimated timing') });
      return;
    }
    this.serverMeta();
    const r = await narrate(this.o.dir, { tts: this.o.tts, voice: this.o.voice, signal: this.o.signal, onProgress: (e) => this.emit({ type: 'narrate', ...e }) });
    await this.commit(this.say('配音', 'Voice'));
    this.state.stage = 'pages'; this.save();
    this.emit({ type: 'stage', stage: 'narrate', status: 'done', detail: `${r.duration.toFixed(1)}s${r.warnings.length ? '；' + r.warnings.join('；') : ''}` });
  }

  // ── ④ pages ──────────────────────────────────────────────────────────────────────────────────
  async pages(only?: string[]) {
    this.emit({ type: 'stage', stage: 'pages', status: 'start' });
    this.state.stage = 'pages'; this.save();
    const sb = this.project.storyboard();
    const tl = await this.project.timeline();
    const todo = tl.pages.filter((p) => (!only || only.includes(p.id)) && !['ok', 'flagged'].includes(this.state.pages[p.id]?.status ?? ''));
    for (const p of todo) this.setPage(p.id, { status: 'queued', rounds: 0, issues: [] });
    const queue = [...todo];
    const worker = async () => { for (let p = queue.shift(); p; p = queue.shift()) await this.page(sb, p); };
    // Up to 10 pages at once. Every page session opens with the same long system prompt (the style's component pack).
    // Claude bills writing that prompt to its cache: there the first page goes alone until its first answer is back, so
    // the others find it cached instead of each paying to write it. Providers whose caching costs nothing to fill
    // (Gemini, OpenAI) start every page at once.
    const n = Math.min(this.o.concurrency ?? MAX.pagesAtOnce, MAX.pagesAtOnce, todo.length);
    const m = this.o.runtime.model;
    const paysToCache = m.provider === 'anthropic' || /claude/i.test(m.id);
    const warm = new Promise<void>((ok) => { this.firstTurn = ok; setTimeout(ok, 90_000); });
    const first = worker();
    if (n > 1 && paysToCache) await Promise.race([warm, first]);   // a first page that fails early does not hold the rest back
    await Promise.all([first, ...Array.from({ length: n - 1 }, worker)]);
    this.firstTurn = undefined;
    const bad = Object.entries(this.state.pages).filter(([, s]) => s.status === 'failed').map(([id]) => id);
    this.emit({ type: 'stage', stage: 'pages', status: bad.length ? 'failed' : 'done', detail: bad.length ? this.say(`失败：${bad.join('、')}`, `Failed: ${bad.join(', ')}`) : undefined });
    if (bad.length) throw new Error(this.say(`这些页没有画出来：${bad.join('、')}`, `These pages were not drawn: ${bad.join(', ')}`));
    this.state.stage = 'review'; this.save();
  }

  private setPage(id: string, s: PageState, extra: { sheet?: string; thumb?: string; note?: string } = {}) {
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
      const s = await this.session(`page-${id}`, pageSystem(this.o.style, STYLE_EXTRAS[this.o.style] ?? []), MAX.pageTurns);
      const fix = this.state.revision?.[id];
      let r = await this.send(s, pagePrompt(sb, id, t, this.o.brief.lang, this.o.brief.replyLang) + (fix ? revisionNote(id, fix, this.project.read(`pages/${id}.js`)) : '') + this.unseen(`page-${id}`));
      if (!this.project.exists(`pages/${id}.js`)) r = await this.send(s, `pages/${id}.js does not exist yet; write it, then stop.`);
      if (!this.project.exists(`pages/${id}.js`)) throw new Error(r.error || this.say('没有写出页面文件', 'No page file was written'));
      st.ref = s.ref;
      await this.commit(this.say(`${id}：初稿`, `${id}: first draft`));
      let issues: LintIssue[] = [];
      const rounds = fix ? MAX.revisionRounds : MAX.pageRounds;   // a revision starts from a checked page
      for (let round = 1; round <= rounds + 1; round++) {
        st.status = 'checking'; st.rounds = round; this.setPage(id, st);
        // a page whose code throws cannot be checked; that is the first thing to fix, so it goes back to its agent
        // (one more round than usual is allowed for it) instead of failing the page
        let crash: string | undefined;
        try { issues = await this.project.lint([id]); } catch (e) { crash = crashText((e as Error).message, id); }
        if (crash) {
          if (round > rounds) throw new Error(crash);
          this.setPage(id, { ...st, issues: [crash] });
          r = await this.send(s, crashPrompt(id, crash) + this.unseen(`page-${id}`), undefined, CHECK_THINKING);
          await this.commit(this.say(`${id}：修运行错误`, `${id}: fix a runtime error`));
          continue;
        }
        if (round > rounds) break;
        const times = this.sheetTimes(sb, t);
        const sheet = await this.project.snap(`${id}-r${round}`, times.map((x) => x.t), [id]);
        this.setPage(id, { ...st, issues: issues.map((i) => i.msg) }, { sheet });
        r = await this.send(s, checkPrompt(round, issues, times) + this.unseen(`page-${id}`), [sheet], CHECK_THINKING);
        await this.commit(this.say(`${id}：第 ${round} 轮修改`, `${id}: check round ${round}`));
        const reply = r.text.trim();
        if (/^FLAGGED/i.test(reply)) { st.status = 'flagged'; st.issues = [reply.replace(/^FLAGGED:?\s*/i, '')]; break; }
        if (/^DONE\b/i.test(reply) && !issues.length) { st.status = 'ok'; st.issues = []; break; }
        if (r.stopReason === 'max_turns') break;
      }
      if (st.status !== 'ok' && st.status !== 'flagged') {
        try { issues = await this.project.lint([id]); } catch (e) { throw new Error(crashText((e as Error).message, id)); }
        // still throwing, or calling what the engine does not have: the page is not drawn, whatever else it shows
        const broken = issues.filter((i) => /^(runtime error|unknown API|wrong API use)/.test(i.msg));
        if (broken.length) throw new Error(broken.map((i) => i.msg).join('\n'));
        st.status = issues.length ? 'flagged' : 'ok';
        st.issues = issues.map((i) => `${i.local}s：${i.msg}`);
      }
      await s.close();
      // one settled frame as the film-strip thumbnail (the check sheets are 4-up and read as noise at tile size)
      let thumb: string | undefined;
      try { thumb = await this.project.snap(`${id}-thumb`, [Math.max(t.start + 0.5, t.end - 0.4)], [id], 480); } catch {}
      this.setPage(id, st, { thumb });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      this.setPage(id, { ...st, status: 'failed', issues: [(e as Error).message] });
    }
  }

  // ── ⑤ review ─────────────────────────────────────────────────────────────────────────────────
  async review() {
    this.emit({ type: 'stage', stage: 'review', status: 'start' });
    this.state.stage = 'review'; this.save();
    const issues = await this.project.lint(undefined, ['--determinism']);
    const flagged = Object.entries(this.state.pages).filter(([, s]) => s.status === 'flagged').map(([id, s]) => `${id}（${s.issues.join('，')}）`);
    if (!issues.length && !flagged.length) {
      this.emit({ type: 'stage', stage: 'review', status: 'skipped', detail: this.say('全片检查通过，各页自检通过', 'The whole film passed its checks, and every page passed its own') });
      return this.ready();
    }
    const tl = await this.project.timeline();
    const sheet = await this.project.snap('review', tl.pages.flatMap((p) => [(p.start + p.end) / 2, p.end - 0.35]), undefined, 400);
    const s = await this.session('review', pageSystem(this.o.style, STYLE_EXTRAS[this.o.style] ?? []), MAX.pageTurns);
    for (let round = 1; round <= MAX.reviewRounds; round++) {
      const r = await this.send(s, reviewPrompt(round === 1 ? issues : await this.project.lint(), flagged, this.o.brief.replyLang), [sheet]);
      await this.commit(this.say(`全片检查：第 ${round} 轮`, `Whole-film check: round ${round}`));
      if (/^DONE\b/i.test(r.text.trim())) break;
    }
    await s.close();
    this.emit({ type: 'stage', stage: 'review', status: 'done' });
    return this.ready();
  }

  /** drawn and checked: the live preview is the film. Rendering an mp4 waits for an export */
  private async ready() {
    this.beforeReady?.(); this.beforeReady = undefined;
    this.state.stage = 'done'; this.save();
    this.emit({ type: 'ready', duration: (await this.project.timeline()).duration });
  }

  // ── ⑥ render (export) ────────────────────────────────────────────────────────────────────────
  /** the film as mp4, on export. The stage is left as it was: exporting is not a step of making the film */
  async render(o: { workers?: number } = {}) {
    this.emit({ type: 'stage', stage: 'render', status: 'start' });
    this.serverMeta();
    // a narrated film must carry its narration: check before spending minutes on frames
    if (this.o.voice && !/\bvoice:\s*\{/.test(this.project.read('script.js'))) this.fail('render', this.say('口播脚本里丢了配音设置，已停止渲染', 'The narration script lost its voice settings; rendering stopped'));
    const out = await this.project.render({ workers: o.workers, signal: this.o.signal, onLine: (line) => { if (!/^\[(chunk|seg)-/.test(line)) this.emit({ type: 'render', line }); } });
    const g = this.project.gate(out.withSubs);
    this.emit({ type: 'gate', red: g.red, blank: g.gates.find((x) => x.key === 'blank')?.value ?? [], report: g.report.map((r) => ({ name: r.name, value: r.value, unit: r.unit })) });
    this.state.video = out.withSubs; this.state.exported = true; this.save();
    this.emit({ type: 'stage', stage: 'render', status: 'done' });
    this.emit({ type: 'done', video: out.withSubs, videoNoSubs: out.noSubs, duration: g.duration });
    return out;
  }

  /**
   * A change to a finished film: the planner decides which pages it touches and how, those pages are redrawn from their
   * current code, then the film is checked again and plays in the preview. Everything else is kept as it is; the mp4
   * waits for the next export.
   */
  async revise(request: string) {
    const t0 = Date.now();
    this.state.change = request; this.save();
    const sb = this.project.storyboard();
    const named = sb.pages.filter((p, i) => new RegExp(`\\b${p.id}\\b|第\\s*${i + 1}\\s*页|\\bpage\\s*${i + 1}\\b`, 'i').test(request)).map((p) => p.id);
    // a change to the picture of the page(s) it names needs no planning: it goes straight to those pages' agents.
    // Anything that may touch the words (narration, subtitles, timing), or names no page, is planned first
    // (not 讲 or 说: 「讲 ABC 的那部分」 points at a picture, and sent a centering fix through a minute of planning)
    // the user's own words, in either language
    const words = /口播|文案|台词|配音|字幕|旁白|这句|句子|念|时长|节奏|\b(narrat\w*|script|voice\w*|subtitles?|captions?|wording|sentences?|timing|pac(e|ing))\b/i;
    const direct = named.length > 0 && named.length <= 2 && !words.test(request.replace(/<references>[\s\S]*?<\/references>/, ''));
    let plan: { pages: { id: string; note: string }[] } | undefined = direct ? { pages: named.map((id) => ({ id, note: request })) } : undefined;
    if (!plan) {
      this.emit({ type: 'note', text: this.say('收到，我先看看要改哪几页', 'Got it. Let me see which pages this touches') });
      await this.planRevision(request, sb, named);
      try { plan = JSON.parse(this.project.read('.studio/revision.json')); } catch { this.fail('pages', this.say('导演没有写出修改计划', 'The director did not write a plan for the change')); }
    }
    const tPlan = Date.now();
    const ids = plan!.pages.map((p) => p.id).filter((id) => sb.pages.some((p) => p.id === id));
    if (!ids.length) this.fail('pages', this.say('修改计划里没有可以改的页', 'The plan for the change names no page to change'));
    const nums = ids.map((id) => sb.pages.findIndex((p) => p.id === id) + 1);
    const which = this.say(nums.map((n) => `第 ${n} 页`).join('、'), (nums.length > 1 ? 'pages ' : 'page ') + nums.join(', '));
    this.emit({ type: 'note', text: direct ? this.say(`直接改${which}的画面，其余的保持不变`, `Changing the picture on ${which}; everything else stays as it is`) : this.say(`要重画${which}，其余的保持不变`, `Redrawing ${which}; everything else stays as it is`) });
    this.serverMeta();
    if (this.o.tts && this.o.voice) await narrate(this.o.dir, { tts: this.o.tts, voice: this.o.voice, signal: this.o.signal });   // cached pages cost nothing
    this.state.revision = Object.fromEntries(plan!.pages.map((p) => [p.id, p.note]));
    this.state.exported = false;
    for (const id of ids) this.state.pages[id] = { status: 'queued', rounds: 0, issues: [] };
    this.state.stage = 'pages'; this.save();
    const tDraw = Date.now();
    await this.pages(ids);
    this.state.revision = undefined; this.save();
    const tPages = Date.now();
    // where the time went, in one line, so a slow step is seen (and can be fixed) instead of only felt
    const sec = (ms: number) => this.say(`${Math.max(1, Math.round(ms / 1000))} 秒`, `${Math.max(1, Math.round(ms / 1000))} s`);
    this.beforeReady = () => this.emit({ type: 'note', text: this.say(
      `这次改了 ${sec(Date.now() - t0)}：${direct ? '' : `想怎么改 ${sec(tPlan - t0)} · `}${tDraw - tPlan > 1500 ? `配音 ${sec(tDraw - tPlan)} · ` : ''}画和自检 ${sec(tPages - tDraw)} · 全片检查 ${sec(Date.now() - tPages)}`,
      `This change took ${sec(Date.now() - t0)}: ${direct ? '' : `planning ${sec(tPlan - t0)} · `}${tDraw - tPlan > 1500 ? `voice ${sec(tDraw - tPlan)} · ` : ''}drawing and checks ${sec(tPages - tDraw)} · whole-film check ${sec(Date.now() - tPages)}`) });
    await this.review();
    this.state.change = undefined; this.save();
  }
  /** said just before the film is ready again (a revision's time line) */
  private beforeReady?: () => void;
  /** resolves the wait for the first page's first answer (the shared prompt is cached by then) */
  private firstTurn?: () => void;

  /** the planner's half of a revision: which pages, and what to change on each (written to .studio/revision.json) */
  private async planRevision(request: string, sb: Storyboard, named: string[]) {
    // a fresh, small session per change: resuming the planner would carry the whole making of the film (slow, and every
    // token of it re-read); the files hold everything this decision needs
    const s = await this.session('reviser', plannerSystem(this.o.style), MAX.planTurns);
    fs.rmSync(this.project.file('.studio/revision.json'), { force: true });   // last change's plan is not this one's
    // hand over what the decision needs up front (the script, and the code of the pages the request names) — reading
    // them file by file costs a model round trip each
    const code = named.map((id) => `pages/${id}.js:\n\`\`\`js\n${this.project.read(`pages/${id}.js`)}\n\`\`\``).join('\n\n');
    await this.send(s, `The film is finished. The user's change to it:
${request}

Decide which pages to change and how: change only the pages that need it (usually 1–2). Touch script.js only when the user asks to change the narration; then change the matching cues and keep their number the same.
${langNote('revise', this.o.brief.lang, this.o.brief.replyLang).trim()}
Write the decision to .studio/revision.json: { "pages": [{ "id": "p03", "note": "the change for the page agent, down to objects and actions" }] }, then tell the user in one sentence what you will change.
The storyboard and script.js${named.length ? ' and the code of the pages mentioned' : ''} are given below; don't read them again. Read pages/<id>.js for other pages only if you need to.
You decide only which pages change and what they should become; the page agent writes the code. Don't look into the engine, take screenshots or run tools. When the user points at a page (a page in <references>), that is usually the page to change.

Storyboard: ${sb.pages.map((p) => `${p.id} ${p.section}: ${p.say}`).join('\n')}

script.js:
\`\`\`js
${this.project.read('script.js')}
\`\`\`${code ? `\n\n${code}` : ''}`);
    await s.close();
  }

  /** Whole run. `approve` is called with the storyboard and resolves with optional feedback (the user's edits). */
  async run(approve: (sb: Storyboard) => Promise<string | undefined> = async () => undefined) {
    // a change that stopped while it was still being planned: the film is done, so only the change has anything left to do
    if (this.state.stage === 'done' && this.state.change) return this.revise(this.state.change);
    if (this.state.stage === 'storyboard') await this.storyboard();
    if (this.state.stage === 'approval') await this.script(await approve(this.project.storyboard()));
    if (this.state.stage === 'script') await this.script();
    if (this.state.stage === 'narrate') await this.narrate();
    if (this.state.stage === 'pages') await this.pages();
    if (this.state.stage === 'review') await this.review();
    if (this.state.stage === 'render') await this.ready();   // a run saved before exports were separate: it is ready to preview
    if (this.state.change) { this.state.change = undefined; this.save(); }
  }

  /** the exported mp4 if it shows the film as it is now */
  get exported(): string | undefined { return this.state.exported !== false && this.state.video ? this.state.video : undefined; }
}

export const projectFile = (dir: string, rel: string) => path.join(dir, rel);
