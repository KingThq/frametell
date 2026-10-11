// Narration for a project: each page is synthesized as one utterance (the voice shapes intonation across the passage),
// then cut back into cues inside detected silences, so no sound is ever dropped. Writes audio/ and voice.js
// (SCRIPT.VOICE), including per-character onsets so pages can sync to words (P.cw). Pages are cached by text + voice.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { FFMPEG, probe } from '@frametell/engine/tools/bins.mjs';
import { ENGINE_DIR } from '@frametell/engine/tools/project.mjs';
import type { TtsProvider, WordTime } from './tts.js';

type Cue = string | { t: string; say?: string; hold?: number; solo?: { instruction?: string; pitch?: number; rate?: number } };
interface Page { id: string; cues: Cue[]; instruction?: string }
interface VoiceMeta { speaker: string; rate?: number; pitch?: number; instruction?: string; lexicon?: Record<string, string> }

export interface NarrateOptions {
  tts: TtsProvider;
  /** overrides META.voice */
  voice?: Partial<VoiceMeta>;
  onProgress?: (e: { page: string; index: number; total: number; cached: boolean }) => void;
  signal?: AbortSignal;
}
export interface NarrateResult { synthesized: number; duration: number; warnings: string[] }

const EDGE = 0.05, TAIL = 0.15, MAXPAUSE = 0.32, SIL_DB = -45;
const text = (c: Cue) => (typeof c === 'string' ? c : c.t);
const norm = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '');
// a cue without its own closing mark gets a comma, so the voice pauses but does not end the sentence (English gets ',')
const withStop = (s: string) => (/[\p{P}]$/u.test(s.trim()) ? s.trim() : s.trim() + (/[A-Za-z0-9]$/.test(s.trim()) ? ',' : '，'));

function loadScript(dir: string) {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ENGINE_DIR, 'runtime/timing.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(dir, 'script.js'), 'utf8'), ctx);
  return ctx as unknown as { SCRIPT: { META: Record<string, any>; PAGES: Page[] }; TIMING: any };
}

const dur = (f: string) => probe(f).duration;

/** Speech span of every cue, from the per-character timestamps. */
function spans(spoken: string[], words: WordTime[], warn: (m: string) => void) {
  const ends: number[] = [];
  let acc = 0;
  for (const s of spoken) ends.push((acc += norm(s).length));
  const sp: ({ s: number; e: number } | null)[] = spoken.map(() => null);
  let pos = 0;
  for (const w of words) {
    const n = norm(w.word).length;
    if (!n) continue;
    const i = ends.findIndex((e) => pos < e);
    const k = i < 0 ? spoken.length - 1 : i;
    sp[k] = sp[k] ? { s: sp[k]!.s, e: w.endTime } : { s: w.startTime, e: w.endTime };
    pos += n;
  }
  if (pos !== acc) warn(`timestamps cover ${pos} characters but the text has ${acc} (numbers or English were read differently); timing falls back to proportions`);
  return sp.map((x, i) => x || sp[i - 1] || { s: 0, e: 0.3 });
}

