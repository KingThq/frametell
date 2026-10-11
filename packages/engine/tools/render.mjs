// Parallel render → out/<name>-无字幕.mp4, then burn subtitles → out/<name>-有字幕.mp4 (an English film: -no-subtitles / -with-subtitles). Run from a project dir:
// node engine/tools/render.mjs [--portrait] [--hw] [--fps 60]
//   --hw: hardware H.264 (Apple media engine) for chunks and the subtitle pass — frees the CPU for the browsers; slightly larger files [--workers 12] [--from 0] [--to <end>] [--name <file name>] [--skip-video] [--skip-subs]
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { loadEpisode, OUT, PORTRAIT, EP } from './lib.mjs';
import { mixTrack } from './mix.mjs';
import { FFMPEG, probe } from './bins.mjs';
const dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);
const { META, L, TIMING } = loadEpisode();
// a voiced episode must have audio for every cue (stale voice.js after editing cues → those cues would be silent)
if (META.voice) {
  const missing = L.pages.flatMap((p) => p.cues.filter((c) => !c.audio).map((c) => `${p.id}「${c.text}」`));
  if (missing.length) { console.error(`✗ 这些句子没有配音，先跑 tts：\n${missing.join('\n')}`); process.exit(1); }
}
// --portrait: 1080×1920 from pages-portrait/, files get a 竖版 tag; children inherit PORTRAIT=1
if (PORTRAIT) process.env.PORTRAIT = '1';
if (has('hw')) process.env.HW = '1';
const FPS = +arg('fps', 60), W = +arg('workers', 12), name = arg('name', META.name || 'video') + (PORTRAIT ? (META.lang === 'en' ? '-portrait' : '-竖版') : '');
const from = +arg('from', 0), to = +arg('to', L.duration);
const F0 = Math.round(from * FPS), F1 = Math.round(to * FPS);
const chunkDir = path.join(OUT, PORTRAIT ? 'chunks-portrait' : 'chunks');
fs.mkdirSync(chunkDir, { recursive: true });

// one render per episode at a time: two runs share out/chunks (the segment cache)
const lock = path.join(OUT, '.render.lock');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
if (fs.existsSync(lock) && alive(+fs.readFileSync(lock, 'utf8'))) {
  console.error(`已有一次出片在跑（pid ${fs.readFileSync(lock, 'utf8')}），等它结束再开。`);
  process.exit(1);
}
fs.writeFileSync(lock, String(process.pid));
const unlock = () => fs.rmSync(lock, { force: true });
process.on('exit', unlock);
process.on('SIGINT', () => process.exit(130));

const run = (cmd, args) => new Promise((res, rej) => spawn(cmd, args, { stdio: 'inherit' }).on('close', (c) => (c ? rej(new Error(cmd + ' ' + c)) : res())));
const [NO, WITH] = META.lang === 'en' ? ['no-subtitles', 'with-subtitles'] : ['无字幕', '有字幕'];
const nosub = path.join(OUT, `${name}-${NO}.mp4`), withsub = path.join(OUT, `${name}-${WITH}.mp4`);

