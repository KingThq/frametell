import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import { writeIn } from './projectfs.js';
import { picturePageNote, picturePlan, pictureIssues, picturePrompt, picturesOn, readPictures, sniffPicture, type ImageProvider, type PictureStyle } from './pictures.js';
import type { AgentRuntime } from './runtime/types.js';
import type { StudioEvent } from './events.js';

const STYLE: PictureStyle = { kinds: ['object', 'character', 'scene'], max: 4, quality: 'medium', prefix: 'Flat vector, two-tone fills, no outlines', avoid: 'No text.' };
const ids = ['p01', 'p02', 'p03'];

/** a PNG's first bytes (signature and IHDR) with `seed` after them, so every picture drawn is a file of its own */
function png(w: number, h: number, seed: number, alpha = true) {
  const b = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = 8; b[25] = alpha ? 6 : 2;
  b.writeUInt32BE(seed, 33);
  return new Uint8Array(b);
}

test('the storyboard\'s pictures: the well-formed ones, the sample first; a `like` only to one listed before it', () => {
  const look = { pictures: [
    { id: 'bird', kind: 'character', what: 'a small round bird', shape: 'square', pages: ['p01', 'p02'] },
    { id: 'chart', kind: 'texture', what: 'paper', pages: ['p01'] },               // a kind this style doesn't draw
    { id: 'bird-fly', kind: 'character', what: 'the bird flying', pages: ['p03'], like: 'bird' },
    { id: 'whale', kind: 'object', what: 'a whale', shape: 'oval', pages: ['p02'], like: 'bird-fly' },   // like a like: dropped
  ] };
  assert.deepEqual(picturePlan(look, STYLE).map((p) => [p.id, p.shape, p.like]), [['bird', 'square', undefined], ['bird-fly', 'wide', 'bird'], ['whale', 'wide', undefined]]);
  assert.deepEqual(picturePlan(look, undefined), []);
  const issues = pictureIssues(look, ids, STYLE).join('\n');
  assert.match(issues, /chart has kind "texture"; this style draws object, character, scene/);
  assert.match(issues, /chart needs `what`/);
  assert.match(issues, /whale has shape "oval"/);
  assert.match(issues, /whale is `like` bird-fly, which is itself `like` another/);
  assert.deepEqual(pictureIssues({}, ids, STYLE), []);
  const first = pictureIssues({ pictures: [{ id: 'a1', kind: 'object', what: 'a red kettle on its base', pages: ['p09'], like: 'b1' }] }, ids, STYLE).join('\n');
  assert.match(first, /names pages the storyboard does not have: p09/);
  assert.match(first, /a1 is the first picture, the film's sample/);
  assert.match(pictureIssues({ pictures: Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, kind: 'object', what: 'a thing to draw', pages: ['p01'] })) }, ids, STYLE).join('\n'), /lists 5 pictures: this style allows 4/);
});

test('a picture\'s prompt: the style\'s words, the subject, what the reference is for, the user\'s adjustments', () => {
  const [p] = picturePlan({ pictures: [{ id: 'whale', kind: 'object', what: 'a humpback whale.', pages: ['p01'] }] }, STYLE);
  const prompt = picturePrompt(STYLE, p, ['brighter colours'], 'look', 'mouth open');
  assert.match(prompt, /^Flat vector, two-tone fills, no outlines\.\nOne object alone[^\n]*transparent background/);
  assert.match(prompt, /Subject: a humpback whale\.\n/);
  assert.match(prompt, /reference image shows the look of this film/);
  assert.match(prompt, /Adjustments to the look: brighter colours\.\nFor this picture: mouth open\.\nNo text\.$/);
});

test('a picture\'s type and size are read from its first bytes', () => {
  assert.deepEqual(sniffPicture(png(1536, 1024, 1)), { type: 'png', w: 1536, h: 1024, alpha: true });
  assert.deepEqual(sniffPicture(png(800, 600, 1, false)), { type: 'png', w: 800, h: 600, alpha: false });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(sniffPicture(jpg), { type: 'jpg', w: 800, h: 600, alpha: false });
  assert.equal(sniffPicture(new TextEncoder().encode('{"error":"nope"}')), undefined);
});

/** an image service that draws a PNG for each call and keeps what it was asked */
function service(calls: { prompt: string; refs: number; transparent: boolean }[], o: { fail?: RegExp } = {}): ImageProvider {
  let n = 0;
  return {
    model: 'test-image',
    async draw({ prompt, refs, transparent }) {
      calls.push({ prompt, refs: refs?.length ?? 0, transparent });
      if (o.fail?.test(prompt)) throw new Error('image service 500: busy');
      return png(1536, 1024, ++n, transparent);
    },
  };
}

const PLAN = [
  { id: 'bird', kind: 'character', what: 'a small round bird with big eyes', shape: 'square', pages: ['p01', 'p02'] },
  { id: 'whale', kind: 'object', what: 'a humpback whale gliding left', pages: ['p02'] },
  { id: 'bird-fly', kind: 'character', what: 'the bird flying to the right', pages: ['p03'], like: 'bird' },
];

