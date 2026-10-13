import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
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

/** runs a shell command confined to a fresh project, with `env` set while it is confined */
async function confined(command: string, env: Record<string, string>) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-nonet-')));
  const was = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    const [cmd, argv] = confine(root, 'bash', ['-c', command]);
    return await new Promise<string>((ok) => execFile(cmd, argv, { cwd: root, timeout: 30_000 }, (_e, so, se) => ok(String(so) + String(se))));
  } finally {
    for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('with no network asked for, the shell cannot reach even this machine', { skip: !sandboxed && 'no sandbox here' }, async () => {
  const server = http.createServer((_q, s) => s.end('reached'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const probe = `"${process.execPath}" -e "fetch('http://127.0.0.1:${(server.address() as AddressInfo).port}').then(r=>r.text()).then(console.log,()=>console.log('blocked'))"`;
  try {
    assert.match(await confined(probe, {}), /reached/);
    assert.match(await confined(probe, { FRAMETELL_SANDBOX_NONET: '1' }), /blocked/);
  } finally { server.close(); }
});

test('with no network asked for on Linux, the shell sees no process outside its own', { skip: (process.platform !== 'linux' || !sandboxed) && 'bubblewrap only' }, async () => {
  assert.match(await confined(`test -e /proc/${process.pid} && echo seen || echo hidden`, { FRAMETELL_SANDBOX_NONET: '1' }), /hidden/);
});

test('a sandbox that is required and missing is an error, not a shell left open', () => {
  const was = process.env.FRAMETELL_SANDBOX_REQUIRED;
  try {
    delete process.env.FRAMETELL_SANDBOX_REQUIRED;
    assert.deepEqual(confine('/tmp', 'bash', ['-c', 'true'], 'win32'), ['bash', ['-c', 'true']]);
    process.env.FRAMETELL_SANDBOX_REQUIRED = '1';
    assert.throws(() => confine('/tmp', 'bash', ['-c', 'true'], 'win32'), /FRAMETELL_SANDBOX_REQUIRED/);
  } finally { if (was === undefined) delete process.env.FRAMETELL_SANDBOX_REQUIRED; else process.env.FRAMETELL_SANDBOX_REQUIRED = was; }
});
