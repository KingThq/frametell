// Entry of the render image: point a project at this engine, then render it.
//   node render.mjs <project dir> [flags for engine/tools/render.mjs]
// The project's engine/ and engine_modules/ links are replaced with links to the engine in the image.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { linkProject } from './engine/tools/project.mjs';

const [dir, ...flags] = process.argv.slice(2);
if (!dir) { console.error('usage: render.mjs <project dir> [render flags]'); process.exit(2); }
const project = path.resolve(dir);
linkProject(project);
const child = spawn(process.execPath, [path.join(project, 'engine/tools/render.mjs'), ...flags], { cwd: project, stdio: 'inherit' });
child.on('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
