import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { confine } from './tools/sandbox.js';
import { engineCmd, nodeEnv } from './project.js';
import { fileTools } from './tools/files.js';
import { ENGINE_DIR, engineModulesDir } from '@frametell/engine/tools/project.mjs';

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
    sh(`echo x > ${JSON.stringify(path.join(other, 'planted.txt'))}`);   // under bubblewrap the write may succeed, into the empty tmpfs; it must not land
    assert.ok(!fs.existsSync(path.join(other, 'planted.txt')));
    const h = sh(`ls -A ${JSON.stringify(os.homedir())}`);   // bubblewrap hides home behind an empty tmpfs: the listing fails or shows nothing
    assert.ok(h.code !== 0 || h.out === '', h.out);
    fs.mkdirSync(path.join(root, '.studio'), { recursive: true }); fs.writeFileSync(path.join(root, '.studio/events.jsonl'), 'history');
    assert.notEqual(sh('cat .studio/events.jsonl').out, 'history');
    // the studio's git runs outside the sandbox: a hook or a config line planted in .git would run there
    fs.mkdirSync(path.join(root, '.git/hooks'), { recursive: true }); fs.writeFileSync(path.join(root, '.git/config'), '[core]\n');
    sh('echo "#!/bin/sh" > .git/hooks/pre-commit; echo "[core] fsmonitor = touch /tmp/x" >> .git/config; mv .git .git-old; mkdir -p .git');
    assert.ok(!fs.existsSync(path.join(root, '.git/hooks/pre-commit')) && !fs.existsSync(path.join(root, '.git-old')));
    assert.equal(fs.readFileSync(path.join(root, '.git/config'), 'utf8'), '[core]\n');
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
  const probe = `test -e /proc/${process.pid} && echo seen || echo hidden`;
  assert.match(await confined(probe, {}), /seen/);
  assert.match(await confined(probe, { FRAMETELL_SANDBOX_NONET: '1' }), /hidden/);
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

test('asking for no network requires a sandbox too', () => {
  const was = { r: process.env.FRAMETELL_SANDBOX_REQUIRED, n: process.env.FRAMETELL_SANDBOX_NONET };
  try {
    delete process.env.FRAMETELL_SANDBOX_REQUIRED;
    process.env.FRAMETELL_SANDBOX_NONET = '1';
    assert.throws(() => confine('/tmp', 'bash', ['-c', 'true'], 'win32'), /FRAMETELL_SANDBOX_REQUIRED/);
  } finally {
    if (was.r === undefined) delete process.env.FRAMETELL_SANDBOX_REQUIRED; else process.env.FRAMETELL_SANDBOX_REQUIRED = was.r;
    if (was.n === undefined) delete process.env.FRAMETELL_SANDBOX_NONET; else process.env.FRAMETELL_SANDBOX_NONET = was.n;
  }
});

test('engine tools run as they always have, and inside the sandbox when the network is taken away', { skip: !sandboxed && 'no sandbox here' }, async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-engine-')));
  const was = process.env.FRAMETELL_SANDBOX_NONET;
  try {
    delete process.env.FRAMETELL_SANDBOX_NONET;
    assert.deepEqual(engineCmd(root, ['tool.mjs', '--x']), [process.execPath, ['tool.mjs', '--x']]);
    process.env.FRAMETELL_SANDBOX_NONET = '1';
    const [cmd] = engineCmd(root, ['tool.mjs']);
    assert.ok(cmd === 'bwrap' || cmd === '/usr/bin/sandbox-exec', cmd);
  } finally {
    if (was === undefined) delete process.env.FRAMETELL_SANDBOX_NONET; else process.env.FRAMETELL_SANDBOX_NONET = was;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('every engine tool is launched through engineCmd, so none can bypass the sandbox', () => {
  const src = fs.readFileSync(new URL('../src/project.ts', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => l.includes('process.execPath') && !/^\s*(\/\/|\*|\/\*)/.test(l));
  const outside = code.filter((l) => !l.includes('confine(dir, process.execPath, args)'));   // the one line that defines engineCmd
  assert.deepEqual(outside, [], 'process.execPath may only appear in the engineCmd definition');
});

test('the shell and the engine tools see only what they need of the environment, never a secret under any name', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-env-')));
  const planted = { BILLING_DATABASE_URL: 'postgres://u:p@h/db', REDIS_URL: 'rediss://default:pw@r:6379', STRIPE_SECRET_KEY: 'sk_x', NODE_OPTIONS: '--require /tmp/evil.js', FRAMETELL_SANDBOX_HIDE_X: 'kept' };
  const was = Object.fromEntries(Object.keys(planted).map((k) => [k, process.env[k]]));
  Object.assign(process.env, planted);
  try {
    const bash = fileTools(root).find((t) => t.name === 'bash')!;
    const r = await bash.execute('1', { command: 'env' }, undefined as never);
    const out = (r.content[0] as { text: string }).text;
    for (const k of ['BILLING_DATABASE_URL', 'REDIS_URL', 'STRIPE_SECRET_KEY', 'NODE_OPTIONS']) assert.ok(!out.includes(k + '='), `${k} reached the shell`);
    assert.ok(!out.includes('u:p@h') && !out.includes('default:pw'), 'a password reached the shell');
    assert.match(out, /^PATH=/m); assert.match(out, /^HOME=/m);
    const env = nodeEnv({ SNAP_TILE: '320' });
    assert.equal(env.BILLING_DATABASE_URL, undefined); assert.equal(env.REDIS_URL, undefined); assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.SNAP_TILE, '320'); assert.equal(env.PATH, process.env.PATH); assert.equal(env.FRAMETELL_SANDBOX_HIDE_X, 'kept');
  } finally {
    for (const [k, v] of Object.entries(was)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a project\'s engine link pointed at a folder kept out does not let that folder back in; the real engine stays readable', { skip: !sandboxed && 'no sandbox here' }, () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-relink-')));
  const root = path.join(base, 'project'), others = path.join(base, 'others');
  fs.mkdirSync(root); fs.mkdirSync(path.join(others, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(others, 'secret.txt'), 'theirs');
  fs.writeFileSync(path.join(others, 'node_modules', 'secret.txt'), 'theirs too');
  fs.symlinkSync(others, path.join(root, 'engine'));
  fs.symlinkSync(path.join(others, 'node_modules'), path.join(root, 'engine_modules'));
  const was = process.env.FRAMETELL_SANDBOX_HIDE;
  process.env.FRAMETELL_SANDBOX_HIDE = others;
  const sh = (c: string) => { const [cmd, argv] = confine(root, 'bash', ['-c', c]); const r = spawnSync(cmd, argv, { cwd: root, encoding: 'utf8' }); return (r.stdout + r.stderr).trim(); };
  try {
    assert.ok(!sh('cat engine/secret.txt').includes('theirs'));
    assert.ok(!sh(`cat ${JSON.stringify(path.join(others, 'secret.txt'))}`).includes('theirs'));
    assert.ok(!sh('cat engine_modules/secret.txt').includes('theirs'));
    assert.equal(JSON.parse(sh(`cat ${JSON.stringify(path.join(ENGINE_DIR, 'package.json'))}`)).name, '@frametell/engine');
    assert.match(sh(`cat ${JSON.stringify(path.join(engineModulesDir(), 'roughjs', 'package.json'))}`), /"name": "roughjs"/);
  } finally {
    if (was === undefined) delete process.env.FRAMETELL_SANDBOX_HIDE; else process.env.FRAMETELL_SANDBOX_HIDE = was;
    fs.rmSync(base, { recursive: true, force: true });
  }
});
