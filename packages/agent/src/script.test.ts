import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import type { AgentRuntime } from './runtime/types.js';

/** the narration step of a three-page storyboard; `narrate(n)` is which pages the planner's n-th reply has narrated */
async function script(narrate: (n: number) => string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-script-'));
  fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ title: 'T', pages: ['p01', 'p02', 'p03'].map((id) => ({ id, section: id, say: '…', beats: [] })) }));
  const sent: string[] = [];
  let narrated: string[] = [];
  const runtime: AgentRuntime = { id: 'pi', model: { provider: 'x', id: 'x' }, open: async () => ({ ref: 'r', close: async () => {}, send: async (i) => { sent.push(i.text); narrated = narrate(sent.length); return { text: 'ok', stopReason: 'done', usage: {} } as never; } }) };
  const d = new Director({ dir, style: 'chalkboard', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime });
  Object.assign(d.project, { scriptCheck: async () => ({ code: 0, out: 'ok', err: '' }), timeline: async () => ({ pages: narrated.map((id) => ({ id })) }), commit: async () => undefined });
  Object.assign(d as object, { serverMeta: () => {} });
  const error = await d.script().then(() => undefined, (e: Error) => e.message);
  return { sent, error };
}

test('a narration that stops before the storyboard ends is asked for the rest', async () => {
  const { sent, error } = await script((n) => (n === 1 ? ['p01'] : ['p01', 'p02', 'p03']));
  assert.equal(error, undefined);
  assert.equal(sent.length, 2);
  assert.match(sent[1], /no narration for p02, p03/);
});

test('a narration still short of the storyboard stops the film, saying which pages', async () => {
  const { sent, error } = await script(() => ['p01']);
  assert.equal(sent.length, 3);
  assert.match(error ?? '', /p02、p03 没有口播/);
});

/** the narration step of a 1-minute film whose planner's n-th reply is estimated at `seconds(n)` */
async function timed(seconds: (n: number) => number, feedback?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-script-'));
  fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ title: 'T', pages: [{ id: 'p01', section: 'p01', say: '…', beats: [] }] }));
  const sent: string[] = [];
  const runtime: AgentRuntime = { id: 'pi', model: { provider: 'x', id: 'x' }, open: async () => ({ ref: 'r', close: async () => {}, send: async (i) => { sent.push(i.text); return { text: 'ok', stopReason: 'done', usage: {} } as never; } }) };
  const d = new Director({ dir, style: 'chalkboard', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime });
  Object.assign(d.project, { scriptCheck: async () => ({ code: 0, out: 'ok', err: '' }), timeline: async () => ({ duration: seconds(sent.length), pages: [{ id: 'p01' }] }), commit: async () => undefined });
  Object.assign(d as object, { serverMeta: () => {} });
  await d.script(feedback);
  return sent;
}

test('a narration is never sent back for its length, long or short', async () => {
  for (const sec of [150, 50, 80, 60]) assert.equal((await timed(() => sec)).length, 1, `${sec} s`);
  assert.equal((await timed(() => 150, 'add a page on the history')).length, 1);
});

test('a storyboard with more pages than the length holds is red; the length is the server\'s', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sb-'));
  const page = (id: string) => ({ id, section: id, say: '…', beats: [] });
  const d = new Director({ dir, style: 'chalkboard', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime: {} as AgentRuntime });
  const issues = () => (d as unknown as { lengthIssues(): { msg: string }[] }).lengthIssues();
  fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ title: 'T', pages: Array.from({ length: 5 }, (_, i) => page(`p0${i + 1}`)) }));
  assert.deepEqual(issues(), []);
  fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ title: 'T', pages: Array.from({ length: 6 }, (_, i) => page(`p0${i + 1}`)) }));
  assert.match(issues()[0].msg, /6 pages for a 1-minute film: at most 5/);
});
