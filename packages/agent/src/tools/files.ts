// File and shell tools for the Pi runtime. Everything is confined to the project directory: the engine (engine/,
// engine_modules/) is read-only, nothing outside the project is reachable, and commands run with a timeout.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

const READ_ONLY = ['engine', 'engine_modules', '.git'];
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const MAX_TEXT = 60_000;

export function resolveIn(root: string, p: string, write = false): string {
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`路径在项目目录之外：${p}`);
  const top = rel.split(path.sep)[0];
  if (write && READ_ONLY.includes(top)) throw new Error(`不能修改 ${p}：引擎目录是只读的`);
  return abs;
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }], details: undefined });

const ReadP = Type.Object({ path: Type.String(), offset: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()) });
const WriteP = Type.Object({ path: Type.String(), content: Type.String() });
const EditP = Type.Object({ path: Type.String(), old_string: Type.String(), new_string: Type.String(), replace_all: Type.Optional(Type.Boolean()) });
const BashP = Type.Object({ command: Type.String() });

export function fileTools(root: string, opts: { timeoutMs?: number } = {}): AgentTool<any>[] {
  const read: AgentTool<typeof ReadP> = {
    name: 'read', label: 'Read',
    description: 'Read a file in the project. Images (png/jpg) are returned as images you can look at. Optional offset/limit are line numbers for large text files.',
    parameters: ReadP,
    execute: async (_id, p) => {
      const abs = resolveIn(root, p.path);
      if (IMAGE.test(abs)) {
        const mime = /\.png$/i.test(abs) ? 'image/png' : /\.webp$/i.test(abs) ? 'image/webp' : /\.gif$/i.test(abs) ? 'image/gif' : 'image/jpeg';
        return { content: [{ type: 'image', data: fs.readFileSync(abs).toString('base64'), mimeType: mime }], details: undefined };
      }
      const lines = fs.readFileSync(abs, 'utf8').split('\n');
      const from = Math.max(0, (p.offset ?? 1) - 1), to = p.limit ? from + p.limit : lines.length;
      let out = lines.slice(from, to).map((l, i) => `${String(from + i + 1).padStart(5)}  ${l}`).join('\n');
      if (out.length > MAX_TEXT) out = out.slice(0, MAX_TEXT) + `\n… (truncated; read with offset/limit)`;
      return text(out);
    },
  };
  const write: AgentTool<typeof WriteP> = {
    name: 'write', label: 'Write',
    description: 'Create or overwrite a file in the project with the given content.',
    parameters: WriteP,
    executionMode: 'sequential',
    execute: async (_id, p) => {
      const abs = resolveIn(root, p.path, true);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, p.content);
      return text(`wrote ${p.path} (${p.content.split('\n').length} lines)`);
    },
  };
  const edit: AgentTool<typeof EditP> = {
    name: 'edit', label: 'Edit',
    description: 'Replace an exact string in a file. old_string must occur exactly once unless replace_all is true.',
    parameters: EditP,
    executionMode: 'sequential',
    execute: async (_id, p) => {
      const abs = resolveIn(root, p.path, true);
      const src = fs.readFileSync(abs, 'utf8');
      const n = src.split(p.old_string).length - 1;
      if (n === 0) throw new Error('old_string not found');
      if (n > 1 && !p.replace_all) throw new Error(`old_string occurs ${n} times; add context or set replace_all`);
      fs.writeFileSync(abs, p.replace_all ? src.split(p.old_string).join(p.new_string) : src.replace(p.old_string, () => p.new_string));
      return text(`edited ${p.path} (${p.replace_all ? n : 1} replacement${n > 1 && p.replace_all ? 's' : ''})`);
    },
  };
  const bash: AgentTool<typeof BashP> = {
    name: 'bash', label: 'Shell',
    description: 'Run a shell command in the project directory (e.g. node engine/tools/lint.mjs --only p03). No network access is expected; long-running renders are not allowed.',
    parameters: BashP,
    executionMode: 'sequential',
    execute: (_id, p, signal) => new Promise((resolve, reject) => {
      if (/\brender\.mjs\b|\bnpm (i|install)\b|\bcurl\b|\bwget\b/.test(p.command)) return reject(new Error('this command is not allowed in a page session'));
      const [cmd, argv]: [string, string[]] = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', p.command]] : ['bash', ['-lc', p.command]];
      const child = spawn(cmd, argv, { cwd: root, env: process.env, signal });
      let out = '';
      const add = (d: Buffer) => { out += d.toString(); if (out.length > MAX_TEXT * 2) out = out.slice(-MAX_TEXT * 2); };
      child.stdout.on('data', add); child.stderr.on('data', add);
      const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 180_000);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        const body = (out.length > MAX_TEXT ? '…' + out.slice(-MAX_TEXT) : out).trim() || '(no output)';
        resolve(text(code === 0 ? body : `exit ${code}\n${body}`));
      });
    }),
  };
  return [read, write, edit, bash] as AgentTool<any>[];
}
