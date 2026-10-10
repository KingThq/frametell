// Stills for checking a page. Usage (from an episode dir): node ../../kit/tools/snap.mjs [--only p01,p02] [--subs] [--sheet name] 1.5 4 6.4 ...
//   add --portrait for the portrait canvas (pages-portrait/)
// → out/snap/snap-<t>.png, or with --sheet one contact sheet out/snap/<name>.jpg (3 per row, each frame labelled with its time)
import fs from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { openStage, OUT, PORTRAIT } from './lib.mjs';
import { FFMPEG } from './bins.mjs';
const args = process.argv.slice(2).filter((a) => a !== '--portrait');
const oi = args.indexOf('--only');
const only = oi >= 0 ? args.splice(oi, 2)[1] : null;
const si = args.indexOf('--subs');
const subs = si >= 0 ? (args.splice(si, 1), true) : false;
const hi = args.indexOf('--sheet');
const sheet = hi >= 0 ? args.splice(hi, 2)[1] : null;
const bad = args.filter((a) => !Number.isFinite(Number(a)));
if (bad.length || !args.length) { console.error(`时刻参数不对：${bad.join(' ') || '（没有给时刻）'}`); process.exit(1); }
const dir = path.join(OUT, 'snap');
fs.mkdirSync(dir, { recursive: true });
const { browser, page, duration } = await openStage('render' + (only ? '&only=' + only : '') + (subs ? '&subs' : ''));
console.log('duration', duration.toFixed(1));
const shots = [];
for (const t of args.map(Number)) {
  await page.evaluate(async (x) => { ENGINE.renderAt(x); if (window.__frameReady) await window.__frameReady(x); }, t);
  if (sheet) await page.evaluate((x) => {
    const tag = document.getElementById('__t') || Object.assign(document.createElement('div'), { id: '__t' });
    Object.assign(tag.style, { position: 'absolute', left: '16px', bottom: '12px', zIndex: 99, font: '700 44px monospace', color: '#B2452F', background: '#fffc', padding: '2px 12px' });
    tag.textContent = x.toFixed(1) + 's';
    document.getElementById('frame').appendChild(tag);
  }, t);
  const f = path.join(dir, sheet ? `.${sheet}-${String(shots.length).padStart(3, '0')}.png` : `snap-${t}.png`);
  await page.screenshot({ path: f });
  shots.push(f);
  if (!sheet) console.log(f);
}
await browser.close();
if (sheet) {
  const out = path.join(dir, sheet + '.jpg'), cols = Math.min(3, shots.length);
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', path.join(dir, `.${sheet}-%03d.png`), '-vf', `scale=${PORTRAIT ? 270 : (+process.env.SNAP_TILE || 640)}:-1,tile=${cols}x${Math.ceil(shots.length / cols)}:padding=6:color=white`, '-frames:v', '1', out]);
  for (const f of shots) fs.rmSync(f);
  console.log(out);
}
