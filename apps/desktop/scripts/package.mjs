// Packages the desktop app: node apps/desktop/scripts/package.mjs [--dir]
//   1. builds every workspace package;
//   2. assembles release/app: the main process as one esbuild bundle (with the core, the agent, models, voices and the
//      SDKs they use), the engine and the panel as they publish themselves, and, installed by npm into a flat
//      node_modules, only what the engine needs on disk (browser libraries, fonts, Playwright), trimmed to the files used;
//   3. renders the app icon from docs/brand/frametell-app-icon.svg;
//   4. puts a redistributable ffmpeg in Resources/bin (pinned, checksummed, and refused if it has nonfree parts);
//   5. runs electron-builder on it → release/Frametell-<version>-<arch>.dmg (or, with --dir, just the .app).
// The app is signed ad hoc only, not with a Developer ID: macOS asks the first time it is opened (System Settings →
// Privacy & Security → 仍要打开 / Open Anyway).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(DESKTOP, '../..');
const RELEASE = path.join(DESKTOP, 'release');
const APP = path.join(RELEASE, 'app');
const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));
const run = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/' } });

run('pnpm', ['-r', 'build']);
fs.rmSync(RELEASE, { recursive: true, force: true });
// a flat node_modules with real directories: the engine's files are read by Chromium from disk, and projects link to them.
// The engine's own dependencies are the only ones installed; ffmpeg comes from step 4 (ffmpeg-static's macOS binary is
// built with --enable-nonfree and may not be redistributed).
const SKIP = new Set(['ffmpeg-static']);
const read = (dir) => JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8'));
const engine = read('packages/engine');
const deps = Object.fromEntries(Object.entries(engine.dependencies).filter(([k]) => !SKIP.has(k)));
fs.mkdirSync(APP, { recursive: true });
fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify({ name: 'frametell', productName: 'Frametell', version: pkg.version, description: pkg.description, license: pkg.license, author: 'Sitor Team', type: 'module', main: pkg.main, dependencies: deps }, null, 2));
run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], APP);

// fonts: keep the stylesheets boot.js loads and the font files they point at, drop every other weight and subset
const NM = path.join(APP, 'node_modules');
const usedCss = [...fs.readFileSync(path.join(ROOT, 'packages/engine/boot.js'), 'utf8').matchAll(/'((?:@fontsource\/[\w-]+|lxgw-wenkai-webfont)\/[\w.-]+\.css)'/g)].map((m) => m[1]);
for (const dir of new Set(usedCss.map((c) => c.split('/').slice(0, c.startsWith('@') ? 2 : 1).join('/')))) {
  const keep = new Set(['package.json', 'LICENSE', 'OFL.txt']);
  for (const css of usedCss.filter((c) => c.startsWith(dir + '/'))) {
    const rel = css.slice(dir.length + 1);
    keep.add(rel);
    for (const m of fs.readFileSync(path.join(NM, css), 'utf8').matchAll(/url\(['"]?\.\/([^'")]+)['"]?\)/g)) keep.add(m[1]);
  }
  const walk = (d) => { for (const f of fs.readdirSync(path.join(NM, dir, d))) { const r = d ? `${d}/${f}` : f; if (fs.statSync(path.join(NM, dir, r)).isDirectory()) { walk(r); if (!fs.readdirSync(path.join(NM, dir, r)).length) fs.rmdirSync(path.join(NM, dir, r)); } else if (!keep.has(r)) fs.rmSync(path.join(NM, dir, r)); } };
  walk('');
}

// our packages: the engine and the panel as they publish themselves (links, e.g. a style example's engine/, are left
// out); of the agent and the voices only what their bundled code reads from disk — prompts, voice samples
const copy = (dir, files, name) => {
  const src = path.join(ROOT, dir), p = read(dir), out = path.join(NM, '@frametell', name);
  for (const f of files ?? p.files ?? []) fs.cpSync(path.join(src, f), path.join(out, f), { recursive: true, filter: (f) => !fs.lstatSync(f).isSymbolicLink() && !/[\\/]out$/.test(f) });
  delete p.devDependencies; delete p.scripts;
  fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ ...p, dependencies: {} }, null, 2));
};
copy('packages/engine', null, 'engine');
copy('packages/ui', null, 'ui');
copy('packages/agent', ['prompts'], 'agent');
copy('packages/voice', ['samples'], 'voice');