if (!has('skip-video')) {
  console.time('video');
  // Segments that follow the pages (none longer than SEG seconds), each cached under a key of everything that draws it:
  // the pages on screen in it (code and timing, with a margin for the cross-fades), the episode's settings, the engine.
  // An export after a one-page change renders only that page's segments; the rest are reused as they are.
  const SEG = 6, MARGIN = 1;
  // files of a folder (recursive only where asked: a style folder holds its example episode, which links back here)
  const files = (d, deep = true) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: deep }).map((f) => path.join(d, String(f))).filter((f) => fs.lstatSync(f).isFile()).sort() : []);
  const digest = (...parts) => createHash('sha1').update(parts.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\0')).digest('hex').slice(0, 16);
  const read = (f) => { try { return fs.readFileSync(f); } catch { return ''; } };
  const kitDir = path.join(dir, '..');
  const shared = digest(
    ...[...files(path.join(kitDir, 'runtime')), ...files(path.join(kitDir, 'lib')), ...files(path.join(kitDir, 'styles', META.style || 'warm-story'), false)].map((f) => read(f).toString('base64')),
    ...files(path.join(EP, 'extras')).map((f) => read(f).toString('base64')), read(path.join(EP, 'index.html')).toString(),
    { ...META, publish: undefined, voice: undefined }, L.pages.map((p) => [p.id, p.section, p.title]), FPS, PORTRAIT, has('hw'),
  );
  const pageKey = Object.fromEntries(L.pages.map((p) => [p.id, digest(p, read(path.join(EP, PORTRAIT ? 'pages-portrait' : 'pages', p.id + '.js')).toString())]));
  // each page: a short piece at either end (where a neighbour's cross-fade reaches), the middle in pieces of ≤ SEG s;
  // so a changed page costs its neighbours only those short end pieces
  const EDGE = MARGIN + 0.2;
  const segs = [];
  for (const p of L.pages) {
    const s0 = Math.max(from, p.start), s1 = Math.min(to, p.end);
    const cuts = s1 - s0 > 2 * EDGE + 1 ? [s0, s0 + EDGE, s1 - EDGE, s1] : [s0, s1];
    const bounds = [cuts[0]];
    for (let k = 1; k < cuts.length; k++) {
      const n = k === 2 ? Math.max(1, Math.ceil((cuts[2] - cuts[1]) / SEG)) : 1;
      for (let j = 1; j <= n; j++) bounds.push(cuts[k - 1] + ((cuts[k] - cuts[k - 1]) * j) / n);
    }
    for (let k = 0; k + 1 < bounds.length; k++) {
      const a = Math.round(bounds[k] * FPS), b = Math.round(bounds[k + 1] * FPS);
      if (a >= b) continue;
      const near = L.pages.filter((q) => q.start < b / FPS + MARGIN && q.end > a / FPS - MARGIN).map((q) => pageKey[q.id]);
      segs.push({ a, b, out: path.join(chunkDir, `seg-${digest(shared, a, b, near)}.mp4`) });
    }
  }
  const todo = segs.filter((g) => !fs.existsSync(g.out));
  for (const f of fs.readdirSync(chunkDir)) if (!segs.some((g) => path.basename(g.out) === f)) fs.rmSync(path.join(chunkDir, f), { force: true });
  console.log(`segments: ${segs.length - todo.length}/${segs.length} reused`);
  // the segments to draw, spread over the workers by frame count; each worker draws its list in one browser
  const groups = Array.from({ length: Math.min(W, todo.length) }, () => ({ frames: 0, jobs: [] }));
  for (const g of [...todo].sort((x, y) => (y.b - y.a) - (x.b - x.a))) { const w = groups.reduce((m, x) => (x.frames < m.frames ? x : m)); w.jobs.push(g); w.frames += g.b - g.a; }
  await Promise.all(groups.map((w, i) => {
    const list = path.join(chunkDir, `.jobs-${i}.json`);
    fs.writeFileSync(list, JSON.stringify(w.jobs.map((j) => ({ ...j, out: j.out + '.part.mp4' }))));
    return run(process.execPath, [path.join(dir, 'render-chunk.mjs'), '--jobs', list, FPS]).then(() => {
      for (const j of w.jobs) fs.renameSync(j.out + '.part.mp4', j.out);   // only a finished segment enters the cache
      fs.rmSync(list, { force: true });
    });
  }));
  fs.writeFileSync(path.join(chunkDir, 'list.txt'), segs.map((g) => `file '${g.out}'`).join('\n'));
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(chunkDir, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', nosub]);
  console.timeEnd('video');
}
// narration (voice.js): every cue's clip placed at its start → one loudness-normalized track, muxed into the silent video
const voiced = L.pages.flatMap((p) => p.cues).filter((c) => c.audio);
const hasSfx = L.pages.some((p) => p.sfx && p.sfx.length);
if (hasSfx && fs.existsSync(nosub)) {
  // narration + sound effects / music beds (page.sfx) → stereo mix
  console.time('audio');
  const raw = path.join(OUT, 'mix.f32');
  mixTrack(TIMING, L, from, to, raw, EP);
  const tmp = nosub.replace(/\.mp4$/, '.tmp.mp4');
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', nosub, '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', raw, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=14', '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, nosub);
  console.timeEnd('audio');
} else if (voiced.length && fs.existsSync(nosub)) {
  console.time('audio');
  const SR = 24000, pcm = new Int16Array(Math.ceil((to - from) * SR));
  for (const c of voiced) {
    const b = execFileSync(FFMPEG, ['-loglevel', 'error', '-i', path.join(process.cwd(), c.audio), '-f', 's16le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
    const clip = new Int16Array(b.buffer, b.byteOffset, b.length >> 1), at = Math.round(((c.audioAt ?? c.start) - from) * SR);
    for (let i = 0; i < clip.length; i++) { const j = at + i; if (j >= 0 && j < pcm.length) pcm[j] = Math.max(-32768, Math.min(32767, pcm[j] + clip[i])); }
  }
  const wav = path.join(OUT, 'voice.wav'), head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length * 2, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length * 2, 40);
  fs.writeFileSync(wav, Buffer.concat([head, Buffer.from(pcm.buffer)]));
  const tmp = nosub.replace(/\.mp4$/, '.tmp.mp4');
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', nosub, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, nosub);
  console.timeEnd('audio');
}
if (!has('skip-subs')) {
  console.time('subs');
  await run(process.execPath, [path.join(dir, 'subs.mjs'), String(from), String(to)]);
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', nosub, '-f', 'concat', '-safe', '0', '-i', path.join(OUT, (PORTRAIT ? 'subs-portrait' : 'subs') + '/list.txt'),
    '-filter_complex', `[1:v]fps=${FPS},format=rgba[s];[0:v][s]overlay=0:0:format=auto:shortest=1,format=yuv420p[v]`,
    '-map', '[v]', '-map', '0:a?', '-c:a', 'copy', ...(has('hw') ? ['-c:v', 'h264_videotoolbox', '-q:v', '72'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16']), '-r', String(FPS), '-movflags', '+faststart', withsub]);
  console.timeEnd('subs');
}
const dur = async (f) => probe(f).duration;
for (const f of [nosub, withsub]) {
  if (!fs.existsSync(f)) continue;
  const d = await dur(f);
  const ok = Math.abs(d - (to - from)) < 1;
  console.log(`${ok ? '✓' : '✗ 时长不对'} ${path.basename(f)}  ${d.toFixed(1)}s（应为 ${(to - from).toFixed(1)}s）`);
  if (!ok) process.exitCode = 1;
}