function film(o: { fail?: RegExp } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-pictures-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  const calls: { prompt: string; refs: number; transparent: boolean }[] = [], events: StudioEvent[] = [];
  const none: AgentRuntime = { id: 'pi', model: { provider: 'x', id: 'y' }, open: async () => { throw new Error('no model here'); } };
  const d = new Director({ dir, style: 'vector', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime: none, images: service(calls, o), emit: (e) => events.push(e) });
  const sb: { title: string; summary: string; look: { pictures?: object[] }; pages: object[] } = { title: 'T', summary: 'S', look: { pictures: PLAN }, pages: ids.map((id) => ({ id, section: 's', say: '…', beats: [] })) };
  Object.assign(d.project, { commit: async () => undefined, storyboard: () => sb, timeline: async () => ({ duration: 15, pages: [] }) });
  Object.assign(d, { pictureStyle: () => STYLE });
  return { d: d as unknown as Pick<Director, 'pictures' | 'redrawPicture'> & { state: { stage: string; exported?: boolean; pictures?: string } }, dir, calls, events, sb };
}
const pictureEvents = (events: StudioEvent[]) => events.filter((e): e is Extract<StudioEvent, { type: 'picture' }> => e.type === 'picture');

test('after the go-ahead the first picture is drawn from nothing, the rest from it, and a `like` from its own', async () => {
  const f = film();
  await f.d.pictures();
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].refs, 0);
  assert.ok(f.calls[0].transparent, 'a character is cut out');
  const whale = f.calls.find((c) => /humpback/.test(c.prompt))!, fly = f.calls.find((c) => /bird flying/.test(c.prompt))!;
  assert.equal(whale.refs, 1);
  assert.match(whale.prompt, /shows the look of this film/);
  assert.equal(fly.refs, 1);
  assert.match(fly.prompt, /shows this very subject: keep it exactly the same/);
  assert.equal(f.d.state.pictures, 'done');
  const items = readPictures(f.dir).items;
  assert.deepEqual(items.map((p) => p.id).sort(), ['bird', 'bird-fly', 'whale']);
  assert.match(items.find((p) => p.id === 'bird')!.file, /^bird-[0-9a-f]{10}\.png$/);
  assert.ok(pictureEvents(f.events).some((e) => e.id === 'bird' && e.status === 'done' && e.sample));
  // fixed for the pages: the agents' file tools refuse them
  assert.throws(() => writeIn(f.dir, `assets/gen/${items[0].file}`, 'x'), /every page of this film uses it/);
  // a resumed run draws nothing again
  f.d.state.pictures = undefined;
  await f.d.pictures();
  assert.equal(f.calls.length, 3);
});

test('no picture is drawn again while the storyboard waits: there is nothing drawn yet', async () => {
  const f = film();
  f.d.state.stage = 'approval';
  await f.d.redrawPicture('bird', 'brighter');
  assert.equal(f.calls.length, 0);
});

test('a picture that can\'t be had is left out, said, and never holds the film up', async () => {
  const f = film({ fail: /humpback/ });
  await f.d.pictures();
  assert.equal(f.calls.filter((c) => /humpback/.test(c.prompt)).length, 2, 'tried once more');
  assert.deepEqual(readPictures(f.dir).items.map((p) => p.id).sort(), ['bird', 'bird-fly']);
  const failed = pictureEvents(f.events).find((e) => e.status === 'failed');
  assert.equal(failed?.id, 'whale');
  assert.match(failed?.detail ?? '', /busy/);
  assert.equal(f.d.state.pictures, 'done');
});

