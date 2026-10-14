import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import { fileTools } from './tools/files.js';
import type { AgentRuntime } from './runtime/types.js';

const PAGE = (id: string) => `ENGINE.visual('${id}', (P) => {\n  P.text('hi', { x: 100, y: 100 });\n});\n`;

test('Pause ends the run only once every page has stopped, and starts no new page', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-pause-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  const stop = new AbortController();
  const ids = ['p01', 'p02', 'p03'];
  const pages: AgentRuntime = {
    id: 'pi', model: { provider: 'x', id: 'flash' },
    async open(s) {
      return { ref: 'r', close: async () => {}, send: async () => {
        if (stop.signal.aborted) return { text: '', stopReason: 'aborted', usage: {}, answers: [] } as never;
        fs.writeFileSync(path.join(s.cwd, `pages/${s.name.slice(5)}.js`), PAGE(s.name.slice(5)));
        return { text: 'drawn', stopReason: 'done', usage: {}, answers: [] } as never;
      } };
    },
  };
  const d = new Director({ dir, style: 'chalkboard', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime: pages, pages: { runtime: pages }, concurrency: 2, signal: stop.signal });
  const sb = { title: 'T', summary: 'S', pages: ids.map((id) => ({ id, section: id, say: '…', beats: [] })) };
  const events: { id: string; status: string }[] = [];
  let slowDone = false;
  Object.assign(d.project, {
    lint: async () => [], commit: async () => undefined, storyboard: () => sb,
    timeline: async () => ({ duration: 15, pages: ids.map((id, i) => ({ id, start: i * 5, end: i * 5 + 5, speechEnd: i * 5 + 4, cues: [] })) }),
    // p01's check stops at once; p02's takes a while to wind down
    check: (id: string) => new Promise((_ok, fail) => {
      const end = () => setTimeout(() => { if (id === 'p02') slowDone = true; fail(new DOMException('aborted', 'AbortError')); }, id === 'p02' ? 200 : 0);
      if (stop.signal.aborted) return end();
      stop.signal.addEventListener('abort', end);
      if (id === 'p02') setTimeout(() => stop.abort(), 20);
    }),
  });
  (d as unknown as { o: { emit: (e: { type: string; id: string; status: string }) => void } }).o.emit = (e) => { if (e.type === 'page') events.push(e); };
  await assert.rejects(d.pages(), (e: Error) => e.name === 'AbortError');
  assert.ok(slowDone, 'the run ended before every page had stopped');
  assert.ok(!events.some((e) => e.id === 'p03' && e.status !== 'queued'), 'a page was started after the stop');
});

test('a stopped shell command takes what it started with it', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-bash-'));
  const bash = fileTools(dir).find((t) => t.name === 'bash')!;
  const stop = new AbortController();
  const ran = bash.execute('t', { command: 'sleep 30 & echo $! > child.pid; wait' }, stop.signal);
  for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, 'child.pid')); i++) await new Promise((r) => setTimeout(r, 50));
  const pid = +fs.readFileSync(path.join(dir, 'child.pid'), 'utf8');
  stop.abort();
  await assert.rejects(ran, (e: Error) => e.name === 'AbortError');
  await new Promise((r) => setTimeout(r, 200));
  assert.throws(() => process.kill(pid, 0), 'the command\'s own child is still running');
});
