import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { FFMPEG } from '@frametell/engine/tools/bins.mjs';
import { directChild, mediaDuration, scriptData } from './narrate.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('script.js is read as data by a child process: code in it that reaches for its process never reaches this one', async () => {
  const dir = tmp('ft-scriptdata-');
  try {
    fs.writeFileSync(path.join(dir, 'script.js'), `(function (root) {
  try { root.constructor.constructor('return process')().env.FRAMETELL_REACHED_HOST = 'yes'; } catch {}
  root.SCRIPT = { META: { lang: 'zh', voice: { speaker: 'v1' } }, PAGES: [{ id: 'p01', cues: ['第一句。', { t: '第二句。', hold: 0.5 }] }] };
})(globalThis);`);
    const data = await scriptData(dir, directChild);
    assert.equal(process.env.FRAMETELL_REACHED_HOST, undefined);
    assert.deepEqual(data.pages.map((p) => p.id), ['p01']);
    assert.equal(data.meta.voice.speaker, 'v1');
    assert.equal(data.duration, null);
    fs.writeFileSync(path.join(dir, 'voice.js'), 'SCRIPT.VOICE = { speaker: "v1", pages: [[{ t: "第一句。", f: "audio/a.wav", d: 3, o: 0 }, { t: "第二句。", f: "audio/b.wav", d: 2, o: 0 }]] };');
    assert.ok((await scriptData(dir, directChild, { voice: true })).duration! > 4);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ffmpeg reads only local files: a "sound" that is really a playlist of web addresses fetches nothing', async () => {
  let hits = 0;
  const server = http.createServer((_q, s) => { hits++; s.statusCode = 404; s.end(); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const dir = tmp('ft-playlist-');
  try {
    const list = path.join(dir, 'take.m3u8');
    fs.writeFileSync(list, `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:${(server.address() as AddressInfo).port}/seg.ts\n#EXT-X-ENDLIST\n`);
    // the control: an ffmpeg that may use the network does ask the address (else this test proves nothing here). Not
    // ffmpeg left to itself: since 3.0 what a local file opens inherits the file protocol's own whitelist, so the
    // explicit one is what a later default or a wider list handed down cannot undo
    await new Promise<void>((r) => execFile(FFMPEG, ['-hide_banner', '-protocol_whitelist', 'file,http,tcp', '-i', list], () => r()));
    assert.ok(hits > 0, 'control: ffmpeg with the network allowed fetched nothing, so the check below would say nothing');
    hits = 0;
    const argvs: string[][] = [];
    await mediaDuration(dir, list, (d, cmd, argv) => { argvs.push(argv); return directChild(d, cmd, argv); }).catch(() => undefined);
    assert.equal(hits, 0);
    const [argv] = argvs;
    assert.equal(argv[argv.indexOf('-protocol_whitelist') + 1], 'file,pipe');
    assert.ok(argv.indexOf('-protocol_whitelist') < argv.indexOf('-i'), 'the whitelist comes before the input it applies to');
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

/** a child that prints `answer` whatever it was asked to run: what a script.js that took over its child could print */
const forged = (answer: unknown) => ((dir: string) => directChild(dir, process.execPath, ['-e', `console.log(${JSON.stringify(JSON.stringify(answer))})`])) as typeof directChild;

test('what the child prints is checked before it is used: page ids that name a path, and fields of the wrong shape, are refused', async () => {
  const dir = tmp('ft-forged-');
  const page = { id: 'p01', cues: ['一。', { t: '二。', say: 'two', hold: 0.5, solo: { instruction: 'soft', pitch: 1, rate: 2 } }], instruction: 'calm' };
  try {
    // the control: a well-formed answer is taken as it is
    const ok = await scriptData(dir, forged({ meta: { voice: { speaker: 'v1' } }, pages: [page], duration: 3.5 }));
    assert.deepEqual(ok.pages, [page]);
    assert.equal(ok.duration, 3.5);
    const bad: [string, unknown][] = [
      ['an id that is a path', { meta: {}, pages: [{ ...page, id: '../../x' }], duration: null }],
      ['an id with a slash', { meta: {}, pages: [{ ...page, id: 'a/b' }], duration: null }],
      ['an empty id', { meta: {}, pages: [{ ...page, id: '' }], duration: null }],
      ['an id too long', { meta: {}, pages: [{ ...page, id: 'a'.repeat(81) }], duration: null }],
      ['an id that is not a string', { meta: {}, pages: [{ ...page, id: 7 }], duration: null }],
      ['cues that are not a list', { meta: {}, pages: [{ ...page, cues: 'x' }], duration: null }],
      ['a cue of the wrong shape', { meta: {}, pages: [{ ...page, cues: [{ t: 5 }] }], duration: null }],
      ['a cue whose say is not text', { meta: {}, pages: [{ ...page, cues: [{ t: 'a', say: {} }] }], duration: null }],
      ['a cue whose solo is not an object', { meta: {}, pages: [{ ...page, cues: [{ t: 'a', solo: 'x' }] }], duration: null }],
      ['an instruction that is not text', { meta: {}, pages: [{ ...page, instruction: 5 }], duration: null }],
      ['a length that is text', { meta: {}, pages: [page], duration: '3' }],
      ['meta that is not an object', { meta: [1], pages: [page], duration: null }],
      ['meta missing', { pages: [page], duration: null }],
      ['pages that is not a list', { meta: {}, pages: {}, duration: null }],
    ];
    for (const [what, answer] of bad) await assert.rejects(scriptData(dir, forged(answer)), /script\.js/, what);
    // JSON has no Infinity, but 1e999 parses to it
    const inf = (dir2: string) => directChild(dir2, process.execPath, ['-e', `console.log('{"meta":{},"pages":[],"duration":1e999}')`]);
    await assert.rejects(scriptData(dir, inf), /script\.js/, 'a length that is not finite');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
