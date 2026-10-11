// Packages the desktop app: node apps/desktop/scripts/package.mjs [--dir]
//   1. builds every workspace package;
//   2. assembles release/app: the desktop shell, our own packages (what each publishes) and, installed by npm into a flat
//      node_modules, the third-party packages they need at run time;
//   3. renders the app icon from docs/brand/frametell-app-icon.svg;
//   4. runs electron-builder on it → release/Frametell-<version>-<arch>.dmg (or, with --dir, just the .app).
// The app is not signed yet: macOS asks the first time it is opened (right-click → Open).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const DESKTOP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ROOT = path.resolve(DESKTOP, '../..');
const RELEASE = path.join(DESKTOP, 'release');
const APP = path.join(RELEASE, 'app');
const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));
const run = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/' } });

run('pnpm', ['-r', 'build']);
fs.rmSync(RELEASE, { recursive: true, force: true });
// a flat node_modules with real directories: the engine's files are read by Chromium from disk, and projects link to them
const OURS = { core: 'packages/core', agent: 'packages/agent', models: 'packages/models', voice: 'packages/voice', engine: 'packages/engine', ui: 'packages/ui' };
// the UI's dependencies are bundled into its dist; the parked runtimes are not loaded by the app
const SKIP = new Set(['@anthropic-ai/claude-agent-sdk', '@openai/codex-sdk']);
const deps = {}, ours = [];
for (const [name, dir] of Object.entries(OURS)) {
  const src = path.join(ROOT, dir), p = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
  if (name !== 'ui') for (const [k, v] of Object.entries(p.dependencies || {})) if (!v.startsWith('workspace:') && !SKIP.has(k)) deps[k] ??= v;
  ours.push([name, src, p]);
}
fs.mkdirSync(APP, { recursive: true });
fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify({ name: 'frametell', productName: 'Frametell', version: pkg.version, description: pkg.description, license: pkg.license, author: 'Sitor Team', type: 'module', main: pkg.main, dependencies: deps }, null, 2));
run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], APP);
// then our own packages, as each publishes itself (its "files"); links (a style example's engine/ → the engine) are left out
for (const [name, src, p] of ours) {
  const out = path.join(APP, 'node_modules/@frametell', name);
  for (const f of p.files || []) fs.cpSync(path.join(src, f), path.join(out, f), { recursive: true, filter: (f) => !fs.lstatSync(f).isSymbolicLink() && !/[\\/]out$/.test(f) });
  delete p.devDependencies; delete p.scripts;
  fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ ...p, dependencies: {} }, null, 2));
}
for (const f of ['dist', 'src/preload.cjs']) fs.cpSync(path.join(DESKTOP, f), path.join(APP, f), { recursive: true });

// icon: the brand svg drawn by the system browser at 1024 px, then an .icns from the usual sizes
const require = createRequire(path.join(ROOT, 'packages/engine/package.json'));
const { chromium } = require('playwright-core');
const { findChrome } = await import(path.join(ROOT, 'packages/engine/tools/bins.mjs'));
const build = path.join(RELEASE, 'build');
fs.mkdirSync(build, { recursive: true });
const browser = await chromium.launch({ executablePath: findChrome() });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${fs.readFileSync(path.join(ROOT, 'docs/brand/frametell-app-icon.svg'), 'utf8').replace('<svg ', '<svg width="1024" height="1024" ')}`);
await page.screenshot({ path: path.join(build, 'icon.png'), omitBackground: true });
await browser.close();
if (process.platform === 'darwin') {
  const set = path.join(build, 'icon.iconset');
  fs.mkdirSync(set, { recursive: true });
  for (const s of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(s), String(s), path.join(build, 'icon.png'), '--out', path.join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' });
    execFileSync('sips', ['-z', String(s * 2), String(s * 2), path.join(build, 'icon.png'), '--out', path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' });
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(build, 'icon.icns')]);
}

const config = {
  appId: 'ai.sitor.frametell',
  productName: 'Frametell',
  copyright: 'Copyright © Sitor Team',
  electronVersion: pkg.devDependencies.electron,
  directories: { app: APP, output: RELEASE, buildResources: build },
  // no asar: the engine's runtime, fonts and ffmpeg are used straight from disk
  asar: false,
  npmRebuild: false,
  // node_modules goes in as it is: electron-builder would keep only what package.json lists, dropping our own packages
  files: ['**/*', '!node_modules{,/**}'],
  extraResources: [{ from: path.join(APP, 'node_modules'), to: 'app/node_modules', filter: ['**/*', '!**/*.map', '!**/*.d.ts', '!.bin{,/**}', '!.package-lock.json'] }],
  mac: { category: 'public.app-category.video', icon: path.join(build, 'icon.icns'), target: process.argv.includes('--dir') ? ['dir'] : ['dmg'], identity: null },
  dmg: { title: 'Frametell ${version}' },
  win: { target: ['nsis'], icon: path.join(build, 'icon.png') },
  artifactName: 'Frametell-${version}-${arch}.${ext}',
};
fs.writeFileSync(path.join(build, 'electron-builder.json'), JSON.stringify(config, null, 2));
run(path.join(DESKTOP, 'node_modules/.bin/electron-builder'), ['--config', path.join(build, 'electron-builder.json'), '--publish', 'never'], DESKTOP);
console.log(`\nreleased to ${RELEASE}`);
