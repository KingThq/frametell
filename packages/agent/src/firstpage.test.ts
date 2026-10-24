import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import type { AgentRuntime } from './runtime/types.js';
import type { StudioEvent } from './events.js';

const PAGE = (id: string) => `ENGINE.visual('${id}', (P) => {\n  P.text('${id}', { x: 960, y: 540 });\n});\n`;

/** the page model writes its page; `asked` keeps each page session's prompts */
function artist(asked: Record<string, string[]>): AgentRuntime {
  return {
    id: 'pi', model: { provider: 'x', id: 'flash' },
    async open(s) {
      return { ref: s.name, close: async () => {}, send: async ({ text }: { text: string }) => {
        (asked[s.name] ??= []).push(text);
        if (s.name.startsWith('page-')) {
          const id = s.name.slice(5), f = path.join(s.cwd, `pages/${id}.js`);
          fs.writeFileSync(f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') + '// changed\n' : PAGE(id));
        }
        return { text: 'done', stopReason: 'done', usage: {}, answers: s.name.startsWith('check-') ? [{ name: 'verdict', args: { pass: true, problems: [] } }] : [] } as never;
      } };
    },
  };
}

function film(o: { pages?: number; firstPage?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-firstpage-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(dir, 'script.js'), "(function (root) {\n  const META = {\n    style: 'whiteboard',\n    extras: [],\n  };\n  root.SCRIPT = { META, PAGES: [] };\n})(globalThis);\n");
  const asked: Record<string, string[]> = {}, events: StudioEvent[] = [];
  const art = artist(asked);
  const d = new Director({ dir, style: 'whiteboard', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime: art, reviewer: { runtime: art }, emit: (e) => events.push(e), ...(o.firstPage === false ? { firstPage: false } : {}) });
  const n = o.pages ?? 3;
  const sb = { title: 'T', summary: 'S', pages: Array.from({ length: n }, (_, i) => ({ id: `p0${i + 1}`, section: 's', say: '…', beats: [] })) };
  const timing = { duration: n * 5, pages: sb.pages.map((p, i) => ({ id: p.id, start: i * 5, end: i * 5 + 5, speechEnd: i * 5 + 4, cues: [] })) };
  Object.assign(d.project, { check: async () => ({ issues: [], sheet: 'sheet.jpg' }), lint: async () => [], snap: async () => 'sheet.jpg', commit: async () => undefined, storyboard: () => sb, timeline: async () => timing });
  return { d: d as unknown as Pick<Director, 'firstPage' | 'pages'> & { state: { stage: string; firstPage?: string; pages: Record<string, { status: string }> } }, dir, asked, events };
}
const drawn = (f: ReturnType<typeof film>) => Object.entries(f.d.state.pages).filter(([, s]) => s.status === 'ok').map(([id]) => id).sort();

test('the first page is drawn alone and waits for the user; a change is made to it and noted for the rest', async () => {
  const f = film();
  f.d.state.stage = 'pages';
  const answers = ['线条再粗一点，配色更暖', undefined];
  const seen: string[] = [];
  await f.d.firstPage(async () => { seen.push(drawn(f).join(',')); return answers.shift(); });
  // it waited twice, each time with only the first page drawn
  assert.deepEqual(seen, ['p01', 'p01']);
  assert.equal(f.events.filter((e) => e.type === 'first_page').length, 2);
  assert.ok(!f.events.some((e) => e.type === 'stage' && e.stage === 'pages' && e.status === 'done'), 'the pages stage is not over');
  // the change went to the first page as a revision of it
  assert.match(f.asked['page-p01'].at(-1) ?? '', /film's first page, drawn before the others[\s\S]*线条再粗一点/);
  assert.match(fs.readFileSync(path.join(f.dir, 'pages/p01.js'), 'utf8'), /\/\/ changed/);
  assert.equal(f.d.state.firstPage, 'done');
  // then the rest, which are told what the user said
  await f.d.pages();
  assert.deepEqual(drawn(f), ['p01', 'p02', 'p03']);
  assert.match(f.asked['page-p02'][0], /The user just added[\s\S]*线条再粗一点，配色更暖/);
  assert.equal(f.asked['page-p01'].length, 2, 'the first page is not drawn a third time');
  assert.equal(f.d.state.stage, 'review');
});

test('no wait for a one-page film, a host that turns it off, or a film whose other pages are drawn already', async () => {
  for (const f of [film({ pages: 1 }), film({ firstPage: false })]) {
    let asked = 0;
    await f.d.firstPage(async () => { asked++; return undefined; });
    assert.equal(asked, 0);
    assert.equal(f.d.state.firstPage, 'done');
  }
  const f = film();
  f.d.state.pages.p02 = { status: 'ok' } as never;
  let asked = 0;
  await f.d.firstPage(async () => { asked++; return undefined; });
  assert.equal(asked, 0);
});

test('a run picked up again while the first page waits does not say so a second time', async () => {
  const f = film();
  f.d.state.stage = 'pages';
  await f.d.firstPage(async () => { throw new DOMException('aborted', 'AbortError'); }).catch(() => {});
  assert.equal(f.events.filter((e) => e.type === 'first_page').length, 1);
  // the run continues (the user goes ahead after a restart): the wait is not announced again
  await f.d.firstPage(async () => undefined);
  assert.equal(f.events.filter((e) => e.type === 'first_page').length, 1);
  assert.equal(f.d.state.firstPage, 'done');
});
