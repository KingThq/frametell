// The orchestrator's hands on a project: engine tools (lint, snap, timeline, render, film gate) and git history.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ENGINE_DIR, linkProject } from '@frametell/engine/tools/project.mjs';
import { lintStoryboard, type StoryboardIssue } from '@frametell/engine/tools/storyboard-lint.mjs';
import { measure, type FilmGateResult } from '@frametell/engine/tools/film-gate.mjs';
import { FFMPEG } from '@frametell/engine/tools/bins.mjs';

export interface Cue { i: number; at: number; abs: number; text: string }
export interface PageTiming { id: string; start: number; end: number; speechEnd: number; cues: Cue[] }
export interface Timeline { voiced: boolean; duration: number; pages: PageTiming[]; /** page id → a frame cut from the finished film */ posters?: Record<string, string> }
export interface LintIssue { page: string; t: number; t1: number; local: number; msg: string }

export interface Beat { at: string; object: string; action: string; camera?: string; text?: string }
export interface StoryPage { id: string; section: string; say: string; core?: boolean; beats: Beat[] }
export interface Storyboard { title: string; summary: string; durationSec?: number; style: string; cast: string; pages: StoryPage[] }

function tool(dir: string, name: string, args: string[], opts: { timeoutMs?: number; env?: Record<string, string> } = {}) {
  const r = spawnSync(process.execPath, [path.join(ENGINE_DIR, 'tools', name), ...args], {
    cwd: dir, encoding: 'utf8', timeout: opts.timeoutMs ?? 240_000, maxBuffer: 64 << 20, env: { ...process.env, ...opts.env },
  });
  return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

export class Project {
  constructor(readonly dir: string) { linkProject(dir); }

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
    catch (e) { return [{ level: 'red', msg: `storyboard.json 读不了：${(e as Error).message}` }]; }
  }

  /** Script check (engine/tools/script.mjs): page and cue counts, estimated length; errors point at the cue. */
  scriptCheck() { return tool(this.dir, 'script.mjs', []); }

  /**
   * One settled frame per page (0.4 s before it ends), cut from the finished film and kept in out/thumbs; for pages
   * whose run predates per-page thumbnails. Returns project-relative paths by page id.
   */
  posters(video: string, pages: PageTiming[]): Record<string, string> {
    const out: Record<string, string> = {};
    const dir = path.join(this.dir, 'out', 'thumbs');
    const vt = fs.statSync(video).mtimeMs;
    for (const p of pages) {
      const rel = `out/thumbs/${p.id}.jpg`, abs = path.join(this.dir, rel);
      try {
        if (!fs.existsSync(abs) || fs.statSync(abs).mtimeMs < vt) {
          fs.mkdirSync(dir, { recursive: true });
          const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', Math.max(p.start, p.end - 0.4).toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', abs]);
          if (r.status !== 0) continue;
        }
        out[p.id] = rel;
      } catch { /* a frame that will not cut leaves that page on its check sheet */ }
    }
    return out;
  }

  timeline(): Timeline {
    const r = tool(this.dir, 'pages.mjs', ['--json']);
    if (r.code) throw new Error(`时间轴计算失败：${r.err || r.out}`);
    return JSON.parse(r.out);
  }

  lint(only?: string[], extra: string[] = []): LintIssue[] {
    const r = tool(this.dir, 'lint.mjs', ['--json', ...(only ? ['--only', only.join(',')] : []), ...extra]);
    const last = r.out.split('\n').pop() || '[]';
    try { return JSON.parse(last); } catch { throw new Error(`lint 失败：${r.err || r.out}`.slice(0, 2000)); }
  }

  /** A contact sheet of the given absolute times → path of the jpg. */
  snap(name: string, times: number[], only?: string[], tile = 480): string {
    const r = tool(this.dir, 'snap.mjs', [...(only ? ['--only', only.join(',')] : []), '--sheet', name, ...times.map((t) => t.toFixed(2))], { env: { SNAP_TILE: String(tile) } });
    const f = this.file(`out/snap/${name}.jpg`);
    if (r.code || !fs.existsSync(f)) throw new Error(`截图失败：${r.err || r.out}`.slice(0, 2000));
    return f;
  }

  /** Render the film; progress lines are passed through. Resolves with the output files. */
  render(o: { fps?: number; workers?: number; onLine?: (l: string) => void; signal?: AbortSignal } = {}): Promise<{ withSubs: string; noSubs: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(ENGINE_DIR, 'tools/render.mjs'), '--fps', String(o.fps ?? 30), '--workers', String(o.workers ?? 4)], { cwd: this.dir, signal: o.signal });
      let tail = '';
      const onData = (d: Buffer) => { for (const l of d.toString().split('\n')) if (l.trim()) { tail = (tail + '\n' + l).slice(-4000); o.onLine?.(l); } };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      child.on('error', reject);
      child.on('close', (code) => {
        if (code) return reject(new Error(`渲染失败（exit ${code}）：${tail.slice(-1500)}`));
        const out = fs.readdirSync(this.file('out')).filter((f) => f.endsWith('.mp4'));
        const withSubs = out.find((f) => f.includes('有字幕')), noSubs = out.find((f) => f.includes('无字幕'));
        if (!withSubs || !noSubs) return reject(new Error('渲染结束但没有找到成片'));
        resolve({ withSubs: this.file('out/' + withSubs), noSubs: this.file('out/' + noSubs) });
      });
    });
  }

  gate(file: string): FilmGateResult { return measure(file); }

  // ── history: every change the agent makes is a commit, so any step can be undone (git revert) ──
  private git(args: string[]) { return spawnSync('git', args, { cwd: this.dir, encoding: 'utf8' }); }
  initHistory() {
    if (!fs.existsSync(this.file('.git'))) {
      this.git(['init', '-q', '-b', 'main']);
      this.git(['config', 'user.name', 'Frametell']);
      this.git(['config', 'user.email', 'studio@frametell.local']);
    }
    this.commit('项目创建');
  }
  /** Commit everything that changed; returns the commit id, or null when nothing changed. */
  commit(message: string): string | null {
    this.git(['add', '-A']);
    const r = this.git(['commit', '-q', '-m', message]);
    if (r.status !== 0) return null;
    return this.git(['rev-parse', '--short', 'HEAD']).stdout.trim();
  }
}
