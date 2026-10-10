// Renders frames [f0, f1) at FPS to an mp4 chunk. Usage (from an episode dir): node ../../kit/tools/render-chunk.mjs <f0> <f1> <fps> <out.mp4>
// HW=1 (render.mjs --hw): encode on the Mac's media engine (h264_videotoolbox) so every CPU core is left for the browsers.
import { spawn } from 'child_process';
import path from 'path';
import { openStage } from './lib.mjs';
import { FFMPEG } from './bins.mjs';
const [f0, f1, fps, out] = [+process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];

const { browser, page } = await openStage('render', ['--disable-gpu-vsync', '--force-color-profile=srgb']);
const enc = process.env.HW === '1' ? ['-c:v', 'h264_videotoolbox', '-q:v', '72', '-realtime', '0'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16'];
const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
  ...enc, '-pix_fmt', 'yuv420p', '-r', String(fps), out], { stdio: ['pipe', 'inherit', 'inherit'] });
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
await browser.close();
