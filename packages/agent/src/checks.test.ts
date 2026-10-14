import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import type { Answer, AgentRuntime, SessionOptions } from './runtime/types.js';
import type { LintIssue, PageCheck } from './project.js';

const PAGE = "ENGINE.visual('p01', (P) => {\n  P.text('hi', { x: 100, y: 100 });\n});\n";
const file = (dir: string) => path.join(dir, 'pages/p01.js');
type Reply = { text?: string; answers?: Answer[] };

/** a page agent that draws the page, then answers each fix request with `fix(n, dir)` (n: 1 for the first) */
const artist = (sent: string[], fix: (n: number, dir: string) => Reply = () => ({})): AgentRuntime => ({
  id: 'pi', model: { provider: 'x', id: 'flash' },
  async open(s) {
    return { ref: 'r', close: async () => {}, send: async ({ text }: { text: string }) => {
      sent.push(text);
      if (sent.length === 1) { fs.writeFileSync(file(s.cwd), PAGE); return { text: 'drawn', stopReason: 'done', usage: {}, answers: [] } as never; }
      const r = fix(sent.length - 1, s.cwd);
      return { text: r.text ?? '', stopReason: 'done', usage: {}, answers: r.answers ?? [] } as never;
    } };
  },
});

/** a reviewer that gives the n-th verdict for the n-th look (the last one repeating); null: it never calls verdict */
const reviewer = (seen: { text: string; images?: string[]; opts: SessionOptions }[], verdicts: ({ pass: boolean; problems?: { at: number; what: string; fix: string }[] } | null)[]): AgentRuntime => ({
  id: 'pi', model: { provider: 'y', id: 'haiku' },
  async open(opts) {
    let looks = 0;
    return { ref: 'v', close: async () => {}, send: async ({ text, images }: { text: string; images?: string[] }) => {
      seen.push({ text, images, opts });
      const v = images ? verdicts[Math.min(looks++, verdicts.length - 1)] : verdicts[Math.min(looks - 1, verdicts.length - 1)];
      return { text: '', stopReason: 'done', usage: {}, answers: v ? [{ name: 'verdict', args: { problems: [], ...v } }] : [] } as never;
    } };
  },
});

/** one page; each check finds `issues(n)` (n: 1 for the first check); counts the checks and what they were asked */
function film(pages: AgentRuntime, review: AgentRuntime, issues: (n: number) => LintIssue[] = () => []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-checks-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  const events: { type: string; session?: string }[] = [];
  const d = new Director({ dir, style: 'chalkboard', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime: pages, pages: { runtime: pages }, reviewer: { runtime: review }, emit: (e) => events.push(e as never) });
  const sb = { title: 'T', summary: 'S', pages: [{ id: 'p01', section: '开场', say: '…', beats: [] }] };
  const n = { check: 0, lint: 0, determinism: 0 };
  Object.assign(d.project, {
    check: async (_id: string, _name: string, _t: number[], o: { determinism?: boolean }): Promise<PageCheck> => { n.check++; if (o.determinism) n.determinism++; return { issues: issues(n.check), sheet: `sheet-${n.check}.jpg` }; },
    lint: async () => { n.lint++; return issues(n.check); },
    snap: async () => 'thumb.jpg', commit: async () => undefined,
    storyboard: () => sb, timeline: async () => ({ duration: 5, pages: [{ id: 'p01', start: 0, end: 5, speechEnd: 4, cues: [] }] }),
  });
  return { d: d as unknown as { pages(): Promise<void>; state: { pages: Record<string, { status: string; issues: string[] }> } }, n, dir, events };
}

const issue = (kind: LintIssue['kind'], level: LintIssue['level'], msg: string): LintIssue => ({ page: 'p01', t: 4.6, t1: 4.6, local: 4.6, kind, level, msg });
const edit = (dir: string, mark: string) => fs.writeFileSync(file(dir), PAGE.replace("'hi'", `'${mark}'`));

test('a page the reviewer passes, with only advice from lint, is done after one check, with no fix round', async () => {
  const sent: string[] = [], seen: { text: string; images?: string[]; opts: SessionOptions }[] = [];
  const { d, n } = film(artist(sent), reviewer(seen, [{ pass: true }]), () => [issue('sparse', 'warn', 'sparse page: the drawing spans 30% of the content area')]);
  await d.pages();
  assert.equal(d.state.pages.p01.status, 'ok');
  assert.equal(sent.length, 1);
  assert.deepEqual(n, { check: 1, lint: 0, determinism: 1 });
  assert.match(seen[0].text, /Advice[^\n]*\n- 4.6s: sparse page/);
  assert.deepEqual(seen[0].images, ['sheet-1.jpg']);
  assert.equal(seen[0].opts.tools, 'none');
  assert.equal(seen[0].opts.name, 'check-p01');
});

