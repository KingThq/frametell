import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BLOCKED, seccompFilter, writeSeccompFilter } from './tools/seccomp.js';
import { bwrapCommand, usesBwrap } from './tools/sandbox.js';

// a classic-BPF interpreter for the few instructions the filter uses, run on struct seccomp_data { int nr; u32 arch; ... }
function run(prog: Buffer, nr: number, arch: number): number {
  const data = Buffer.alloc(64); data.writeInt32LE(nr | 0, 0); data.writeUInt32LE(arch >>> 0, 4);
  let a = 0;
  for (let pc = 0, steps = 0; steps < 1000; steps++) {
    const code = prog.readUInt16LE(pc * 8), jt = prog[pc * 8 + 2], jf = prog[pc * 8 + 3], k = prog.readUInt32LE(pc * 8 + 4);
    if (code === 0x20) { a = data.readUInt32LE(k); pc++; }
    else if (code === 0x15) pc += 1 + (a === k ? jt : jf);
    else if (code === 0x35) pc += 1 + (a >= k ? jt : jf);
    else if (code === 0x06) return k;
    else throw new Error(`unexpected opcode ${code}`);
    if (pc * 8 >= prog.length) throw new Error('ran off the end');
  }
  throw new Error('loop');
}
const ARCH = { x64: 0xc000003e, arm64: 0xc00000b7 };
const ALLOW = 0x7fff0000, EPERM = 0x00050001, KILL = 0x80000000;

test('the seccomp filter refuses each blocked call with EPERM, allows the rest, and kills another architecture', () => {
  for (const arch of ['x64', 'arm64'] as const) {
    const prog = seccompFilter(arch);
    assert.equal(prog.length % 8, 0);
    for (const [name, nrs] of Object.entries(BLOCKED)) assert.equal(run(prog, nrs[arch], ARCH[arch]), EPERM, `${arch} ${name}`);
    const blocked = new Set(Object.values(BLOCKED).map((n) => n[arch]));
    for (let nr = 0; nr < 470; nr++) if (!blocked.has(nr)) assert.equal(run(prog, nr, ARCH[arch]), ALLOW, `${arch} ${nr}`);
    assert.equal(run(prog, 0, arch === 'x64' ? ARCH.arm64 : ARCH.x64), KILL, `${arch}: another architecture`);
    assert.equal(run(prog, 0, 0x40000003), KILL, `${arch}: i386`);
  }
  // x32 calls on x86_64 carry bit 30: their own numbers would slip past the list
  assert.equal(run(seccompFilter('x64'), 0x40000000 + 321, ARCH.x64), KILL);
  assert.throws(() => seccompFilter('ia32'), /no seccomp filter/);
});

test('the common calls a shell, Node, ffmpeg and Chromium make stay allowed', () => {
  // read write openat close mmap clone execve exit_group futex epoll_wait (x64), and their aarch64 numbers
  for (const nr of [0, 1, 257, 3, 9, 56, 59, 231, 202, 232, 435]) assert.equal(run(seccompFilter('x64'), nr, ARCH.x64), ALLOW, `x64 ${nr}`);
  for (const nr of [63, 64, 56, 57, 222, 220, 221, 94, 98, 22, 435]) assert.equal(run(seccompFilter('arm64'), nr, ARCH.arm64), ALLOW, `arm64 ${nr}`);
});

test('bubblewrap gets its own user namespace with none nested, no capabilities, and the image\'s seccomp filter on a descriptor', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-seccomp-')));
  const was = process.env.FRAMETELL_SANDBOX_SECCOMP;
  try {
    delete process.env.FRAMETELL_SANDBOX_SECCOMP;
    const [c1, a1] = bwrapCommand(dir, '/bin/true', []);
    assert.equal(c1, 'bwrap');
    assert.deepEqual(a1.slice(0, 4), ['--unshare-user', '--disable-userns', '--cap-drop', 'ALL']);
    assert.ok(usesBwrap(c1, a1));

    const file = path.join(dir, 'seccomp.bpf');
    writeSeccompFilter(file, 'arm64');
    process.env.FRAMETELL_SANDBOX_SECCOMP = file;
    const [c2, a2] = bwrapCommand(dir, '/bin/true', ['x']);
    assert.equal(c2, '/bin/sh');
    assert.deepEqual(a2.slice(0, 3), ['-c', 'exec bwrap --seccomp 9 "$@" 9<"$0"', file]);
    assert.deepEqual(a2.slice(3, 7), ['--unshare-user', '--disable-userns', '--cap-drop', 'ALL']);
    assert.deepEqual(a2.slice(-2), ['/bin/true', 'x']);
    assert.ok(usesBwrap(c2, a2));
    assert.ok(!usesBwrap('/bin/sh', ['-c', 'bwrap']));

    // a filter named but missing (or not a filter) is an error, never a sandbox without it
    process.env.FRAMETELL_SANDBOX_SECCOMP = path.join(dir, 'missing.bpf');
    assert.throws(() => bwrapCommand(dir, '/bin/true', []), /not a readable seccomp filter/);
    fs.writeFileSync(path.join(dir, 'odd.bpf'), 'abc');
    process.env.FRAMETELL_SANDBOX_SECCOMP = path.join(dir, 'odd.bpf');
    assert.throws(() => bwrapCommand(dir, '/bin/true', []), /not a readable seccomp filter/);
  } finally {
    if (was === undefined) delete process.env.FRAMETELL_SANDBOX_SECCOMP; else process.env.FRAMETELL_SANDBOX_SECCOMP = was;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
