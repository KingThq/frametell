import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { confine } from './tools/sandbox.js';

const sandboxed = process.platform === 'darwin' || (process.platform === 'linux' && (() => { try { execFileSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', 'true'], { stdio: 'ignore' }); return true; } catch { return false; } })());

test('the shell reads and writes its project, and nothing in a folder kept out nor the studio\'s record', { skip: !sandboxed && 'no sandbox here' }, () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sandbox-')));
  const root = path.join(base, 'project'), other = path.join(base, 'others');
  fs.mkdirSync(root); fs.mkdirSync(other);
  fs.writeFileSync(path.join(root, 'page.js'), 'mine\n');
  fs.writeFileSync(path.join(other, 'secret.txt'), 'theirs');
  const was = process.env.FRAMETELL_SANDBOX_HIDE;
  process.env.FRAMETELL_SANDBOX_HIDE = other;
  const sh = (c: string) => { const [cmd, argv] = confine(root, 'bash', ['-c', c]); const r = spawnSync(cmd, argv, { cwd: root, encoding: 'utf8' }); return { code: r.status, out: (r.stdout + r.stderr).trim() }; };
  try {
    assert.equal(sh('cat page.js && echo new > out.txt && cat out.txt').out, 'mine\nnew');
    assert.notEqual(sh(`cat ${JSON.stringify(path.join(other, 'secret.txt'))}`).out, 'theirs');
    assert.notEqual(sh(`echo x > ${JSON.stringify(path.join(other, 'planted.txt'))}`).code, 0);
    assert.ok(!fs.existsSync(path.join(other, 'planted.txt')));
    assert.notEqual(sh(`ls ${JSON.stringify(os.homedir())}`).code, 0);
    fs.mkdirSync(path.join(root, '.studio'), { recursive: true }); fs.writeFileSync(path.join(root, '.studio/events.jsonl'), 'history');
    assert.notEqual(sh('cat .studio/events.jsonl').out, 'history');
  } finally {
    if (was === undefined) delete process.env.FRAMETELL_SANDBOX_HIDE; else process.env.FRAMETELL_SANDBOX_HIDE = was;
  }
});