/** Cut points: always inside a detected silence; long silences keep MAXPAUSE on each side. */
function cut(wav: string, sp: { s: number; e: number }[]) {
  const log = spawnSync(FFMPEG, ['-hide_banner', '-i', wav, '-af', `silencedetect=noise=${SIL_DB}dB:d=0.06`, '-f', 'null', '-']).stderr.toString();
  const sil: [number, number][] = [];
  let st: number | null = null;
  for (const m of log.matchAll(/silence_(start|end): ([\d.]+)/g)) {
    if (m[1] === 'start') st = +m[2]; else if (st != null) { sil.push([st, +m[2]]); st = null; }
  }
  const D = dur(wav);
  if (st != null) sil.push([st, D]);
  const n = sp.length;
  const segs = sp.map(() => ({ a: 0, b: D, o: 0, fin: false, fout: false, join: false }));
  const head = sil.find(([a]) => a < 0.02), tail = sil.find(([, b]) => b > D - 0.02);
  segs[0].a = head ? Math.max(0, head[1] - EDGE) : 0;
  segs[0].fin = !!head;
  segs[n - 1].b = tail && tail[0] > segs[0].a ? Math.min(D, tail[0] + TAIL) : D;
  segs[n - 1].fout = true;
  const removed: [number, number][] = [];
  if (head && segs[0].a > 0) removed.push([0, segs[0].a]);
  if (segs[n - 1].b < D) removed.push([segs[n - 1].b, D]);
  for (let i = 0; i < n - 1; i++) {
    const lo = sp[i].e - 0.15, hi = sp[i + 1].s + 0.15;
    const cand = sil.filter(([a, b]) => b > lo && a < hi && a > 0.02 && b < D - 0.02).sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
    if (cand) {
      const keep = Math.min(MAXPAUSE, (cand[1] - cand[0]) / 2);
      segs[i].b = cand[0] + keep; segs[i + 1].a = cand[1] - keep;
      segs[i].fout = true; segs[i + 1].fin = true;
      if (segs[i + 1].a > segs[i].b) removed.push([segs[i].b, segs[i + 1].a]);
    } else {
      const m = (sp[i].e + sp[i + 1].s) / 2;   // spoken straight through: the halves are placed back to back
      segs[i].b = m; segs[i + 1].a = m; segs[i].join = true;
    }
  }
  segs.forEach((g, i) => { g.o = Math.max(0, Math.min(sp[i].s - g.a, g.b - g.a - 0.1)); });
  // durations read from ffmpeg are rounded to 1/100 s, so a silence that runs to the end can look 5 ms short of it
  const inSil = ([a, b]: [number, number]) => sil.some(([x, y]) => a >= x - 0.01 && b <= y + 0.01);
  const bad = removed.filter((x) => !inSil(x));
  return { segs, bad };
}

/**
 * Per-character onsets for a cue, seconds from the start of its audio segment: one entry per character of the cue
 * text (Array.from order). Punctuation and characters the voice skipped take the previous onset.
 */
function charOnsets(cueText: string, spokenText: string, words: WordTime[], wordFrom: number, segStart: number): number[] | undefined {
  if (cueText !== spokenText) return undefined;   // a respelled cue (say / lexicon): positions no longer line up
  const chars = Array.from(cueText);
  const out: number[] = [];
  let wi = wordFrom, inWord = 0, last = 0;
  for (const ch of chars) {
    if (!norm(ch)) { out.push(last); continue; }
    while (wi < words.length && !norm(words[wi].word)) wi++;
    const w = words[wi];
    if (!w) { out.push(last); continue; }
    last = +Math.max(0, w.startTime - segStart).toFixed(3);
    out.push(last);
    if (++inWord >= norm(w.word).length) { wi++; inWord = 0; }
  }
  return out;
}