// the main process: one minified ESM file. bins.js stays its own module and is imported first, so FFMPEG_PATH is set
// before the engine (external, read from disk) loads
const esbuild = createRequire(path.join(ROOT, 'packages/engine/package.json'))('esbuild');
fs.mkdirSync(path.join(APP, 'dist'), { recursive: true });
await esbuild.build({
  entryPoints: [path.join(DESKTOP, 'dist/main.js')], outfile: path.join(APP, 'dist/main.js'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', minify: true, legalComments: 'linked', logLevel: 'warning',
  external: ['electron', '@frametell/engine', '@frametell/engine/*', '@frametell/ui', '@frametell/ui/*', 'playwright-core', 'ffmpeg-static', './bins.js'],
  // CommonJS dependencies inside the bundle call require
  banner: { js: "import { createRequire as __frametellRequire } from 'node:module'; const require = __frametellRequire(import.meta.url);" },
});
fs.copyFileSync(path.join(DESKTOP, 'dist/bins.js'), path.join(APP, 'dist/bins.js'));
fs.mkdirSync(path.join(APP, 'src'), { recursive: true });
fs.copyFileSync(path.join(DESKTOP, 'src/preload.cjs'), path.join(APP, 'src/preload.cjs'));

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

// ffmpeg: a static GPLv3 build (no nonfree parts), shipped as a separate program beside the app with its licence and
// where its source is. FRAMETELL_FFMPEG=/path/to/ffmpeg uses a binary of your own instead (Windows has no pinned build yet).
const FFMPEG_BUILDS = {
  'darwin-arm64': { url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip', sha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924' },
  'darwin-x64': { url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip', sha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4' },
};
const bin = path.join(build, 'bin'), exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
fs.mkdirSync(bin, { recursive: true });
if (process.env.FRAMETELL_FFMPEG) fs.copyFileSync(process.env.FRAMETELL_FFMPEG, path.join(bin, exe));
else {
  const key = `${process.platform}-${process.arch}`, b = FFMPEG_BUILDS[key];
  if (!b) throw new Error(`no pinned ffmpeg for ${key}: set FRAMETELL_FFMPEG to a redistributable (LGPL or GPL, not nonfree) build`);
  const cache = path.join(DESKTOP, 'node_modules/.cache/frametell-ffmpeg', path.basename(path.dirname(b.url)) + '-' + key + '.zip');
  if (!fs.existsSync(cache)) {
    console.log(`downloading ffmpeg for ${key}…`);
    const res = await fetch(b.url);
    if (!res.ok) throw new Error(`ffmpeg download failed: ${res.status} ${b.url}`);
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, Buffer.from(await res.arrayBuffer()));
  }
  const sum = createHash('sha256').update(fs.readFileSync(cache)).digest('hex');
  if (sum !== b.sha256) { fs.rmSync(cache); throw new Error(`ffmpeg checksum mismatch for ${b.url}: ${sum}`); }
  execFileSync('unzip', ['-o', '-q', cache, exe, '-d', bin]);
}
fs.chmodSync(path.join(bin, exe), 0o755);
const ff = (args) => spawnSync(path.join(bin, exe), ['-hide_banner', ...args], { encoding: 'utf8' });
const licence = ff(['-L']).stdout || '';
if (!licence) throw new Error('the bundled ffmpeg does not run');
if (/nonfree|not legally redistributable/i.test(licence)) throw new Error('the bundled ffmpeg has nonfree parts and may not be redistributed');
const gpl = /GNU General Public License/.test(licence);
fs.writeFileSync(path.join(bin, 'FFMPEG-NOTICE.txt'), [
  'Frametell runs this ffmpeg as a separate program; it is not part of Frametell and keeps its own licence.',
  '', ff(['-version']).stdout.split('\n')[0], '', licence.trim(), '',
  `Built with: ${(ff(['-buildconf']).stdout || '').replace(/\s+/g, ' ').trim()}`, '',
  'Source: https://ffmpeg.org/releases/ (FFmpeg) and https://git.martin-riedl.de/ffmpeg/build-script (the build and its libraries).',
].join('\n'));
if (gpl) fs.copyFileSync(require.resolve('ffmpeg-static/LICENSE'), path.join(bin, 'COPYING.GPLv3'));

const config = {
  appId: 'ai.sitor.frametell',
  productName: 'Frametell',
  copyright: 'Copyright © Sitor Team',
  electronVersion: pkg.devDependencies.electron,
  directories: { app: APP, output: RELEASE, buildResources: build },
  // no asar: the engine's runtime, fonts and ffmpeg are used straight from disk
  asar: false,
  npmRebuild: false,
  // the panel speaks Chinese and English; Chromium's other locales are not needed
  electronLanguages: ['en', 'zh_CN', 'zh_TW'],
  // node_modules goes in as it is: electron-builder would keep only what package.json lists, dropping our own packages
  files: ['**/*', '!node_modules{,/**}'],
  extraResources: [{ from: path.join(APP, 'node_modules'), to: 'app/node_modules', filter: ['**/*', '!**/*.map', '!**/*.d.ts', '!.bin{,/**}', '!.package-lock.json'] }, { from: bin, to: 'bin' }],
  mac: { category: 'public.app-category.video', icon: path.join(build, 'icon.icns'), target: process.argv.includes('--dir') ? ['dir'] : ['dmg'], identity: null },
  // no Developer ID yet: signed ad hoc after packing (see adhoc-sign.cjs), or a downloaded copy reports itself damaged
  afterPack: path.join(DESKTOP, 'scripts', 'adhoc-sign.cjs'),
  dmg: { title: 'Frametell ${version}' },
  win: { target: ['nsis'], icon: path.join(build, 'icon.png') },
  artifactName: 'Frametell-${version}-${arch}.${ext}',
};
fs.writeFileSync(path.join(build, 'electron-builder.json'), JSON.stringify(config, null, 2));
run(path.join(DESKTOP, 'node_modules/.bin/electron-builder'), ['--config', path.join(build, 'electron-builder.json'), '--publish', 'never'], DESKTOP);
console.log(`\nreleased to ${RELEASE}`);
