import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import type { AgentRuntime } from './runtime/types.js';

const PAGE = "ENGINE.visual('p01', (P) => {\n  P.text('hi', { x: 100, y: 100 });\n});\n";

/** a model that draws the page (draws) or fails the way a model service does (error) */
const model = (id: string, calls: string[], o: { draws?: boolean; error?: string }): AgentRuntime => ({
  id: 'pi', model: { provider: 'x', id },
  async open(s) {
    return { ref: 'r', close: async () => {}, send: async () => {
      calls.push(id);
      if (o.draws) { fs.writeFileSync(path.join(s.cwd, 'pages/p01.js'), PAGE); return { text: 'drawn', stopReason: 'done', usage: {}, answers: [] } as never; }
      return { text: '', stopReason: 'error', error: o.error, usage: {}, answers: [] } as never;
    } };
  },
});

/** a reviewer that passes every page */
const passing: AgentRuntime = {
  id: 'pi', model: { provider: 'y', id: 'haiku' },
  async open() { return { ref: 'v', close: async () => {}, send: async () => ({ text: '', stopReason: 'done', usage: {}, answers: [{ name: 'verdict', args: { pass: true, problems: [] } }] }) as never }; },
};

function film(pageModel: AgentRuntime, own: AgentRuntime) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-redraw-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  const d = new Director({ dir, style: 'chalkboard', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime: own, pages: { runtime: pageModel }, reviewer: { runtime: passing } });
  const sb = { title: 'T', summary: 'S', pages: [{ id: 'p01', section: '开场', say: '…', beats: [] }] };
  Object.assign(d.project, {
    check: async () => ({ issues: [], sheet: 'sheet.jpg' }), lint: async () => [], snap: async () => 'sheet.jpg', commit: async () => undefined,
    storyboard: () => sb, timeline: async () => ({ duration: 5, pages: [{ id: 'p01', start: 0, end: 5, speechEnd: 4, cues: [] }] }),
  });
  return d as unknown as { pages(): Promise<void>; state: { pages: Record<string, { status: string; failures?: number }> } };
}

test('a page that failed says why, and Continue draws it with the film\'s own model', async () => {
  const calls: string[] = [];
  const d = film(model('flash', calls, { error: '402 Insufficient Balance' }), model('opus', calls, { draws: true }));
  await assert.rejects(d.pages(), (e: Error) => /p01/.test(e.message) && /402 Insufficient Balance/.test(e.message) && /余额或额度/.test(e.message));
  assert.equal(d.state.pages.p01.failures, 1);
  assert.ok(!calls.includes('opus'));
  calls.length = 0;
  await d.pages();   // Continue
  assert.equal(d.state.pages.p01.status, 'ok');
  assert.ok(calls.includes('opus') && !calls.includes('flash'));
});

test('pages that keep failing ask the user how they should look', async () => {
  const calls: string[] = [];
  const d = film(model('flash', calls, {}), model('opus', calls, {}));
  await assert.rejects(d.pages(), /点继续，会换用更强的模型/);
  await assert.rejects(d.pages(), /说说这几页想怎么画/);
});

test('a page the run left in its checks picks up there on Continue, not drawn again', async () => {
  const sent: { resume?: string; text: string }[] = [], opened: (string | undefined)[] = [];
  const pages: AgentRuntime = {
    id: 'pi', model: { provider: 'x', id: 'flash' },
    async open(_s, resume) {
      opened.push(resume);
      return { ref: resume ?? 'fresh', close: async () => {}, send: async ({ text }: { text: string }) => { sent.push({ resume, text }); return { text: '', stopReason: 'done', usage: {}, answers: [] } as never; } };
    },
  };
  const d = film(pages, pages);
  fs.writeFileSync(path.join((d as unknown as { o: { dir: string } }).o.dir, 'pages/p01.js'), PAGE);
  d.state.pages.p01 = { status: 'checking', rounds: 2, issues: [], ref: 'session-p01' } as never;   // the server went down here
  await d.pages();
  assert.equal(d.state.pages.p01.status, 'ok');
  assert.deepEqual(opened, ['session-p01']);   // its own conversation, picked up
  assert.equal(sent.length, 0);   // checked where it was, and passed: never asked to draw it again
});
