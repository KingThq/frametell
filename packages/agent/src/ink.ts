// Where a picture's ink is: for a style that draws its pictures in on the page (a line first, its colour after), each
// picture gets a small map of its pixels, worked out once when it is drawn: an outline, a patch of colour, the ground
// it stands on, or nothing (a cut-out's transparency). The page decides the order (from where the ink starts) in the
// browser; it can't read the picture's own pixels there (a page opened from a file, or in a sandboxed preview, is
// another origin than its pictures), so it reads this instead: `<picture>.ink.js`, a script, which loads from anywhere.
import { pngPixels } from './pictures.js';

/** a pixel of the map: nothing there (a cut-out's transparency), a patch of colour, an outline, the ground */
export const INK = { none: 0, fill: 1, line: 2, ground: 3 } as const;
/** the map's longest side, in pixels */
export const INK_SIZE = 960;

/** the map of a PNG picture, its pixels coded INK and run-length packed; undefined for anything but a PNG */
export function inkMap(png: Uint8Array): { w: number; h: number; runs: string } | undefined {
  const img = pngPixels(png);
  if (!img) return undefined;
  const k = Math.max(1, Math.max(img.w, img.h) / INK_SIZE);
  const w = Math.max(1, Math.round(img.w / k)), h = Math.max(1, Math.round(img.h / k)), n = w * h;
  // box-averaged down to the map's size
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n), a = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x * k), x1 = Math.max(x0 + 1, Math.floor((x + 1) * k)), y0 = Math.floor(y * k), y1 = Math.max(y0 + 1, Math.floor((y + 1) * k));
    let sr = 0, sg = 0, sb = 0, sa = 0, c = 0;
    for (let yy = y0; yy < y1 && yy < img.h; yy++) for (let xx = x0; xx < x1 && xx < img.w; xx++) {
      const o = (yy * img.w + xx) * 4; sr += img.px[o]; sg += img.px[o + 1]; sb += img.px[o + 2]; sa += img.px[o + 3]; c++;
    }
    const i = y * w + x; r[i] = sr / c; g[i] = sg / c; b[i] = sb / c; a[i] = sa / c;
  }
  const lum = new Float32Array(n), solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) { lum[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i]; solid[i] = a[i] > 128 ? 1 : 0; }
  // an outline: dark, or darker than its neighbourhood by a clear step
  const R = Math.max(3, Math.round(w / 200)), I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += lum[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  const dark = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!solid[i]) continue;
    const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
    const mean = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    if (lum[i] < 80 || lum[i] < mean - 36) dark[i] = 1;
  }
  const code = new Uint8Array(n);
  for (let i = 0; i < n; i++) code[i] = solid[i] ? INK.fill : INK.none;
  // a speck is no outline: it needs two dark neighbours
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (!dark[i]) continue;
    const near = dark[i - 1] + dark[i + 1] + dark[i - w] + dark[i + w] + dark[i - w - 1] + dark[i - w + 1] + dark[i + w - 1] + dark[i + w + 1];
    if (near >= 2) code[i] = INK.line;
  }
  // the ground: pale, nearly grey, joined to the picture's edge (an opaque picture only)
  const pale = (i: number) => code[i] === INK.fill && Math.min(r[i], g[i], b[i]) > 214 && Math.max(r[i], g[i], b[i]) - Math.min(r[i], g[i], b[i]) < 24;
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;
  const visit = (i: number) => { if (pale(i)) { code[i] = INK.ground; queue[qt++] = i; } };
  for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
  while (qh < qt) {
    const i = queue[qh++], x = i % w, y = (i - x) / w;
    if (x > 0) visit(i - 1); if (x < w - 1) visit(i + 1); if (y > 0) visit(i - w); if (y < h - 1) visit(i + w);
  }
  // packed: each run is its code (2 bits) and its length less one, in base-32 digits: code·16 + 4 bits a byte,
  // continuation in the high bit; then base64
  const out: number[] = [];
  for (let i = 0; i < n;) {
    let j = i + 1; while (j < n && code[j] === code[i]) j++;
    let len = j - i - 1;
    out.push((code[i] << 4) | (len & 15) | (len > 15 ? 0x40 : 0)); len >>= 4;
    while (len > 0) { out.push((len & 63) | (len > 63 ? 0x40 : 0)); len >>= 6; }
    i = j;
  }
  return { w, h, runs: Buffer.from(out).toString('base64') };
}

/** the map as the script a page loads beside the picture (`<file>.ink.js`) */
export function inkScript(file: string, png: Uint8Array): string | undefined {
  const m = inkMap(png);
  return m && `(window.INK = window.INK || {})[${JSON.stringify(file)}] = ${JSON.stringify(m)};\n`;
}
