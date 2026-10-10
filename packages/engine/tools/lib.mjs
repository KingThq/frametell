// Shared by every tool: the episode dir is the current working directory (run tools from inside an episode).
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { createRequire } from 'module';

export const KIT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const EP = process.cwd();
export const OUT = path.join(EP, 'out');
/** Portrait canvas (1080×1920, pages-portrait/): `--portrait` on any tool, or PORTRAIT=1 (render.mjs passes it to its children). Default is landscape. */
export const PORTRAIT = process.argv.includes('--portrait') || process.env.PORTRAIT === '1';
export const SIZE = PORTRAIT ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
import { findChrome } from './bins.mjs';
export const { chromium } = createRequire(import.meta.url)('playwright-core');

if (!fs.existsSync(path.join(EP, 'script.js'))) {
  console.error(`没有找到 ${path.join(EP, 'script.js')} —— 请在视频项目目录里运行。`);
  process.exit(1);
}

/** Runs timing.js + the episode's script.js in node → { TIMING, SCRIPT, META, L (layout) }. */
export function loadEpisode() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(KIT, 'runtime/timing.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(EP, 'script.js'), 'utf8'), ctx);
  if (ctx.SCRIPT.META?.voice && fs.existsSync(path.join(EP, 'voice.js'))) vm.runInContext(fs.readFileSync(path.join(EP, 'voice.js'), 'utf8'), ctx);
  const { TIMING, SCRIPT } = ctx;
  return { TIMING, SCRIPT, META: SCRIPT.META || {}, L: TIMING.layout(SCRIPT.PAGES, { ...(SCRIPT.META || {}), voice: SCRIPT.VOICE }) };
}

export const pageUrl = (query) => 'file://' + path.join(EP, 'index.html') + '?' + query + (PORTRAIT ? '&portrait' : '');

/** Opens a 1920×1080 (or 1080×1920 portrait) page on the episode and waits until fonts are loaded and pages are built. */
export async function openStage(query, launchArgs = []) {
  // META.webgl: the episode paints with WebGL (p5.brush) → use the Mac's GPU through Metal instead of software GL
  const gl = loadEpisode().META.webgl ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : [];
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...launchArgs, ...gl] });
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) console.error('console', m.text()); });
  const missing = [];
  page.on('requestfailed', (r) => {
    const u = decodeURIComponent(r.url());
    if (/\/pages\/p\w+\.js$/.test(u)) missing.push(path.basename(u, '.js'));
    else console.error('加载失败', u);
  });
  await page.goto(pageUrl(query), { timeout: 120000 });
  if (missing.length) console.log(`还没写画面的页（显示为标题）：${missing.join(' ')}`);
  const duration = await page.evaluate(() => window.__ready);
  return { browser, page, duration };
}

/** close a stage's browser without ever hanging: Playwright's close() can stall after system Chrome has already exited */
export const closeStage = (browser, ms = 5000) => Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
