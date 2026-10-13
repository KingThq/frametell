// The orchestrator's hands on a project: engine tools (lint, snap, timeline, render, film gate) and git history.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { ENGINE_DIR, linkProject } from '@frametell/engine/tools/project.mjs';
import { lintStoryboard, type StoryboardIssue } from '@frametell/engine/tools/storyboard-lint.mjs';
import { measure, type FilmGateResult } from '@frametell/engine/tools/film-gate.mjs';
import { FFMPEG } from '@frametell/engine/tools/bins.mjs';
import { confine } from './tools/sandbox.js';

export interface Cue { i: number; at: number; abs: number; text: string }
export interface PageTiming { id: string; start: number; end: number; speechEnd: number; cues: Cue[] }
export interface Timeline { voiced: boolean; duration: number; pages: PageTiming[]; /** page id → a frame cut from the finished film */ posters?: Record<string, string> }
/** what a lint finding is about (engine/tools/checks.mjs) */
export type LintKind = 'runtime' | 'api' | 'empty-opening' | 'empty-ending' | 'sparse' | 'text-heavy' | 'nondeterministic' | 'raw-markup' | 'off-canvas' | 'subtitle-band' | 'small-text' | 'overlap';
/** `level`: 'error' is plainly wrong on screen or in the code, a page is not done while one is there; 'warn' is advice
 *  the pictures decide on. `msg` is for whoever reads it: code goes by `kind` and `level` */
export interface LintIssue { page: string; t: number; t1: number; local: number; kind: LintKind; level: 'error' | 'warn'; msg: string }
/** a page's check: its lint findings and a contact sheet (absolute path), or why the page could not be drawn */
export type PageCheck = { issues: LintIssue[]; sheet: string; crash?: undefined } | { issues: LintIssue[]; sheet?: undefined; crash: string };

export interface Beat { at: string; object: string; action: string; camera?: string; text?: string }
export interface StoryPage { id: string; section: string; say: string; core?: boolean; beats: Beat[] }
export interface Storyboard { title: string; summary: string; durationSec?: number; style: string; cast: string; lang?: 'zh' | 'en'; pages: StoryPage[] }

/** The environment for a child that runs process.execPath as Node: inside Electron the executable is the app, which runs
 * as plain Node only with ELECTRON_RUN_AS_NODE (it must not be set for the app's own helper processes, so only here). */
export const nodeEnv = (extra: Record<string, string | undefined> = {}) => ({ ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}), ...extra });

/** run a program to completion without blocking the process */
const run = (cmd: string, args: string[], cwd?: string) => new Promise<void>((ok, fail) => execFile(cmd, args, { cwd, timeout: 120_000, env: nodeEnv() }, (e, _o, err) => (e ? fail(new Error(String(err || e.message).slice(0, 1000))) : ok())));

/** how an engine tool is run: as Node, and inside the shell's sandbox when the network is taken away (the hosted
 *  sandbox), since the pages it opens in Chrome run code the agent wrote */
export const engineCmd = (dir: string, args: string[]): [string, string[]] =>
  process.env.FRAMETELL_SANDBOX_NONET === '1' ? confine(dir, process.execPath, args) : [process.execPath, args];

/** run an engine tool and collect its output. Never synchronously: lint and snapshots drive Chrome for seconds, and in the
 *  desktop app this process is also the one answering the panel (ten pages checking themselves froze every click).
 *  A stop kills it at once and rejects with an AbortError: Pause used to wait for every screenshot in flight to end on
 *  its own (seen: ten 3D pages' screenshots hung for five minutes, and the click on Pause seemed to do nothing) */
function tool(dir: string, name: string, args: string[], opts: { timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal } = {}) {
  return new Promise<{ code: number; out: string; err: string }>((ok, fail) => {
    if (opts.signal?.aborted) return fail(new DOMException('aborted', 'AbortError'));
    const [cmd, argv] = engineCmd(dir, [path.join(ENGINE_DIR, 'tools', name), ...args]);
    execFile(cmd, argv, {
      cwd: dir, encoding: 'utf8', timeout: opts.timeoutMs ?? 240_000, maxBuffer: 64 << 20, env: nodeEnv(opts.env), signal: opts.signal,
    }, (e, stdout, stderr) => {
      if (opts.signal?.aborted) return fail(new DOMException('aborted', 'AbortError'));
      ok({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out: (stdout || '').trim(), err: (stderr || '').trim() });
    });
  });
}

/**
 * Draws a project's film somewhere other than this process (a hosted service sends it to a render container). It must
 * leave the two mp4s in <dir>/out as engine/tools/render.mjs names them, pass progress lines to onLine, and stop on
 * signal. Without one, render.mjs runs here.
 */
export type Renderer = (dir: string, o: { fps: number; workers: number; onLine?: (l: string) => void; signal?: AbortSignal }) => Promise<void>;

export class Project {
  /** `signal` stops the engine tools it runs (lint, screenshots, the time line) */
  constructor(readonly dir: string, private renderer?: Renderer, private signal?: AbortSignal) { linkProject(dir); }

