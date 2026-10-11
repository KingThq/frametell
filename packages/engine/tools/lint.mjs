// Layout pre-check (no model, no screenshots): samples each page every 0.5s and reports visible text that
// runs off the canvas / safe area, sits in the subtitle band, overlaps other text, or renders too small to read.
// Per page it also checks the settled state (body fills the content area, text doesn't dominate) and, with
// --determinism, that a frame renders identically whether reached from the start or from elsewhere on the timeline.
// node engine/tools/lint.mjs [--only p01,p02] [--step 0.5] [--min-font 24] [--determinism] [--json]  → prints issues; exit 0.
import fs from 'fs';
import path from 'path';
import { openStage, loadEpisode, closeStage, EP, PORTRAIT } from './lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const only = arg('only', null), step = +arg('step', 0.5), minFont = +arg('min-font', 24), asJson = process.argv.includes('--json'), determinism = process.argv.includes('--determinism');
const { L, META } = loadEpisode();
L.meta = META;
const pages = L.pages.filter((p) => !only || only.split(',').includes(p.id));
const { browser, page } = await openStage('render' + (only ? '&only=' + only : ''));
const issues = [];
// how much of a page is on screen at time t: visible strokes, text, images (the page's own elements only)
const inkAt = (id, t) => page.evaluate(({ id, t }) => {
  ENGINE.renderAt(t);
  const root = document.querySelector(`#stage .page[data-page="${id}"]`);
  if (!root) return -1;
  const op = (n) => { let o = 1; for (; n && n !== root.parentElement; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; } return o; };
  let n = 0;
  for (const el of root.querySelectorAll('path, line, rect, circle, ellipse, polyline, polygon, img, canvas, .tx')) {
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 4 || op(el) < 0.3) continue;
    if (el.classList.contains('tx') && ![...el.querySelectorAll('.ch')].concat(el.querySelector('.ch') ? [] : [el]).some((c) => op(c) >= 0.3 && c.textContent.trim())) continue;
    n++;
  }
  return n;
}, { id, t });
// before any frame is drawn: every P.x( / PV.x( a page calls must exist on the live engine, and be a function when it is
// called — a wrong guess at the API is caught here with the right name, instead of as a crash somewhere mid-page
const apiIssues = await page.evaluate((ids) => {
  const out = [];
  const inst = ENGINE.pages.find((x) => x.B)?.B;
  const names = (o) => { const n = new Set(); for (let x = o; x && x !== Object.prototype; x = Object.getPrototypeOf(x)) for (const k of Object.getOwnPropertyNames(x)) n.add(k); return [...n]; };
  const pNames = inst ? names(inst) : [], pvNames = Object.keys(window.PV || {});
  const dist = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1)); return d[a.length][b.length]; };
  const near = (n, list) => list.map((k) => [k, dist(n, k)]).filter(([, d]) => d <= Math.max(2, n.length / 3)).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([k]) => k);
  for (const id of ids) {
    const src = ENGINE.source(id);
    if (!src || !inst) continue;
    const P = /^\s*(?:function\s*\w*\s*)?\(?\s*(\w+)/.exec(src)?.[1] || 'P';
    const line = (i) => src.slice(0, i).split('\n').length;
    const seen = new Set();
    for (const m of src.matchAll(new RegExp(`\\b(${P}|PV)\\.(\\w+)\\s*(\\()?`, 'g'))) {
      const [, obj, name, call] = m, key = obj + name + !!call;
      if (seen.has(key)) continue; seen.add(key);
      const isP = obj !== 'PV', target = isP ? inst : window.PV, has = name in target;
      const label = `${isP ? 'P' : 'PV'}.${name}`;
      if (!has) {
        const hint = [...near(name, isP ? pNames : pvNames).map((k) => `${isP ? 'P' : 'PV'}.${k}`), ...((isP ? pvNames : pNames).includes(name) ? [`${isP ? 'PV' : 'P'}.${name}`] : [])];
        out.push({ page: id, line: line(m.index), msg: `unknown API: ${label} does not exist${hint.length ? ` — did you mean ${hint.join(' or ')}?` : ' — use only the components listed for this film'}` });
      } else if (call && typeof target[name] !== 'function') {
        const keys = target[name] && typeof target[name] === 'object' ? Object.keys(target[name]).slice(0, 6) : [];
        out.push({ page: id, line: line(m.index), msg: `wrong API use: ${label} is not a function${keys.length ? ` — it holds ${keys.map((k) => `${label}.${k}`).join(', ')}` : ''}` });
      }
    }
  }
  return out;
}, pages.map((p) => p.id));
// the visual's lines → the file's: the visual starts on the line that registers it
const fileLine = (id, rel) => { try { const src = fs.readFileSync(path.join(EP, PORTRAIT ? 'pages-portrait' : 'pages', id + '.js'), 'utf8'); const at = src.split('\n').findIndex((l) => /ENGINE\.visual\s*\(/.test(l)); return at >= 0 ? at + rel : rel; } catch { return rel; } };
for (const a of apiIssues) { const p = pages.find((x) => x.id === a.page); issues.push({ page: a.page, t: +p.start.toFixed(1), local: 0, msg: `${a.msg} — at pages/${a.page}.js:${fileLine(a.page, a.line)}` }); }

for (const [i, p] of pages.entries()) {
  // page turns cross-fade: the incoming page must already show something, and the outgoing one must not have cleared
  // itself, or the viewer sees empty paper between pages
  const index = L.pages.indexOf(p);
  if (index > 0 && (await inkAt(p.id, p.start + (L.meta?.fadeDelay ?? 0.3) + 0.1)) === 0)
    issues.push({ page: p.id, t: +(p.start + 0.2).toFixed(1), local: 0.2, msg: 'empty opening: nothing is on screen as the page turns in — draw the first beat\'s object before the first cue' });
  if (index < L.pages.length - 1 && (await inkAt(p.id, p.end - 0.2)) === 0)
    issues.push({ page: p.id, t: +(p.end - 0.2).toFixed(1), local: +(p.end - p.start - 0.2).toFixed(1), msg: 'empty ending: the page has cleared itself before it turns out — keep the final state on screen' });
  // settled state, just before the page turns: how much of the content area the drawing covers, and how much is text
  const settled = await page.evaluate(({ id, t }) => {
    ENGINE.renderAt(t);
    const root = document.querySelector(`#stage .page[data-page="${id}"]`);
    const frame = document.getElementById('frame').getBoundingClientRect();
    const op = (n) => { let o = 1; for (; n && n !== root.parentElement; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; } return o; };
    const A = { x0: 140, y0: 170, x1: 1780, y1: 900 };   // content area (below the page title, above the subtitles)
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, textArea = 0;
    for (const el of root.querySelectorAll('path, rect, circle, ellipse, polygon, img, canvas, .tx')) {
      if (op(el) < 0.3) continue;
      const r = el.getBoundingClientRect();
      const b = { x0: Math.max(A.x0, r.left - frame.left), y0: Math.max(A.y0, r.top - frame.top), x1: Math.min(A.x1, r.right - frame.left), y1: Math.min(A.y1, r.bottom - frame.top) };
      if (b.x1 - b.x0 < 2 || b.y1 - b.y0 < 2) continue;
      if (b.x1 - b.x0 > 0.97 * (A.x1 - A.x0) && b.y1 - b.y0 > 0.97 * (A.y1 - A.y0)) continue;   // full-bleed backgrounds don't count as content
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
      if (el.classList.contains('tx')) textArea += (b.x1 - b.x0) * (b.y1 - b.y0);
    }
    const area = (A.x1 - A.x0) * (A.y1 - A.y0);
    return { cover: x1 > x0 ? ((x1 - x0) * (y1 - y0)) / area : 0, text: textArea / area };
  }, { id: p.id, t: p.end - 0.4 });
  if (settled.cover < 0.45) issues.push({ page: p.id, t: +(p.end - 0.4).toFixed(1), local: +(p.end - p.start - 0.4).toFixed(1), msg: `sparse page: the drawing spans ${Math.round(settled.cover * 100)}% of the content area (aim for most of x 140–1780, y 180–880)` });
  if (settled.text > 0.35) issues.push({ page: p.id, t: +(p.end - 0.4).toFixed(1), local: +(p.end - p.start - 0.4).toFixed(1), msg: `text-dominated page: text covers ${Math.round(settled.text * 100)}% of the content area — let an object carry the idea, keep text to labels and numbers` });
  // determinism: the same moment, reached cold (from 0) and warm (from the page end), must be pixel-identical
  if (determinism) {
    const mid = (p.start + p.end) / 2;
    const shot = async (from) => { await page.evaluate(({ from, t }) => { ENGINE.renderAt(from); ENGINE.renderAt(t); }, { from, t: mid }); return page.screenshot({ type: 'png' }); };
    const a = await shot(0), b = await shot(p.end - 0.1);
    // GPU rasterization flips a handful of anti-aliased pixels between identical renders: compare with a tolerance
    const changed = a.equals(b) ? 0 : await page.evaluate(async ([x, y]) => {
      const load = async (b64) => createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      const px = (img) => { const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
      const da = px(ia), db = px(ib);
      let n = 0;
      for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 48) n++;
      return n / (da.length / 4);
    }, [a.toString('base64'), b.toString('base64')]);
    if (changed > 0.0005) issues.push({ page: p.id, t: +mid.toFixed(1), local: +(mid - p.start).toFixed(1), msg: `not deterministic: ${(changed * 100).toFixed(2)}% of this frame differs depending on where playback came from — something depends on state, Math.random, Date.now or a CSS transition` });
  }
  for (let t = p.start + 0.4; t < p.end - 0.15; t += step) {
    const found = await page.evaluate(({ t, minFont }) => {
      ENGINE.renderAt(t);
      const frame = document.getElementById('frame').getBoundingClientRect();
      const op = (n) => { let o = 1; for (; n && n.id !== 'frame'; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; } return o; };
      const boxes = [];
      // .tx = one text element (P.text, P.follow, P.live…); handwritten text reveals per character (.ch spans)
      for (const el of document.querySelectorAll('#stage .tx')) {
        if (op(el) < 0.5) continue;
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, txt = '';
        const chs = el.querySelectorAll('.ch');
        const parts = chs.length ? [...chs].filter((ch) => op(ch) >= 0.5) : (el.textContent.trim() ? [el] : []);
        for (const ch of parts) {
          const r = ch.getBoundingClientRect(); if (!r.width) continue;
          x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); txt += ch.textContent;
        }
        if (x1 < 0) continue;
        // LaTeX or other markup written into plain text shows as code (\\lambda): characters, or P.tex for a formula
        const raw = el.closest('.katex') ? null : /\\[A-Za-z]{2,}/.exec(el.textContent);
        if (raw) boxes.raw = (boxes.raw || []).concat(`raw markup on screen: "${raw[0]}" in "${el.textContent.trim().slice(0, 40)}" — write the character (λ, ≈, ², →) instead, or use P.tex for a formula`);
        boxes.push({ x0: x0 - frame.left, y0: y0 - frame.top, x1: x1 - frame.left, y1: y1 - frame.top, txt: txt.replace(/ /g, ' ').slice(0, 24) });
      }
      const out = [...(boxes.raw || [])];
      for (const b of boxes) {
        if (b.x0 < 40 || b.x1 > 1880 || b.y0 < 30 || b.y1 > 1060) out.push(`off-canvas/edge: "${b.txt}" box ${b.x0|0},${b.y0|0}–${b.x1|0},${b.y1|0}`);
        else if (b.y1 > 905) out.push(`subtitle band (y>905): "${b.txt}" bottom ${b.y1|0}`);
      }
      // Readability: every visible text node, at the size it actually renders (camera zoom and CSS transforms included).
      const walker = document.createTreeWalker(document.getElementById('stage'), NodeFilter.SHOW_TEXT);
      const small = new Map();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent.trim();
        const el = n.parentElement;
        if (!text || !el || op(el) < 0.5) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || r.right < frame.left || r.left > frame.right || r.bottom < frame.top || r.top > frame.bottom) continue;
        const scale = el.offsetWidth ? r.width / el.offsetWidth : 1;
        const px = parseFloat(getComputedStyle(el).fontSize) * scale;
        if (px < minFont) {
          const k = Math.floor(px);
          const owner = el.closest('.tx') || el;   // report the whole text, not one revealed character
          if (!small.has(k)) small.set(k, owner.textContent.trim().replace(/\s+/g, ' ').slice(0, 20));
        }
      }
      for (const [px, sample] of small) out.push(`small text (${px}px < ${minFont}px): "${sample}"`);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (w <= 0 || h <= 0) continue;
        const small = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
        if (w * h > 0.15 * small) out.push(`text overlap: "${a.txt}" × "${b.txt}" (${Math.round(100 * w * h / small)}% of the smaller)`);
      }
      return out;
    }, { t, minFont });
    for (const f of found) issues.push({ page: p.id, t: +t.toFixed(1), local: +(t - p.start).toFixed(1), msg: f });
  }
}
// a page whose code threw (loading, building or at some moment): the error first, with where it happened
const thrown = await page.evaluate(() => ENGINE.errors);
for (const x of thrown) {
  const p = pages.find((q) => q.id === x.page);
  if (!p) continue;
  issues.unshift({ page: x.page, t: x.t ?? +p.start.toFixed(1), local: x.local ?? 0, msg: `runtime error (${x.phase}): ${x.message}${x.at.length ? ` — at ${x.at.join(', ')}` : ''}` });
}
await closeStage(browser);
// collapse repeats of the same message on a page into one line with a time range
const seen = new Map();
for (const i of issues) { const k = i.page + '|' + i.msg; const s = seen.get(k); if (s) s.t1 = i.t; else seen.set(k, { ...i, t1: i.t }); }
if (asJson) console.log(JSON.stringify([...seen.values()]));
else if (!seen.size) console.log('lint: OK — no layout issues found');
else { console.log(`lint: ${seen.size} issue(s)`); for (const s of seen.values()) console.log(`  ${s.page} @ ${s.t}s${s.t1 !== s.t ? `–${s.t1}s` : ''} (local ${s.local}s): ${s.msg}`); }

// a stalled browser connection must not keep the process alive once the output is out
process.stdout.write("", () => process.exit(process.exitCode ?? 0));
