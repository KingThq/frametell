import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import type { AgentRuntime } from './runtime/types.js';
import type { PageTiming, Storyboard } from './project.js';

const PAGE = "ENGINE.visual('p01', (P) => {\n  P.text('old', { x: 100, y: 100 });\n});\n";

/** a page model that answers each message with `answer`, which may change the page file */
const fake = (sent: string[], answer: (n: number, dir: string) => string): AgentRuntime => ({
  id: 'pi', model: { provider: 'x', id: 'flash' },
  async open(o) {
    return { ref: 'r', close: async () => {}, send: async (i) => { sent.push(i.text); return { text: answer(sent.length, o.cwd), stopReason: 'done', usage: {} } as never; } };
  },
});

/** the page step of a revision of p01, with the engine's checks stubbed: they find nothing */
async function revise(answer: (n: number, dir: string) => string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-revise-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(dir, 'pages/p01.js'), PAGE);
  const sent: string[] = [];
  const d = new Director({ dir, style: 'chalkboard', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime: fake(sent, answer) });
  Object.assign(d.project, { lint: async () => [], snap: async () => 'sheet.jpg', commit: async () => undefined });
  const inner = d as unknown as { state: { revision?: Record<string, string>; pages: Record<string, { status: string; issues: string[] }> }; page(sb: Storyboard, t: PageTiming): Promise<void> };
  inner.state.revision = { p01: '在开头加一个标题' };
  const sb = { title: 'T', summary: 'S', pages: [{ id: 'p01', section: '开场', say: '…', beats: [] }] } as unknown as Storyboard;
  await inner.page(sb, { id: 'p01', start: 0, end: 5, speechEnd: 4, cues: [] } as unknown as PageTiming);
  return { sent, page: inner.state.pages.p01, code: fs.readFileSync(path.join(dir, 'pages/p01.js'), 'utf8') };
}

test('a revision whose change never lands is not shown as done', async () => {
  // the model says it changed the page, then passes every check, and never edits the file
  const { sent, page, code } = await revise((n) => (n === 1 ? '已在第 1 页加上标题。' : 'DONE'));
  assert.equal(code, PAGE);
  assert.equal(page.status, 'flagged');
  assert.match(page.issues[0], /没有改上/);
  assert.match(sent[1], /exactly as it was: the change was not made/);   // asked once more
  assert.ok(sent.slice(2).every((m) => m.includes('在开头加一个标题')));   // and every check round restates the change
});

test('a revision that lands on the second ask is done', async () => {
  const { sent, page, code } = await revise((n, dir) => {
    if (n === 2) fs.writeFileSync(path.join(dir, 'pages/p01.js'), PAGE.replace("'old'", "'标题'"));
    return n === 1 ? '已加上。' : 'DONE';
  });
  assert.match(code, /标题/);
  assert.equal(page.status, 'ok');
  assert.ok(!sent[2].includes('在开头加一个标题'));   // a page that shows the change is checked as usual
});
