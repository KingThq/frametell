// Parallel render → out/<name>-无字幕.mp4, then burn subtitles → out/<name>-有字幕.mp4. Run from an episode dir:
// node ../../kit/tools/render.mjs [--portrait] [--hw] [--fps 60]
//   --hw: hardware H.264 (Apple media engine) for chunks and the subtitle pass — frees the CPU for the browsers; slightly larger files [--workers 12] [--from 0] [--to <end>] [--name <file name>] [--skip-video] [--skip-subs]
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { loadEpisode, OUT, PORTRAIT, EP } from './lib.mjs';
import { mixTrack } from './mix.mjs';
import { FFMPEG, FFPROBE } from './bins.mjs';
const dir = path.dirname(new URL(import.meta.url).pathname);
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
const FPS = +arg('fps', 60), W = +arg('workers', 12), name = arg('name', META.name || 'video') + (PORTRAIT ? '-竖版' : '');
const from = +arg('from', 0), to = +arg('to', L.duration);
const F0 = Math.round(from * FPS), F1 = Math.round(to * FPS);
const chunkDir = path.join(OUT, PORTRAIT ? 'chunks-portrait' : 'chunks');
fs.mkdirSync(chunkDir, { recursive: true });

// one render per episode at a time: two runs share out/chunks and would overwrite each other's chunks
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
const nosub = path.join(OUT, `${name}-无字幕.mp4`), withsub = path.join(OUT, `${name}-有字幕.mp4`);

if (!has('skip-video')) {
  console.time('video');
  for (const f of fs.readdirSync(chunkDir)) fs.rmSync(path.join(chunkDir, f));
  const per = Math.ceil((F1 - F0) / W), jobs = [];
  for (let i = 0; i < W; i++) {
    const a = F0 + i * per, b = Math.min(F1, a + per);
    if (a >= b) break;
    jobs.push({ a, b, out: path.join(chunkDir, `chunk-${String(i).padStart(2, '0')}.mp4`) });
  }
  await Promise.all(jobs.map((j) => run(process.execPath, [path.join(dir, 'render-chunk.mjs'), j.a, j.b, FPS, j.out])));
  fs.writeFileSync(path.join(chunkDir, 'list.txt'), jobs.map((j) => `file '${j.out}'`).join('\n'));
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
const dur = (f) => new Promise((res) => { let o = ''; spawn(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout.on('data', (d) => (o += d)).on('end', () => res(+o)); });
for (const f of [nosub, withsub]) {
  if (!fs.existsSync(f)) continue;
  const d = await dur(f);
  const ok = Math.abs(d - (to - from)) < 1;
  console.log(`${ok ? '✓' : '✗ 时长不对'} ${path.basename(f)}  ${d.toFixed(1)}s（应为 ${(to - from).toFixed(1)}s）`);
  if (!ok) process.exitCode = 1;
}