export async function narrate(dir: string, opts: NarrateOptions): Promise<NarrateResult> {
  const { SCRIPT } = loadScript(dir);
  const V: VoiceMeta = { ...(SCRIPT.META.voice || {}), ...(opts.voice || {}) } as VoiceMeta;
  if (!V.speaker) throw new Error('no voice set (META.voice.speaker)');
  const warnings: string[] = [];
  const en = SCRIPT.META.lang === 'en';
  const LEXICON: Record<string, string> = { ...(en ? { 'CLAUDE.md': 'claude dot md', 'AGENTS.md': 'agents dot md', 'README.md': 'readme dot md' } : { 'CLAUDE.md': 'claude 点 md', 'AGENTS.md': 'agents 点 md', 'README.md': 'readme 点 md' }), ...(V.lexicon || {}) };
  const respell = (s: string) => Object.entries(LEXICON).reduce((a, [k, v]) => a.split(k).join(v), s);
  const spokenOf = (c: Cue) => respell((typeof c === 'object' && c.say) || text(c));
  const audioDir = path.join(dir, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });
  const pages: Record<string, unknown>[][] = [];
  let made = 0;
  for (const [pi, pg] of SCRIPT.PAGES.entries()) {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    // a page is one utterance, except cues with { solo } which get their own take (their tone shouldn't leak)
    const runs: { solo: NonNullable<Exclude<Cue, string>['solo']> | null; cues: Cue[]; idx: number[] }[] = [];
    pg.cues.forEach((c, ci) => {
      const solo = typeof c === 'object' && c.solo ? c.solo : null;
      if (solo || !runs.length || runs.at(-1)!.solo) runs.push({ solo, cues: [], idx: [] });
      runs.at(-1)!.cues.push(c); runs.at(-1)!.idx.push(ci);
      if (solo) runs.push({ solo: null, cues: [], idx: [] });
    });
    const out: Record<string, unknown>[] = [];
    let cachedPage = true;
    for (const [ri, run] of runs.filter((r) => r.cues.length).entries()) {
      const spoken = run.cues.map(spokenOf);
      // English sentences need a space between them; Chinese ones are joined as they are (the same text as before, so
      // the same cached audio)
      const utter = spoken.map(withStop).reduce((a, x) => a + (a && /[,.;:!?]$/.test(a) && /^[A-Za-z0-9"'“‘(]/.test(x) ? ' ' : '') + x, '');
      const instruction = run.solo?.instruction ?? pg.instruction ?? V.instruction;
      const extra = { pitch: run.solo?.pitch ?? V.pitch, rate: run.solo?.rate ?? V.rate ?? 0 };
      const whole = !run.solo && run.cues.length === pg.cues.length;
      const id = crypto.createHash('md5').update(JSON.stringify([opts.tts.id, utter, V.speaker, extra, instruction ?? ''])).digest('hex').slice(0, 12);
      const base = path.join(audioDir, whole ? `${pg.id}-${id}` : `${pg.id}-${ri}-${id}`);
      const mp3 = base + '.mp3', wj = base + '.json', wav = base + '.wav';
      if (!fs.existsSync(wj)) {
        const { audio, words } = await opts.tts.synth(utter, { voice: V.speaker, rate: extra.rate, pitch: extra.pitch, instruction, signal: opts.signal });
        fs.writeFileSync(mp3, audio);
        fs.writeFileSync(wj, JSON.stringify(words));
        made++; cachedPage = false;
      }
      if (!fs.existsSync(wav)) execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', mp3, '-ac', '1', '-ar', '24000', wav]);
      const words = JSON.parse(fs.readFileSync(wj, 'utf8')) as WordTime[];
      const sp = spans(spoken, words, (m) => warnings.push(`${pg.id}：${m}`));
      const { segs, bad } = cut(wav, sp);
      if (bad.length) throw new Error(`${pg.id}: cutting the take into lines would drop audible sound at ${bad.map(([a, b]) => `${a.toFixed(2)}–${b.toFixed(2)}s`).join(' ')}`);
      // which word starts each cue (for per-character onsets)
      const firstWord: number[] = [];
      { let acc = 0, wi = 0, pos = 0; for (const s of spoken) { while (wi < words.length && pos < acc) { pos += norm(words[wi].word).length; wi++; } firstWord.push(wi); acc += norm(s).length; } }
      run.cues.forEach((c, k) => {
        const g = segs[k], f = `${base}-${k}.wav`;
        const af = `atrim=start=${g.a.toFixed(3)}:end=${g.b.toFixed(3)},asetpts=N/SR/TB` + (g.fin ? ',afade=t=in:d=0.01' : '') + (g.fout ? ',areverse,afade=t=in:d=0.02,areverse' : '');
        execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', wav, '-af', af, f]);
        const v: Record<string, unknown> = { t: text(c), f: 'audio/' + path.basename(f), d: +(g.b - g.a).toFixed(3), o: +g.o.toFixed(3) };
        const kk = charOnsets(text(c), spoken[k], words, firstWord[k], g.a);
        if (kk) v.k = kk;
        if (g.join) v.join = 1;
        out[run.idx[k]] = v;
      });
    }
    pages.push(out);
    opts.onProgress?.({ page: pg.id, index: pi, total: SCRIPT.PAGES.length, cached: cachedPage });
  }
  fs.writeFileSync(path.join(dir, 'voice.js'), `/* Generated by Frametell — real narration timing. Do not edit; narrate again after changing cues. */\nSCRIPT.VOICE = ${JSON.stringify({ speaker: V.speaker, provider: opts.tts.id, pages })};\n`);
  const { SCRIPT: S2, TIMING } = (() => { const x = loadScript(dir); vm.runInContext(fs.readFileSync(path.join(dir, 'voice.js'), 'utf8'), x as unknown as vm.Context); return x; })();
  const L = TIMING.layout(S2.PAGES, { ...S2.META, voice: (S2 as any).VOICE });
  return { synthesized: made, duration: L.duration, warnings };
}
