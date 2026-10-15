import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GIT_SAFE, gitSync, removeNestedRepos } from './git.js';
import { Project } from './project.js';

const packages = fileURLToPath(new URL('../../', import.meta.url));   // oss/packages
const cloudApi = path.resolve(packages, '../../apps/api/src');          // the hosted API, when oss sits in the cloud repo

/** a repo of our own, made with plain git (as the agent's shell would), outside the studio's helper */
const plainGit = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@a', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@a' } });
const evilRepo = (dir: string, marker: string) => {
  fs.mkdirSync(dir, { recursive: true });
  plainGit(dir, ['init', '-q']);
  fs.writeFileSync(path.join(dir, '.gitattributes'), '* filter=ev\n');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a\n');
  plainGit(dir, ['add', '-A']); plainGit(dir, ['commit', '-qm', 'x']);
  plainGit(dir, ['config', 'core.fsmonitor', `touch ${JSON.stringify(marker)}; false`]);
  plainGit(dir, ['config', 'filter.ev.clean', `touch ${JSON.stringify(marker)}; cat`]);
  fs.writeFileSync(path.join(dir, 'f.txt'), 'b\n');   // modified, so a status in it runs the filter
};

/** a git started directly: spawn('git', …), exec('git add …'), 'git', [args] handed to any launcher, or the name kept in a constant */
const SPAWNS_GIT = [/\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork|execa|confine)\s*\([^)]*?['"`]git(\.exe)?['"`\s]/, /['"`]git(\.exe)?['"`]\s*,\s*\[/, /=\s*['"`]git(\.exe)?['"`]\s*[;,)]?\s*$/];

test('every git the studio runs goes through git.ts (no git spawned any other way in agent, core, engine or the API)', () => {
  const roots = [path.join(packages, 'agent/src'), path.join(packages, 'core/src'), path.join(packages, 'engine/tools'), path.join(packages, 'engine/lib'), cloudApi].filter((d) => fs.existsSync(d));
  const files: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory() && e.name !== 'node_modules') walk(p); else if (/\.(ts|mts|js|mjs|cjs)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p); } };
  roots.forEach(walk);
  assert.ok(files.length > 20, 'the scan found the sources');
  const offenders = files.filter((f) => !f.endsWith(`${path.sep}agent${path.sep}src${path.sep}git.ts`)).flatMap((f) =>
    fs.readFileSync(f, 'utf8').split('\n').map((l, i) => [l, i] as const)
      .filter(([l]) => !/^\s*(\/\/|\*|\/\*)/.test(l) && SPAWNS_GIT.some((re) => re.test(l)))
      .map(([l, i]) => `${path.relative(packages, f)}:${i + 1}: ${l.trim()}`));
  assert.deepEqual(offenders, [], 'spawn git only through gitSync / gitAsync in agent/src/git.ts');
});