test('the reviewer\'s problems go back to the page agent, and the page is done once the reviewer passes it', async () => {
  const sent: string[] = [], seen: { text: string; images?: string[]; opts: SessionOptions }[] = [];
  const problem = { at: 2.1, what: 'the label covers the bamboo', fix: 'move the label up 80px' };
  const { d, n } = film(artist(sent, (_n, dir) => { edit(dir, 'moved'); return {}; }), reviewer(seen, [{ pass: false, problems: [problem] }, { pass: true }]));
  await d.pages();
  assert.equal(d.state.pages.p01.status, 'ok');
  assert.equal(n.check, 2);
  assert.match(sent[1], /2\.1s: the label covers the bamboo → move the label up 80px/);
  assert.match(seen[1].text, /^Round 2/);
});

test('a lint error holds a page the reviewer passes, and goes back to the page agent', async () => {
  const sent: string[] = [], seen: { text: string; images?: string[]; opts: SessionOptions }[] = [];
  const band = issue('subtitle-band', 'error', 'subtitle band (y>905): "orbit" bottom 930');
  const { d, n } = film(artist(sent, (_n, dir) => { edit(dir, 'up'); return {}; }), reviewer(seen, [{ pass: true }]), (k) => (k === 1 ? [band] : []));
  await d.pages();
  assert.equal(d.state.pages.p01.status, 'ok');
  assert.equal(n.check, 2);
  assert.match(sent[1], /must fix:\n- 4.6s: subtitle band/);
  assert.match(seen[0].text, /Must-fix \(already sent to the artist\)/);
});

test('a problem the page agent keeps on purpose is flagged with its reason, and not checked again', async () => {
  const sent: string[] = [], seen: { text: string; images?: string[]; opts: SessionOptions }[] = [];
  const { d, n } = film(artist(sent, () => ({ answers: [{ name: 'flag', args: { reason: 'the label is meant to sit low' } }] })), reviewer(seen, [{ pass: false, problems: [{ at: 1, what: 'label low', fix: 'raise it' }] }]));
  await d.pages();
  assert.equal(d.state.pages.p01.status, 'flagged');
  assert.deepEqual(d.state.pages.p01.issues, ['the label is meant to sit low']);
  assert.deepEqual(n, { check: 1, lint: 0, determinism: 1 });
});

test('a page agent that changes nothing settles the page as it is, with what is still wrong', async () => {
  const sent: string[] = [], seen: { text: string; images?: string[]; opts: SessionOptions }[] = [];
  const { d, n } = film(artist(sent), reviewer(seen, [{ pass: false, problems: [{ at: 3, what: 'the chart is cut off on the right', fix: 'shrink it' }] }]));
  await d.pages();
  assert.equal(d.state.pages.p01.status, 'flagged');
  assert.deepEqual(d.state.pages.p01.issues, ['3.0s：the chart is cut off on the right']);
  assert.equal(n.check, 1);
});

test('a page still failing after its last check is flagged with the reviewer\'s problems', async () => {
  const sent: string[] = [], seen: { text: string; images?: string[]; opts: SessionOptions }[] = [];
  const { d, n } = film(artist(sent, (k, dir) => { edit(dir, `try${k}`); return {}; }), reviewer(seen, [{ pass: false, problems: [{ at: 3, what: 'still crowded', fix: 'drop a label' }] }]));
  await d.pages();
  assert.equal(n.check, 3);
  assert.equal(sent.length, 3);   // the draft and two fix rounds: the third check settles the page
  assert.equal(d.state.pages.p01.status, 'flagged');
  assert.deepEqual(d.state.pages.p01.issues, ['3.0s：still crowded']);
});

test('a reviewer that gives no verdict is asked once more, then the page stands on its lint', async () => {
  const sent: string[] = [], seen: { text: string; images?: string[]; opts: SessionOptions }[] = [];
  const { d } = film(artist(sent), reviewer(seen, [null]));
  await d.pages();
  assert.equal(d.state.pages.p01.status, 'ok');
  assert.equal(seen.length, 2);
  assert.match(seen[1].text, /calling verdict/);
});

test('the reviewer\'s words never reach the people watching; its turns are still counted', async () => {
  const counted: string[] = [];
  const watched: AgentRuntime = {
    id: 'pi', model: { provider: 'y', id: 'haiku' },
    async open(o) {
      return { ref: 'v', close: async () => {}, send: async () => {
        o.onEvent?.({ type: 'text', text: 'looks fine' });
        o.onEvent?.({ type: 'turn', usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } });
        counted.push(o.name);
        return { text: '', stopReason: 'done', usage: {}, answers: [{ name: 'verdict', args: { pass: true, problems: [] } }] } as never;
      } };
    },
  };
  const { d, events } = film(artist([]), watched);
  await d.pages();
  const review = events.filter((e) => e.session === 'check-p01') as unknown as { event: { type: string } }[];
  assert.deepEqual(review.map((e) => e.event.type), ['turn']);
  assert.deepEqual(counted, ['check-p01']);
});
