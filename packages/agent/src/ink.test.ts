import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { INK, inkMap, inkScript } from './ink.js';

/** an RGBA PNG of w×h from a function of the pixel */
function png(w: number, h: number, at: (x: number, y: number) => [number, number, number, number]) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(at(x, y), y * (w * 4 + 1) + 1 + x * 4);
  const chunk = (type: string, data: Buffer) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
/** the map's codes, unpacked as the page does */
function codes(m: { w: number; h: number; runs: string }) {
  const out = new Uint8Array(m.w * m.h), b = Buffer.from(m.runs, 'base64');
  for (let p = 0, i = 0; p < b.length;) {
    let c = b[p++], len = c & 15, shift = 4, more = c & 0x40;
    const v = (c >> 4) & 3;
    while (more) { c = b[p++]; len |= (c & 63) << shift; shift += 6; more = c & 0x40; }
    out.fill(v, i, i + len + 1); i += len + 1;
  }
  return out;
}

test('a picture\'s ink map: its outlines, its colour, its ground and a cut-out\'s transparency', () => {
  // pale ground; a dark ring round a red patch in the middle; the right edge transparent
  const pic = png(80, 60, (x, y) => {
    if (x >= 76) return [0, 0, 0, 0];
    const d = Math.hypot(x - 38, y - 30);
    return d < 12 ? [220, 60, 50, 255] : d < 15 ? [20, 20, 30, 255] : [246, 242, 233, 255];
  });
  const m = inkMap(pic)!;
  assert.deepEqual([m.w, m.h], [80, 60]);
  const c = codes(m);
  assert.equal(c[30 * 80 + 38], INK.fill);
  assert.equal(c[30 * 80 + 38 + 13], INK.line);
  assert.equal(c[5 * 80 + 5], INK.ground);
  assert.equal(c[30 * 80 + 78], INK.none);
  assert.match(inkScript('p01-a-0123456789.png', pic)!, /^\(window\.INK = window\.INK \|\| \{\}\)\["p01-a-0123456789\.png"\] = \{"w":80,"h":60,"runs":"/);
  assert.equal(inkMap(new Uint8Array([0xff, 0xd8, 0xff])), undefined);
});
