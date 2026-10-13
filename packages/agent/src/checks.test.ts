import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import type { AgentRuntime } from './runtime/types.js';
import type { LintIssue } from './project.js';

const PAGE = "ENGINE.visual('p01', (P) => {\n  P.text('hi', { x: 100, y: 100 });\n});\n";

/** a page agent that draws the page, then answers each check with the next reply (the last one repeating) */
const agent = (replies: string[], sent: string[]): AgentRuntime => ({
  id: 'pi', model: { provider: 'x', id: 'flash' },
  async open(s) {
    return { ref: 'r', close: async () => {}, send: async ({ text }: { text: string }) => {
      sent.push(text);
      if (sent.length === 1) { fs.writeFileSync(path.join(s.cwd, 'pages/p01.js'), PAGE); return { text: 'drawn', stopReason: 'done', usage: {} } as never; }
      return { text: replies[Math.min(sent.length - 2, replies.length - 1)], stopReason: 'done', usage: {} } as never;
    } };
  },
});

/** one page whose lint always reports `issues`; counts the lints and screenshots */
function film(pages: AgentRuntime, issues: LintIssue[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-checks-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  const d = new Director({ dir, style: 'chalkboard', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime: pages, pages: { runtime: pages } });
  const sb = { title: 'T', summary: 'S', pages: [{ id: 'p01', section: '开场', say: '…', beats: [] }] };
  const n = { lint: 0, snap: 0 };
  Object.assign(d.project, {
    lint: async () => { n.lint++; return issues; }, snap: async (name: string) => { if (!name.endsWith('-thumb')) n.snap++; return 'sheet.jpg'; }, commit: async () => undefined,
    storyboard: () => sb, timeline: async () => ({ duration: 5, pages: [{ id: 'p01', start: 0, end: 5, speechEnd: 4, cues: [] }] }),
  });
  return { d: d as unknown as { pages(): Promise<void>; state: { pages: Record<string, { status: string; issues: string[] }> } }, n };
}

const issue = (msg: string): LintIssue => ({ page: 'p01', t: 4.6, t1: 4.6, local: 4.6, msg });

test('advice alone never holds a page its agent called done', async () => {
  const sent: string[] = [];
  const { d, n } = film(agent(['DONE'], sent), [issue('sparse page: the drawing spans 30% of the content area'), issue('small text (18px < 24px): "km"')]);
  await d.pages();
  assert.equal(d.state.pages.p01.status, 'ok');
  assert.deepEqual(n, { lint: 1, snap: 1 });
  assert.match(sent[1], /advice only/);
});

test('done with a must-fix problem is asked once, then settled as it is, never checked again unchanged', async () => {
  const sent: string[] = [];
  const { d, n } = film(agent(['DONE'], sent), [issue('subtitle band (y>905): "orbit" bottom 930')]);
  await d.pages();
  assert.equal(d.state.pages.p01.status, 'flagged');
  assert.match(d.state.pages.p01.issues[0], /subtitle band/);
  assert.deepEqual(n, { lint: 1, snap: 1 });
  assert.equal(sent.length, 3);
  assert.match(sent[2], /You replied DONE/);
});

test('a must-fix problem the agent keeps on purpose is flagged with its reason', async () => {
  const sent: string[] = [];
  const { d } = film(agent(['DONE', 'FLAGGED: the label is meant to sit low'], sent), [issue('subtitle band (y>905): "orbit" bottom 930')]);
  await d.pages();
  assert.equal(d.state.pages.p01.status, 'flagged');
  assert.equal(d.state.pages.p01.issues[0], 'the label is meant to sit low');
});
