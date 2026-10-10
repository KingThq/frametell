// Film gate: reads only the finished mp4 (any source), so it judges what the viewer actually sees.
// Method adapted from huashu-art-motion's film_gate.py (MIT). Their thresholds were calibrated on 15-second art shorts;
// ours have no calibration set yet, so only factual defects gate and taste metrics are reported, never enforced.
//
// node engine/tools/film-gate.mjs out/video.mp4 [--json] [--sub-band 0.15]
// Exit code: 2 on a red gate, 1 when the file can't be read, 0 otherwise.
import fs from 'fs';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { FFMPEG, FFPROBE } from './bins.mjs';

const FPS = 12, W = 320;
const BLANK_GRAD = 24, BLANK_SHARE = 0.002, BLANK_EDGE_S = 0.5, BLANK_MIN_S = 0.3;
const STILL = 0.3, FAST = 9;

function probe(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'ffprobe failed');
  const j = JSON.parse(r.stdout);
  return { w: j.streams[0].width, h: j.streams[0].height, duration: +j.format.duration };
}

/** Grey frames at FPS, W wide, as Uint8Array views. */
function decode(file, h) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-vf', `fps=${FPS},scale=${W}:${h},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 2 ** 31 });
  if (r.status !== 0) throw new Error(String(r.stderr || 'ffmpeg failed'));
  const n = W * h, frames = [];
  for (let o = 0; o + n <= r.stdout.length; o += n) frames.push(new Uint8Array(r.stdout.buffer, r.stdout.byteOffset + o, n));
  return frames;
}

export function measure(file, { subBand = 0.15 } = {}) {
  const info = probe(file);
  const h = Math.round((W * info.h) / info.w / 2) * 2;
  const rows = Math.floor(h * (1 - subBand));            // ignore the subtitle band
  const F = decode(file, h);
  const n = F.length;

  // per frame: share of edge pixels (simple central-difference gradient)
  const edge = F.map((f) => {
    let e = 0, tot = 0;
    for (let y = 1; y < rows - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const g = Math.abs(f[i + 1] - f[i - 1]) + Math.abs(f[i + W] - f[i - W]);
      if (g > BLANK_GRAD) e++;
      tot++;
    }
    return e / tot;
  });
  // per pair: mean absolute grey difference
  const diff = [];
  for (let i = 1; i < n; i++) {
    let s = 0;
    const a = F[i - 1], b = F[i];
    for (let k = 0; k < rows * W; k++) s += Math.abs(a[k] - b[k]);
    diff.push(s / (rows * W));
  }
  // cut-like pairs: a spike well above the local median (transitions don't count as motion or as blank)
  const med = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[s.length >> 1] ?? 0; };
  const cut = diff.map((d, i) => d >= Math.max(8, 3 * med(diff.slice(Math.max(0, i - 6), i + 7)) + 2));
  const nearCut = (i) => cut[i - 1] || cut[i] || cut[i - 2];

  // gate: blank frames in the middle of the film (edges, not colour: a white board with thin strokes is not blank)
  const runs = [];
  let start = -1;
  const edgeFrames = Math.round(BLANK_EDGE_S * FPS);
  for (let i = 0; i <= n; i++) {
    const blank = i < n && i >= edgeFrames && i < n - edgeFrames && edge[i] < BLANK_SHARE && !nearCut(i);
    if (blank && start < 0) start = i;
    if (!blank && start >= 0) { const s = (i - start) / FPS; if (s >= BLANK_MIN_S) runs.push({ at: +(start / FPS).toFixed(1), seconds: +s.toFixed(1) }); start = -1; }
  }

  // reported only: motion profile
  const inShot = diff.filter((_, i) => !cut[i]);
  const fastRatio = inShot.length ? inShot.filter((d) => d >= FAST).length / inShot.length : 0;
  const stillRatio = inShot.length ? inShot.filter((d) => d < STILL).length / inShot.length : 0;
  let longest = 0, cur = 0;
  for (let i = 0; i < diff.length; i++) { cur = diff[i] < STILL ? cur + 1 : 0; longest = Math.max(longest, cur); }

  const gates = [{ key: 'blank', name: '中段空画面', level: runs.length ? 'red' : 'green', value: runs }];
  const report = [
    { key: 'fast_ratio', name: '快速运动帧占比', value: +fastRatio.toFixed(3), note: '衡量翻页式 PPT 感；尚未标定，只报告' },
    { key: 'still_ratio', name: '静止帧占比', value: +stillRatio.toFixed(3), note: '静止本身不是坏事，只报告' },
    { key: 'longest_still_s', name: '最长连续静止', value: +(longest / FPS).toFixed(1), unit: '秒', level: longest / FPS > 8 ? 'yellow' : 'green' },
  ];
  return { file, duration: info.duration, gates, report, red: gates.some((g) => g.level === 'red') };
}

// run as a CLI (also through the project's engine/ link)
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const file = process.argv[2];
  const i = process.argv.indexOf('--sub-band');
  let res;
  try { res = measure(file, { subBand: i > 0 ? +process.argv[i + 1] : 0.15 }); } catch (e) { console.error(`读不了 ${file}: ${e.message}`); process.exit(1); }
  if (process.argv.includes('--json')) console.log(JSON.stringify(res));
  else {
    console.log(`film-gate: ${res.red ? '红灯' : '通过'} · ${res.duration.toFixed(1)}s`);
    for (const g of res.gates) console.log(`  ${g.level === 'red' ? '✗' : '✓'} ${g.name}${g.value.length ? '：' + g.value.map((r) => `${r.at}s 起 ${r.seconds}s`).join('，') : ''}`);
    for (const r of res.report) console.log(`  · ${r.name} ${r.value}${r.unit || ''}${r.level === 'yellow' ? '（去看看这一段）' : ''}`);
  }
  process.exit(res.red ? 2 : 0);
}
