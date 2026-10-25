import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import type { AgentRuntime } from './runtime/types.js';
import type { StudioEvent } from './events.js';

const PAGE = (id: string) => `ENGINE.visual('${id}', (P) => {\n  P.text('${id}', { x: 960, y: 540 });\n});\n`;

/** the page model writes its page; `asked` keeps each page session's prompts; `routes`: the router's answers, in turn
 *  (none: it answers nothing, and every message is a change) */
function artist(asked: Record<string, string[]>, routes: unknown[] = [], planner?: (text: string, cwd: string) => void): AgentRuntime {
  return {
    id: 'pi', model: { provider: 'x', id: 'flash' },
    async open(s) {
      return { ref: s.name, close: async () => {}, send: async ({ text }: { text: string }) => {
        (asked[s.name] ??= []).push(text);
        if (s.name.startsWith('page-')) {
          const id = s.name.slice(5), f = path.join(s.cwd, `pages/${id}.js`);
          fs.writeFileSync(f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') + '// changed\n' : PAGE(id));
        }
        if (s.name === 'reviser') planner?.(text, s.cwd);
        if (s.name === 'route') { const a = routes.shift(); return { text: '', stopReason: 'done', usage: {}, answers: a ? [{ name: 'route', args: a }] : [] } as never; }
        return { text: 'done', stopReason: 'done', usage: {}, answers: s.name.startsWith('check-') ? [{ name: 'verdict', args: { pass: true, problems: [] } }] : [] } as never;
      } };
    },
  };
}

function film(o: { pages?: number; firstPage?: boolean; routes?: unknown[]; planner?: (text: string, cwd: string) => void } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-firstpage-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(dir, 'script.js'), "(function (root) {\n  const META = {\n    style: 'whiteboard',\n    extras: [],\n  };\n  root.SCRIPT = { META, PAGES: [] };\n})(globalThis);\n");
  const asked: Record<string, string[]> = {}, events: StudioEvent[] = [];
  const art = artist(asked, o.routes, o.planner);
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
  assert.match(f.asked['page-p02'][0], /The user's directions for this film[\s\S]*线条再粗一点，配色更暖/);
  // the planner was asked first, with the change as one for the whole film
  assert.match(f.asked.reviser?.[0] ?? '', /first page \(p01\) is drawn[\s\S]*线条再粗一点[\s\S]*direction for the whole film/);
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

test('a question at the first page is answered and the page waits on, not redrawn; a change with a question is both', async () => {
  const f = film({ routes: [{ change: false, question: true, reply: 'Each page takes about a minute.' }, { change: true, question: true, reply: 'Sure.' }] });
  f.d.state.stage = 'pages';
  const answers = ['how long does each page take?', '线条再粗一点，可以吗？', undefined];
  await f.d.firstPage(async () => answers.shift());
  const notes = f.events.filter((e): e is Extract<StudioEvent, { type: 'note' }> => e.type === 'note').map((e) => e.text);
  assert.equal(notes[0], 'Each page takes about a minute.');
  assert.ok(notes.includes('Sure.'));
  // the question drew nothing and was not said again as a wait; the change redrew the first page once and waited again
  assert.equal(f.asked['page-p01'].length, 2);
  assert.doesNotMatch(f.asked['page-p01'].join('\n'), /how long does each page take/);
  assert.match(f.asked['page-p01'][1], /线条再粗一点/);
  assert.equal(f.events.filter((e) => e.type === 'first_page').length, 2);
  assert.equal(f.d.state.firstPage, 'done');
});

test('a change at the first page is made in the narration and the plan first, and every later redraw keeps it', async () => {
  const f = film({ planner: (text, cwd) => {
    // the planner takes the hook out of the narration, and tells the first page what to change
    const hook = /不要开头的提问/.test(text.split('\n')[1] ?? '');
    fs.appendFileSync(path.join(cwd, 'script.js'), `// ${hook ? 'hook' : 'more'}\n`);
    fs.mkdirSync(path.join(cwd, '.studio'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.studio/revision.json'), JSON.stringify({ pages: [{ id: 'p01', note: hook ? '去掉问号和问句，直接写结论' : '三栏都写满' }] }));
  } });
  f.d.state.stage = 'pages';
  const answers = ['不要开头的提问，直接讲内容', '所有内容都要有', undefined];
  await f.d.firstPage(async () => answers.shift());
  const notes = f.events.filter((e) => e.type === 'note').map((e) => (e as { text: string }).text);
  assert.ok(notes.some((n) => /改了口播/.test(n)), 'the user is told the narration changed');
  // the first page is drawn to the planner's note, not the bare words
  assert.match(f.asked['page-p01'][1], /去掉问号和问句/);
  // drawn a third time, the page and its reviewer still read the first direction (seen: the hook came back)
  assert.match(f.asked['page-p01'][2], /The user's directions for this film[\s\S]*不要开头的提问[\s\S]*所有内容都要有/);
  assert.match(f.asked['check-p01'].at(-1) ?? '', /outrank the storyboard[\s\S]*不要开头的提问/);
});