  file(rel: string) { return path.join(this.dir, rel); }
  read(rel: string) { return fs.readFileSync(this.file(rel), 'utf8'); }
  exists(rel: string) { return fs.existsSync(this.file(rel)); }

  storyboard(): Storyboard { return JSON.parse(this.read('storyboard.json')); }
  materialsText(): string {
    const dir = this.file('materials');
    if (!fs.existsSync(dir)) return '';
    return fs.readdirSync(dir).filter((f) => /\.(md|txt)$/i.test(f)).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n\n');
  }
  storyboardIssues(): StoryboardIssue[] {
    try { return lintStoryboard(this.storyboard(), { source: this.materialsText() }); }
    catch (e) { return [{ level: 'red', msg: `storyboard.json cannot be read: ${(e as Error).message}` }]; }
  }

  /** Script check (engine/tools/script.mjs): page and cue counts, estimated length; errors point at the cue. */
  scriptCheck() { return tool(this.dir, 'script.mjs', [], { signal: this.signal }); }

  /**
   * One settled frame per page (0.4 s before it ends), cut from the finished film and kept in out/thumbs; for pages
   * whose run predates per-page thumbnails. Returns project-relative paths by page id.
   */
  /**
   * Full-resolution frames at `times` (project-relative jpgs). From the exported mp4 when it is current, else drawn by
   * the live film itself in one headless pass — a frame of the preview never waits for an export. Both are cached.
   */
  async stills(times: number[], video?: string): Promise<string[]> {
    const ts = times.map((t) => Math.max(0, Math.round(t * 10) / 10));
    const dir = path.join(this.dir, 'out', 'frames');
    fs.mkdirSync(dir, { recursive: true });
    if (video) {
      const vt = fs.statSync(video).mtimeMs;
      return Promise.all(ts.map(async (t) => {
        const rel = `out/frames/${Math.round(t * 10)}.jpg`, abs = path.join(this.dir, rel);
        if (!fs.existsSync(abs) || fs.statSync(abs).mtimeMs < vt) await run(FFMPEG, ['-y', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-q:v', '2', abs]);
        return rel;
      }));
    }
    // the film as it is now: its script, voice and pages; any change gives new names, so old frames are never shown
    const files = ['script.js', 'voice.js', ...fs.readdirSync(this.file('pages')).map((f) => `pages/${f}`)];
    const stamp = createHash('sha1').update(files.map((f) => { try { return `${f}:${fs.statSync(this.file(f)).mtimeMs}`; } catch { return f; } }).join('|')).digest('hex').slice(0, 10);
    const rel = (t: number) => `out/frames/live-${stamp}-${Math.round(t * 10)}.jpg`;
    const todo = [...new Set(ts.filter((t) => !fs.existsSync(path.join(this.dir, rel(t)))))];
    if (todo.length) {
      const [cmd, argv] = engineCmd(this.dir, [path.join(ENGINE_DIR, 'tools', 'snap.mjs'), ...todo.map((t) => t.toFixed(1))]);
      await run(cmd, argv, this.dir);
      await Promise.all(todo.map(async (t) => {
        const png = this.file(`out/snap/snap-${t}.png`);
        await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', png, '-q:v', '2', path.join(this.dir, rel(t))]);
        fs.rmSync(png, { force: true });
      }));
    }
    return ts.map(rel);
  }

  async posters(video: string, pages: PageTiming[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const dir = path.join(this.dir, 'out', 'thumbs');
    const vt = fs.statSync(video).mtimeMs;
    for (const p of pages) {
      const rel = `out/thumbs/${p.id}.jpg`, abs = path.join(this.dir, rel);
      try {
        if (!fs.existsSync(abs) || fs.statSync(abs).mtimeMs < vt) {
          fs.mkdirSync(dir, { recursive: true });
          await run(FFMPEG, ['-y', '-loglevel', 'error', '-ss', Math.max(p.start, p.end - 0.4).toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', abs]);
        }
        out[p.id] = rel;
      } catch { /* a frame that will not cut leaves that page on its check sheet */ }
    }
    return out;
  }

  async timeline(): Promise<Timeline> {
    const r = await tool(this.dir, 'pages.mjs', ['--json'], { signal: this.signal });
    if (r.code) throw new Error(`timeline failed: ${r.err || r.out}`);
    return JSON.parse(r.out);
  }

  /** `timeoutMs`: a lint that takes longer is given up and reports nothing (a page's own check must not hold the film) */
  async lint(only?: string[], extra: string[] = [], timeoutMs?: number): Promise<LintIssue[]> {
    const r = await tool(this.dir, 'lint.mjs', ['--json', ...(only ? ['--only', only.join(',')] : []), ...extra], { signal: this.signal, timeoutMs });
    const last = r.out.split('\n').pop() || '[]';
    try { return JSON.parse(last); } catch { throw new Error(`lint failed: ${r.err || r.out}`.slice(0, 2000)); }
  }

  /**
   * A page's check in one browser (engine/tools/check.mjs): lint, with `determinism` the cold/warm frame comparison, and
   * a contact sheet `name` of the page at the absolute `times`. `lintMs`: a lint that takes longer is given up (no
   * findings, the sheet still taken), so a page's own check never holds the film.
   */
  async check(id: string, name: string, times: number[], o: { determinism?: boolean; lintMs?: number } = {}): Promise<PageCheck> {
    const r = await tool(this.dir, 'check.mjs', ['--only', id, '--sheet', name, ...(o.determinism ? ['--determinism'] : []), ...(o.lintMs ? ['--lint-ms', String(o.lintMs)] : []), ...times.map((t) => t.toFixed(2))], { signal: this.signal });
    let out: { issues?: LintIssue[]; sheet?: string; crash?: string };
    try { out = JSON.parse(r.out.split('\n').pop() || ''); } catch { return { issues: [], crash: `check failed: ${r.err || r.out}`.slice(0, 2000) }; }
    // what the page logged before it broke (pageerror lines) says where; the crash alone often does not
    if (out.crash || !out.sheet) return { issues: out.issues ?? [], crash: [out.crash ?? 'no contact sheet', r.err].filter(Boolean).join('\n').slice(0, 2000) };
    return { issues: out.issues ?? [], sheet: this.file(out.sheet) };
  }

  /** A contact sheet of the given absolute times → path of the jpg. */
  async snap(name: string, times: number[], only?: string[], tile = 480, label = true): Promise<string> {
    const r = await tool(this.dir, 'snap.mjs', [...(only ? ['--only', only.join(',')] : []), '--sheet', name, ...times.map((t) => t.toFixed(2))], { env: { SNAP_TILE: String(tile), SNAP_LABEL: label ? '1' : '0' }, signal: this.signal });
    const f = this.file(`out/snap/${name}.jpg`);
    if (r.code || !fs.existsSync(f)) throw new Error(`screenshot failed: ${r.err || r.out}`.slice(0, 2000));
    return f;
  }

  /** Render the film; progress lines are passed through. Resolves with the output files. */
  async render(o: { fps?: number; workers?: number; onLine?: (l: string) => void; signal?: AbortSignal } = {}): Promise<{ withSubs: string; noSubs: string }> {
    if (this.renderer) {
      await this.renderer(this.dir, { fps: o.fps ?? 30, workers: o.workers ?? 4, onLine: o.onLine, signal: o.signal });
      return this.films();
    }
    return new Promise((resolve, reject) => {
      const [cmd, argv] = engineCmd(this.dir, [path.join(ENGINE_DIR, 'tools/render.mjs'), '--fps', String(o.fps ?? 30), '--workers', String(o.workers ?? 4)]);
      const child = spawn(cmd, argv, { cwd: this.dir, signal: o.signal, env: nodeEnv() });
      let tail = '';
      const onData = (d: Buffer) => { for (const l of d.toString().split('\n')) if (l.trim()) { tail = (tail + '\n' + l).slice(-4000); o.onLine?.(l); } };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      child.on('error', reject);
      child.on('close', (code) => {
        if (code) return reject(new Error(`render failed (exit ${code}): ${tail.slice(-1500)}`));
        try { resolve(this.films()); } catch (e) { reject(e); }
      });
    });
  }

  /** the two exported films in out/ */
  private films(): { withSubs: string; noSubs: string } {
    const out = fs.readdirSync(this.file('out')).filter((f) => f.endsWith('.mp4'));
    const withSubs = out.find((f) => /-(有字幕|with-subtitles)\.mp4$/.test(f)), noSubs = out.find((f) => /-(无字幕|no-subtitles)\.mp4$/.test(f));
    if (!withSubs || !noSubs) throw new Error('render finished but no film was found');
    return { withSubs: this.file('out/' + withSubs), noSubs: this.file('out/' + noSubs) };
  }

  gate(file: string): FilmGateResult { return measure(file); }

  // ── history: every change the agent makes is a commit, so any step can be undone (git revert) ──
  private git(args: string[]) { return spawnSync('git', args, { cwd: this.dir, encoding: 'utf8' }); }
  private gitAsync(args: string[]) {
    return new Promise<{ status: number; stdout: string }>((ok) => execFile('git', args, { cwd: this.dir, encoding: 'utf8', maxBuffer: 16 << 20 }, (e, stdout) => ok({ status: e ? 1 : 0, stdout: stdout || '' })));
  }
  initHistory() {
    if (!fs.existsSync(this.file('.git'))) {
      this.git(['init', '-q', '-b', 'main']);
      this.git(['config', 'user.name', 'Frametell']);
      this.git(['config', 'user.email', 'studio@frametell.local']);
    }
    this.commitSync('Project created');
  }
  /** Commit everything that changed; returns the commit id, or null when nothing changed. */
  async commit(message: string): Promise<string | null> {
    await this.gitAsync(['add', '-A']);
    const r = await this.gitAsync(['commit', '-q', '-m', message]);
    if (r.status !== 0) return null;
    return (await this.gitAsync(['rev-parse', '--short', 'HEAD'])).stdout.trim();
  }
  private commitSync(message: string) {
    this.git(['add', '-A']);
    this.git(['commit', '-q', '-m', message]);
  }
}
