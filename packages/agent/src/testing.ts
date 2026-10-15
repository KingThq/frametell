// Test fixtures (`@frametell/agent/testing`, not in the main entry). Each helper writes one fixture into a project
// folder. A trace of one is `marker` appearing on disk or a request reaching `url`; nothing else is touched.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const plainGit = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@a', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@a' } });

/** a repo made with plain git whose fsmonitor and clean filter touch `marker` (moved here from git.test.ts as is) */
export function evilRepo(dir: string, marker: string) {
  fs.mkdirSync(dir, { recursive: true });
  plainGit(dir, ['init', '-q']);
  fs.writeFileSync(path.join(dir, '.gitattributes'), '* filter=ev\n');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a\n');
  plainGit(dir, ['add', '-A']); plainGit(dir, ['commit', '-qm', 'x']);
  plainGit(dir, ['config', 'core.fsmonitor', `touch ${JSON.stringify(marker)}; false`]);
  plainGit(dir, ['config', 'filter.ev.clean', `touch ${JSON.stringify(marker)}; cat`]);
  fs.writeFileSync(path.join(dir, 'f.txt'), 'b\n');   // modified, so a status in it runs the filter
}

/** script.js whose code reaches for its process and writes `marker`; voice.js and a page beside it */
export function plantScript(dir: string, marker: string) {
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'script.js'), `(function (root) {
  try { root.constructor.constructor('return process')().getBuiltinModule('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); } catch {}
  root.SCRIPT = { META: {}, PAGES: [{ id: 'p01', cues: ['一。'] }] };
})(globalThis);`);
  fs.writeFileSync(path.join(dir, 'voice.js'), 'SCRIPT.VOICE = { speaker: "v1", pages: [[{ t: "一。", f: "audio/a.wav", d: 1, o: 0 }]] };');
  fs.writeFileSync(path.join(dir, 'pages', 'p01.js'), 'const a = 1;\n');
}

/** a "sound" at `rel` that is really a playlist naming `url` (narrate.test's playlist) */
export function plantPlaylist(dir: string, rel: string, url: string) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${url}seg.ts\n#EXT-X-ENDLIST\n`);
}

/** a repo folder and a .gitmodules whose update command touches `marker` (git.test's planted repo) */
export function plantRepo(dir: string, marker: string) {
  evilRepo(path.join(dir, 'sub'), marker);
  fs.writeFileSync(path.join(dir, '.gitmodules'), `[submodule "sub"]\n\tpath = sub\n\turl = ./sub\n\tupdate = !touch ${marker}\n`);
}