test('the helper turns off fsmonitor and hooks, over any config file', () => {
  assert.deepEqual(GIT_SAFE.slice(0, 2), ['-c', 'core.fsmonitor=false']);
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-gitsafe-')));
  try {
    plainGit(dir, ['init', '-q']);
    plainGit(dir, ['config', 'core.fsmonitor', 'touch /nonexistent']);
    plainGit(dir, ['config', 'core.hooksPath', dir]);
    assert.equal(gitSync(dir, ['config', 'core.fsmonitor']).stdout.trim(), 'false');
    const hooks = gitSync(dir, ['config', 'core.hooksPath']).stdout.trim();
    assert.notEqual(hooks, dir);
    assert.ok(!fs.existsSync(hooks) || !fs.statSync(hooks).isDirectory(), 'the hooks folder can never exist');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a repo planted in the project (a .git folder, a .git file, a .gitmodules, an old gitlink) runs nothing when the studio commits', async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-gitnest-')));
  const root = path.join(base, 'project'), outside = path.join(base, 'outside');
  const marker = path.join(base, 'MARKER');
  const warned: string[] = [];
  const warn = console.warn; console.warn = (m: string) => { warned.push(String(m)); };
  try {
    fs.mkdirSync(root);
    const p = new Project(root);
    p.initHistory();
    // an old project: a gitlink already in the index, from before this fix (plain `git add -A` adds one)
    evilRepo(path.join(root, 'old'), marker);
    plainGit(root, ['add', '-A']);
    assert.match(plainGit(root, ['ls-files', '-s', 'old']).toString(), /^160000 /);
    fs.rmSync(marker, { force: true });
    // the proof the hole is real: plain git (as the studio ran it before) runs the planted program
    spawnSync('git', ['status', '--porcelain'], { cwd: root });
    assert.ok(fs.existsSync(marker), 'plain git ran the nested repo\'s fsmonitor/filter (the bug this guards against)');
    fs.rmSync(marker);
    // what the agent's shell can plant: a repo folder, a `.git` file pointing anywhere, a `.GIT` folder, and a .gitmodules
    evilRepo(path.join(root, 'sub'), marker);
    evilRepo(outside, marker);
    fs.mkdirSync(path.join(root, 'deep/er'), { recursive: true });
    fs.writeFileSync(path.join(root, 'deep/er/.git'), `gitdir: ${path.join(outside, '.git')}\n`);
    fs.writeFileSync(path.join(root, 'deep/er/x.txt'), 'x\n');
    fs.writeFileSync(path.join(root, '.gitmodules'), `[submodule "sub"]\n\tpath = sub\n\turl = ${outside}\n\tupdate = !touch ${marker}\n[submodule "deep"]\n\tpath = deep/er\n\turl = ${outside}\n\tupdate = !touch ${marker}\n`);
    fs.writeFileSync(path.join(root, 'page.js'), 'page\n');
    const id = await p.commit('step');
    assert.ok(id, 'the commit went through');
    assert.ok(!fs.existsSync(marker), 'a program named by a planted repo ran outside the sandbox');
    for (const d of ['sub/.git', 'deep/er/.git', 'old/.git']) assert.ok(!fs.existsSync(path.join(root, d)), `${d} was not removed`);
    assert.ok(fs.existsSync(path.join(outside, '.git')), 'the repo a .git file pointed at is left alone (it is not ours)');
    assert.equal(gitSync(root, ['ls-files', '-s']).stdout.split('\n').filter((l) => l.startsWith('160000')).length, 0, 'no gitlink left in the index');
    const tracked = gitSync(root, ['ls-files']).stdout.split('\n');
    for (const f of ['page.js', 'sub/f.txt', 'deep/er/x.txt', 'old/f.txt']) assert.ok(tracked.includes(f), `${f} committed as a plain file`);
    assert.ok(warned.some((m) => m.includes('sub/.git') || m.includes(`sub${path.sep}.git`)), 'the removal is logged');
    // the next commits stay clean too, and git's own status in the project runs nothing
    evilRepo(path.join(root, 'again'), marker);
    await p.commit('again');
    gitSync(root, ['status', '--porcelain']);
    assert.ok(!fs.existsSync(marker));
  } finally {
    console.warn = warn;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('removeNestedRepos keeps the project\'s own history and does not follow links', () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-gitwalk-')));
  const root = path.join(base, 'project'), elsewhere = path.join(base, 'elsewhere');
  try {
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.mkdirSync(path.join(elsewhere, 'r/.git'), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(root, 'link'));
    fs.mkdirSync(path.join(root, 'a/b/.git'), { recursive: true });
    const removed = removeNestedRepos(root, () => {});
    assert.deepEqual(removed, [path.join('a', 'b', '.git')]);
    assert.ok(fs.existsSync(path.join(root, '.git')));
    assert.ok(fs.existsSync(path.join(elsewhere, 'r/.git')), 'a link out of the project is not walked');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a commit in a project with no history makes the repository first, so a shell cannot plant one, and commits what is there', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-commitinit-'));
  try {
    fs.writeFileSync(path.join(dir, 'script.js'), 'const SCRIPT = {};');
    const id = await new Project(dir).commit('first');
    assert.ok(id, 'the first commit has the files in it');
    assert.ok(fs.statSync(path.join(dir, '.git')).isDirectory());
    assert.equal(gitSync(dir, ['log', '--format=%s']).stdout.trim(), 'first');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
