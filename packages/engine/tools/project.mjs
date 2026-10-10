// Creating and linking video projects. A project reaches the engine through two directory links that Studio maintains:
//   engine/          → this package (runtime, styles, lib, tools)
//   engine_modules/  → the node_modules directory that holds the engine's browser libraries and fonts
// Links are junctions on Windows (no admin rights needed) and symlinks elsewhere; both work for file:// and HTTP.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

export const ENGINE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(path.join(ENGINE_DIR, 'package.json'));

/** The node_modules directory that contains the engine's browser dependencies (npm hoists them, pnpm keeps them local). */
export function engineModulesDir() {
  // pnpm (and a plain install of the engine) keeps a node_modules next to the package with every dependency linked in
  const own = path.join(ENGINE_DIR, 'node_modules');
  if (fs.existsSync(path.join(own, 'roughjs')) && fs.existsSync(path.join(own, 'lxgw-wenkai-webfont'))) return own;
  // npm hoists dependencies: the directory that holds roughjs holds the others too (resolve keeps the link path)
  return path.dirname(path.dirname(require.resolve('roughjs/package.json')));
}

function link(target, at) {
  try {
    const cur = fs.lstatSync(at);
    if (cur.isSymbolicLink() && path.resolve(path.dirname(at), fs.readlinkSync(at)) === target) return;
    fs.rmSync(at, { recursive: true, force: true });
  } catch {}
  fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
}

/** (Re)create the engine links inside a project directory; safe to call on every open (the engine may have moved). */
export function linkProject(dir) {
  link(ENGINE_DIR, path.join(dir, 'engine'));
  link(engineModulesDir(), path.join(dir, 'engine_modules'));
}

/** Scaffold a new project from the template. */
export function createProject(dir, { title = '未命名视频', style = 'study' } = {}) {
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  for (const f of ['index.html', 'script.js', 'pages/p01.js']) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, 'template', f), 'utf8');
    fs.writeFileSync(path.join(dir, f), src.replaceAll('__TITLE__', title).replace("  const META = {", `  const META = {\n    style: '${style}',`));
  }
  fs.writeFileSync(path.join(dir, '.gitignore'), 'engine\nengine_modules\nout/\n.studio/\n');
  linkProject(dir);
}
