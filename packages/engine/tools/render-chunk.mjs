// Renders frames [f0, f1) at FPS to an mp4 chunk. Usage (from a project dir): node engine/tools/render-chunk.mjs <f0> <f1> <fps> <out.mp4>
//   or: render-chunk.mjs --jobs <list.json> <fps> — several chunks [{ a, b, out }] in one browser, one after another
// HW=1 (render.mjs --hw): encode on the Mac's media engine (h264_videotoolbox) so every CPU core is left for the browsers.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { openStage, closeStage } from './lib.mjs';
import { FFMPEG } from './bins.mjs';
const jobsMode = process.argv[2] === '--jobs';
const fps = +process.argv[4];
const jobs = jobsMode ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : [{ a: +process.argv[2], b: +process.argv[3], out: process.argv[5] }];

const { browser, page } = await openStage('render', ['--disable-gpu-vsync', '--force-color-profile=srgb']);
const enc = process.env.HW === '1' ? ['-c:v', 'h264_videotoolbox', '-q:v', '72', '-realtime', '0'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16'];
let code = 0;
for (const { a: f0, b: f1, out } of jobs) {
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    ...enc, '-pix_fmt', 'yuv420p', '-r', String(fps), '-f', 'mp4', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = f0; f < f1; f++) {
    // window.__frameReady (optional, set by an episode's extras): wait until everything this frame needs (e.g. images) is ready
    await page.evaluate(async (t) => { ENGINE.renderAt(t); if (window.__frameReady) await window.__frameReady(t); }, f / fps);
    const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if ((f - f0) % 600 === 0) console.log(`[${path.basename(out)}] ${f - f0}/${f1 - f0}  ${((Date.now() - t0) / 1000) | 0}s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  if (ff.exitCode) { code = ff.exitCode; break; }
}
// a page whose code threw draws a placeholder: never let that into a film
const thrown = await page.evaluate(() => ENGINE.errors);
if (thrown.length) { for (const x of thrown) console.error(`✗ ${x.page} runtime error (${x.phase}): ${x.message}${x.at.length ? ` — at ${x.at.join(', ')}` : ''}`); code = code || 2; }
// browser.close() can hang after Chrome has already gone (seen with system Chrome): the chunk is written, so never wait on it
await closeStage(browser);
process.exit(code);
