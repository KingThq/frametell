// The agent's shell, confined to its project. The file tools already refuse paths outside it, but a shell could read
// anything: a page agent unsure what a change meant went looking through other projects, other programs' temp folders
// and the whole home folder. Inside the sandbox the shell reads the project, the engine, Node and the system, and
// writes only the project and its own temp folder; the studio's record of the run (.studio/) is out of its reach.
//   macOS: Seatbelt (sandbox-exec). Linux: bubblewrap when installed (the hosted service installs it). Elsewhere, or
//   without either, the shell runs unconfined, unless FRAMETELL_SANDBOX_REQUIRED or FRAMETELL_SANDBOX_NONET is set.
// FRAMETELL_SANDBOX_HIDE adds folders to keep out (comma-separated): a hosted service names where every account's
// projects live, so one film's agent cannot read another's.
// FRAMETELL_SANDBOX_NONET=1 takes the network away too (and, under bubblewrap, every process but its own): the hosted
// sandbox, where any request that leaves is sent with the run's credential. FRAMETELL_SANDBOX_REQUIRED=1 makes a missing
// sandbox an error instead of a shell left unconfined; asking for no network implies it (no network is never left to chance).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const real = (p: string) => { try { return fs.realpathSync(p); } catch { return undefined; } };
const extraHidden = () => (process.env.FRAMETELL_SANDBOX_HIDE || '').split(',').map((s) => s.trim()).filter(Boolean);
const inside = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

/** what a tool run from the project needs to read besides it: the engine and its modules (pnpm links them from
 *  node_modules folders further up), and the Node that runs them (a version manager or the app keeps it in home) */
function readable(root: string): string[] {
  const out = new Set<string>();
  for (const link of ['engine', 'engine_modules']) {
    const r = real(path.join(root, link));
    if (!r) continue;
    out.add(r);
    // Node resolves a module through every node_modules above the file asking for it
    for (let d = r; d !== path.dirname(d); d = path.dirname(d)) if (fs.existsSync(path.join(d, 'node_modules'))) out.add(path.join(d, 'node_modules'));
  }
  const exe = real(process.execPath);
  if (exe) {
    const app = exe.match(/^(.*?\.app)\//)?.[1];   // an app bundle: its resources sit beside the executable
    out.add(app ?? path.dirname(path.dirname(exe)));
  }
  // certificates a network needs (a company proxy), which Node loads before anything else
  const ca = process.env.NODE_EXTRA_CA_CERTS && real(process.env.NODE_EXTRA_CA_CERTS);
  if (ca) out.add(ca);
  const res = (process as { resourcesPath?: string }).resourcesPath;
  if (res) out.add(real(res) ?? res);
  // the programs on PATH (the desktop app puts its `node` launcher in its data folder), but never a whole home folder
  const home = real(os.homedir()) ?? os.homedir();
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    const r = d && real(d);
    if (r && path.isAbsolute(r) && !inside(home, r)) out.add(r);
  }
  return [...out];
}

// installed is not enough: where unprivileged namespaces are off (Ubuntu 24.04's AppArmor) bwrap is there and fails, and
// every command would fail with it; it must run a command once
let bwrap: boolean | undefined;
const hasBwrap = () => (bwrap ??= (() => { try { execFileSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', 'true'], { stdio: 'ignore', timeout: 10_000 }); return true; } catch { return false; } })());

const q = (p: string) => JSON.stringify(p);   // a Seatbelt string literal

const nonet = () => process.env.FRAMETELL_SANDBOX_NONET === '1';
const required = () => process.env.FRAMETELL_SANDBOX_REQUIRED === '1';

/** the command that runs `cmd argv` confined to `root` (the same command where no sandbox is available) */
export function confine(root: string, cmd: string, argv: string[], platform: NodeJS.Platform = process.platform): [string, string[]] {
  const r = real(root) ?? root;
  if (platform === 'darwin') {
    const hidden = [...new Set(['/Users', real(os.homedir()) ?? os.homedir(), '/Volumes', '/private/tmp', '/private/var/tmp', ...extraHidden().map((d) => real(d) ?? d)])];
    const profile = [
      '(version 1)',
      '(allow default)',
      ...(nonet() ? ['(deny network*)'] : []),
      `(deny file-read-data file-write* ${hidden.map((d) => `(subpath ${q(d)})`).join(' ')})`,
      `(allow file-read-data ${readable(root).map((d) => `(subpath ${q(d)})`).join(' ')})`,
      `(allow file-read-data file-write* (subpath ${q(r)}))`,
      `(deny file-read-data file-write* (subpath ${q(path.join(r, '.studio'))}))`,   // the studio's record of the run
    ].join('\n');
    return ['/usr/bin/sandbox-exec', ['-p', profile, cmd, ...argv]];
  }
  if (platform === 'linux' && hasBwrap()) {
    const hidden = [...new Set([os.homedir(), ...extraHidden()])].filter((d) => d !== '/' && fs.existsSync(d));
    return ['bwrap', [
      '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp',
      // no network, no other processes (their /proc, environment and memory), no shared IPC, no terminal to type into
      ...(nonet() ? ['--unshare-net', '--unshare-pid', '--unshare-ipc', '--new-session', '--tmpfs', '/dev/shm'] : []),
      ...hidden.flatMap((d) => ['--tmpfs', d]),
      // what the project needs from a hidden folder comes back: the project itself (writable), the engine and Node
      ...readable(root).filter((d) => hidden.some((h) => inside(d, h))).flatMap((d) => ['--ro-bind', d, d]),
      '--bind', r, r, ...(fs.existsSync(path.join(r, '.studio')) ? ['--tmpfs', path.join(r, '.studio')] : []),   // the studio's record of the run
      '--chdir', r, '--die-with-parent', cmd, ...argv,
    ]];
  }
  if (required() || nonet()) throw new Error('FRAMETELL_SANDBOX_REQUIRED is set (FRAMETELL_SANDBOX_NONET requires it too), but there is no sandbox here (bubblewrap on Linux, sandbox-exec on macOS)');
  return [cmd, argv];
}
