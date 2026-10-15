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