test('each page is told the pictures the storyboard puts on it, with the call that places them', async () => {
  const f = film();
  await f.d.pictures();
  const on = picturesOn(picturePlan(f.sb.look, STYLE), readPictures(f.dir).items, 'p02');
  assert.deepEqual(on.map((p) => p.id), ['bird', 'whale']);
  const note = picturePageNote(on);
  assert.match(note, /`assets\/gen\/whale-[0-9a-f]{10}\.png` \(picture whale\): object, 1536×1024, transparent background/);
  assert.match(note, /P\.img\('assets\/gen\/whale-[0-9a-f]{10}\.png', x, y, w, w \* 1024 \/ 1536, \{ fit: 'contain'/);
  assert.equal(picturePageNote(picturesOn(picturePlan(f.sb.look, STYLE), readPictures(f.dir).items, 'p09')), '');
});

test('a finished film\'s picture drawn again: from the picture as it is, and its pages point at the new file', async () => {
  const f = film();
  await f.d.pictures();
  const old = readPictures(f.dir).items.find((p) => p.id === 'whale')!;
  fs.writeFileSync(path.join(f.dir, 'pages/p02.js'), `ENGINE.visual('p02', (P) => { P.img('assets/gen/${old.file}', 0, 0, 800, 533); });\n`);
  f.d.state.stage = 'done';
  await f.d.redrawPicture('whale', '嘴巴张开');
  const call = f.calls.at(-1)!;
  assert.equal(call.refs, 1);
  assert.match(call.prompt, /shows this very subject[\s\S]*For this picture: 嘴巴张开/);
  const now = readPictures(f.dir).items.find((p) => p.id === 'whale')!;
  assert.notEqual(now.file, old.file);
  assert.equal(now.note, '嘴巴张开');
  assert.match(fs.readFileSync(path.join(f.dir, 'pages/p02.js'), 'utf8'), new RegExp(`assets/gen/${now.file}`));
  assert.equal(f.d.state.exported, false);
  assert.ok(f.events.some((e) => e.type === 'ready'));
  // a revision keeps it: drawn with the user's note, it is not drawn over from the plain prompt
  f.d.state.pictures = undefined;
  const n = f.calls.length;
  await f.d.pictures();
  assert.equal(f.calls.length, n);
});

test('a picture of the person\'s own subject is drawn from their file; an SVG of theirs needs no picture', () => {
  const own = ['assets/brand/buzz-1a2b3c.png', 'assets/user/logo-0123456789.svg'];
  const look = { pictures: [
    { id: 'buzz', kind: 'character', what: 'Buzz the horsefly, smiling, waving', pages: ['p01'], from: 'assets/brand/buzz-1a2b3c.png' },
    { id: 'buzz-cheer', kind: 'character', what: 'Buzz cheering', pages: ['p02'], like: 'buzz', from: 'assets/brand/buzz-1a2b3c.png' },
    { id: 'logo', kind: 'object', what: 'the company logo', pages: ['p02'], from: 'assets/user/logo-0123456789.svg' },
    { id: 'cat', kind: 'character', what: 'a grey cat sitting', pages: ['p03'], from: 'assets/brand/nope.png' },
  ] };
  assert.deepEqual(picturePlan(look, STYLE, own).map((p) => [p.id, p.from, p.like]), [['buzz', 'assets/brand/buzz-1a2b3c.png', undefined], ['buzz-cheer', undefined, 'buzz'], ['logo', undefined, undefined], ['cat', undefined, undefined]]);
  const issues = pictureIssues(look, ids, STYLE, own).join('\n');
  assert.match(issues, /buzz-cheer has both `like` and `from`/);
  assert.match(issues, /logo is `from` assets\/user\/logo-0123456789\.svg, an SVG: place the person's SVG itself/);
  assert.match(issues, /cat is `from` "assets\/brand\/nope\.png", which is not one of the person's pictures/);
  assert.doesNotMatch(issues, /buzz is/);
  const [p] = picturePlan(look, STYLE, own);
  assert.match(picturePrompt(STYLE, p, [], 'own'), /the person's own picture of this subject/);
});

test('the sample drawn from the person\'s own file, and the rest from the sample', async () => {
  const f = film();
  const brand = 'assets/brand/buzz-1a2b3c.png';
  fs.mkdirSync(path.join(f.dir, 'assets/brand'), { recursive: true });
  fs.writeFileSync(path.join(f.dir, brand), png(400, 400, 99));
  f.sb.look = { pictures: [{ ...PLAN[0], from: brand }, ...PLAN.slice(1)] };
  Object.assign(f.d, { own: () => [brand] });
  await f.d.pictures();
  const bird = f.calls.find((c) => /round bird/.test(c.prompt))!;
  assert.equal(bird.refs, 1);
  assert.match(bird.prompt, /the person's own picture of this subject/);
  assert.match(f.calls.find((c) => /humpback/.test(c.prompt))!.prompt, /shows the look of this film/);
});

test('a change that adds pictures has them drawn before its pages', async () => {
  const f = film();
  f.sb.look = {};
  fs.writeFileSync(path.join(f.dir, 'script.js'), '');
  fs.writeFileSync(path.join(f.dir, 'storyboard.json'), '{}');
  const order: string[] = [];
  // each read is the storyboard as it is on disk now, as the real one is
  Object.assign((f.d as unknown as Director).project, { storyboard: () => structuredClone(f.sb) });
  Object.assign(f.d, {
    planRevision: async () => { f.sb.look = { pictures: PLAN }; order.push('plan'); return { plan: [{ id: 'p01', note: 'picture bird: the seller as a person' }] }; },
    pictures: async () => { order.push('pictures'); },
    pages: async () => { order.push('pages'); },
    review: async () => {},
    serverMeta: () => {},
  });
  await (f.d as unknown as Director).revise('make the people look like people');
  assert.deepEqual(order, ['plan', 'pictures', 'pages']);
  // a change that leaves the pictures as they are draws none
  order.length = 0;
  await (f.d as unknown as Director).revise('make the title bigger');
  assert.deepEqual(order, ['plan', 'pages']);
});
