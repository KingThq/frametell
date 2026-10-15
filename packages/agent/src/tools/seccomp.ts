// The seccomp filter bubblewrap loads (`--seccomp FD`) before it runs the agent's shell and the engine's tools: the
// kernel calls a confined program never needs and that widen what a kernel bug can be reached through (BPF, userfaultfd,
// io_uring, the key store, ptrace, perf, kexec, mounting, new namespaces) answer EPERM. A program for another
// architecture than the filter's is killed (x32 calls on x86_64 included: their numbers would dodge the list).
// It is a classic BPF program, the bytes bwrap reads from the descriptor: struct sock_filter { u16 code; u8 jt, jf; u32 k },
// little endian (x86_64 and aarch64 both are). The hosted image writes it at build (writeSeccompFilter) and names it in
// FRAMETELL_SANDBOX_SECCOMP; sandbox.ts passes it to bwrap.
import fs from 'node:fs';

export type SeccompArch = 'x64' | 'arm64';

/** the calls refused, by name, as the kernel numbers them on each architecture (include/uapi/asm-generic/unistd.h for
 *  aarch64, arch/x86/entry/syscalls/syscall_64.tbl for x86_64) */
export const BLOCKED: Record<string, { x64: number; arm64: number }> = {
  bpf: { x64: 321, arm64: 280 },
  userfaultfd: { x64: 323, arm64: 282 },
  io_uring_setup: { x64: 425, arm64: 425 },
  io_uring_enter: { x64: 426, arm64: 426 },
  io_uring_register: { x64: 427, arm64: 427 },
  keyctl: { x64: 250, arm64: 219 },
  add_key: { x64: 248, arm64: 217 },
  request_key: { x64: 249, arm64: 218 },
  ptrace: { x64: 101, arm64: 117 },
  perf_event_open: { x64: 298, arm64: 241 },
  kexec_load: { x64: 246, arm64: 104 },
  kexec_file_load: { x64: 320, arm64: 294 },
  mount: { x64: 165, arm64: 40 },
  umount2: { x64: 166, arm64: 39 },
  pivot_root: { x64: 155, arm64: 41 },
  open_tree: { x64: 428, arm64: 428 },
  move_mount: { x64: 429, arm64: 429 },
  fsopen: { x64: 430, arm64: 430 },
  fsconfig: { x64: 431, arm64: 431 },
  fsmount: { x64: 432, arm64: 432 },
  fspick: { x64: 433, arm64: 433 },
  mount_setattr: { x64: 442, arm64: 442 },
  unshare: { x64: 272, arm64: 97 },
  setns: { x64: 308, arm64: 268 },
};

const AUDIT_ARCH = { x64: 0xc000003e, arm64: 0xc00000b7 } as const;
const X32_BIT = 0x40000000;
// BPF opcodes and seccomp return values (linux/filter.h, linux/seccomp.h)
const LD_W_ABS = 0x20, JEQ_K = 0x15, JGE_K = 0x35, RET_K = 0x06;
const RET_ALLOW = 0x7fff0000, RET_EPERM = 0x00050000 | 1, RET_KILL_PROCESS = 0x80000000;
const NR = 0, ARCH = 4;   // offsetof(struct seccomp_data, nr / arch)

type Insn = [code: number, jt: number, jf: number, k: number];

/** the filter for `arch` (this machine's by default), as the bytes bwrap reads */
export function seccompFilter(arch: string = process.arch): Buffer {
  if (arch !== 'x64' && arch !== 'arm64') throw new Error(`no seccomp filter for ${arch}`);
  const nrs = [...new Set(Object.values(BLOCKED).map((n) => n[arch]))];
  // layout: arch check, load nr, [x32 check], one jeq per blocked call, allow, eperm, kill
  const head: Insn[] = [[LD_W_ABS, 0, 0, ARCH]];
  const body: Insn[] = [[LD_W_ABS, 0, 0, NR]];
  if (arch === 'x64') body.push([JGE_K, 0, 0, X32_BIT]);   // jt patched to kill below
  const firstEq = body.length;
  for (const n of nrs) body.push([JEQ_K, 0, 0, n]);
  const prog: Insn[] = [...head, [JEQ_K, 0, 0, AUDIT_ARCH[arch]], ...body, [RET_K, 0, 0, RET_ALLOW], [RET_K, 0, 0, RET_EPERM], [RET_K, 0, 0, RET_KILL_PROCESS]];
  const eperm = prog.length - 2, kill = prog.length - 1;
  const at = (i: number, target: number) => { const off = target - i - 1; if (off > 255) throw new Error('seccomp jump too far'); return off; };
  prog[1][2] = at(1, kill);   // another architecture: killed
  const base = head.length + 1;   // index of body[0] in prog
  if (arch === 'x64') prog[base + 1][1] = at(base + 1, kill);
  for (let j = firstEq; j < body.length; j++) prog[base + j][1] = at(base + j, eperm);
  const out = Buffer.alloc(prog.length * 8);
  prog.forEach(([code, jt, jf, k], i) => { out.writeUInt16LE(code, i * 8); out.writeUInt8(jt, i * 8 + 2); out.writeUInt8(jf, i * 8 + 3); out.writeUInt32LE(k >>> 0, i * 8 + 4); });
  return out;
}

/** writes the filter for this machine to `file` (the hosted image does it at build) */
export function writeSeccompFilter(file: string, arch: string = process.arch): void {
  fs.writeFileSync(file, seccompFilter(arch), { mode: 0o444 });
}
