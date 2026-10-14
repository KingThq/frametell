// Every git the studio runs goes through here (a test fails on any other). The studio's git runs outside the agent's
// sandbox, as this process's user, in a folder the agent writes; what git reads there must not run anything.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';

/** a hooks folder that can never exist on any platform: a path below a file (this program) is never a folder, so no
 *  one, the agent included, can put a hook there. /dev/null is no folder on Windows, and NUL there is a name the agent
 *  could create as a folder of its project on Linux and macOS */
const NO_HOOKS = path.join(process.execPath, 'no-hooks');

/** what every studio git is run with: no fsmonitor command (git runs it on every add and status, and a repo's own
 *  config can name any program) and no hooks. Given on the command line, they also reach the gits git starts itself,
 *  and override any config file */
export const GIT_SAFE = ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${NO_HOOKS}`];

type Env = Record<string, string | undefined>;
export const gitSync = (cwd: string | undefined, args: string[], env?: Env) =>
  spawnSync('git', [...GIT_SAFE, ...args], { cwd, encoding: 'utf8', env, timeout: 120_000 });

export const gitAsync = (cwd: string, args: string[], env?: Env) =>
  new Promise<{ status: number; stdout: string }>((ok) => execFile('git', [...GIT_SAFE, ...args], { cwd, encoding: 'utf8', maxBuffer: 16 << 20, env, timeout: 120_000 }, (e, stdout) => ok({ status: e ? 1 : 0, stdout: stdout || '' })));

/**
 * Removes every `.git` below `root` (a folder, a file with `gitdir:` pointing anywhere, or a link), case-insensitively
 * (macOS and Windows find `.GIT` as `.git`). A repo inside the project is one git looks into with its own config: on
 * the next commit the studio's git checks whether it changed, and its config (core.fsmonitor, a clean filter for its
 * .gitattributes) runs a program outside the sandbox. The agent has no use for one. Links are not followed: the
 * project's own engine links, or one the agent made to /, are not walked. Returns what was removed.
 */
export function removeNestedRepos(root: string, warn: (msg: string) => void = (m) => console.warn(m)): string[] {
  const removed: string[] = [];
  const walk = (dir: string, top: boolean) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.name.toLowerCase() === '.git') {
        if (top) continue;   // the project's own history (read-only to the agent)
        fs.rmSync(p, { recursive: true, force: true });
        removed.push(path.relative(root, p));
        warn(`frametell: removed a git repository planted in the project: ${path.relative(root, p)}`);
      } else if (e.isDirectory()) walk(p, false);
    }
  };
  walk(root, true);
  return removed;
}

/** the index's gitlinks (mode 160000: an embedded repo or submodule), which commit and status look into */
const gitlinks = async (dir: string, env?: Env) =>
  (await gitAsync(dir, ['ls-files', '-s', '-z'], env)).stdout.split('\0').filter((l) => l.startsWith('160000 ')).map((l) => l.slice(l.indexOf('\t') + 1));
const dropGitlinks = async (dir: string, env?: Env) => {
  const links = await gitlinks(dir, env);
  if (links.length) await gitAsync(dir, ['update-index', '--force-remove', '--', ...links], env);
  return links;
};
const gitlinksSync = (dir: string, env?: Env) =>
  (gitSync(dir, ['ls-files', '-s', '-z'], env).stdout || '').split('\0').filter((l) => l.startsWith('160000 ')).map((l) => l.slice(l.indexOf('\t') + 1));

/**
 * Stages everything in the project, so that git never looks into a repo nested in it: none is left on disk, the index
 * holds no gitlink when `add` runs (an old one included), and none is left when the commit runs (one planted between
 * the sweep and `add` is added as a gitlink by reading its HEAD only, and is taken out again here).
 */
export async function stageAll(dir: string, env?: Env) {
  removeNestedRepos(dir);
  await dropGitlinks(dir, env);
  await gitAsync(dir, ['add', '-A'], env);
  await dropGitlinks(dir, env);
}
export function stageAllSync(dir: string, env?: Env) {
  removeNestedRepos(dir);
  const drop = () => { const l = gitlinksSync(dir, env); if (l.length) gitSync(dir, ['update-index', '--force-remove', '--', ...l], env); };
  drop();
  gitSync(dir, ['add', '-A'], env);
  drop();
}
