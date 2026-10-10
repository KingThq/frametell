/* Episode 12 widget: a CSS-3D bookshelf of the real Skills on this machine (PV.DATA.skills).
 * Spine width ∝ frontmatter tokens (what Level 1 loads), spine height ∝ body tokens (capped). One "hero" book lives on its own
 * layer so it can be pulled out of the shelf (translateZ) and turned to face the camera. Pure in lt. */
(function () {
  const { clamp, ease, Builder } = PV;

  /** Colour family of a skill, by name prefix. */
  PV.skillColor = (name, i) => (name.startsWith('lark-') ? 'blue' : name.startsWith('arkcli-') ? 'orange' : ['green', 'purple', 'soft'][i % 3]);

  /**
   * shelf(o) — o: { x, y, rowW, rows (default 2), gapY, at, dur (spread of the pop-in), hero: skill name, dim(lt) → 0..1 veil over the non-hero books,
   *   tilt(lt) → { rx, ry (degrees), s (scale), ox, oy (origin), op }, persp }
   * Returns { S (shelf layer), H (hero layer), books: [{ name, x, y, w, h, c }], hero: rect of the hero book, rowBase: [y…] }.
   */
  Builder.prototype.shelf = function (o) {
    const D = PV.DATA, at = o.at ?? 0, dur = o.dur ?? 1.2, rowW = o.rowW ?? 1500, gapY = o.gapY ?? 250;
    const W = (fm) => 3 + fm * 0.2, Hh = (body) => 80 + Math.min(body, 6000) / 6000 * 90;
    const books = [];
    const nRows = o.rows ?? 2, total = D.skills.reduce((a, s) => a + W(s[1]), 0), perRow = total / nRows;
    let cum = 0, row = 0, rx = o.x;
    D.skills.forEach((s, i) => {
      const w = W(s[1]), r = Math.min(nRows - 1, Math.floor((cum + w / 2) / perRow));
      if (r !== row) { row = r; rx = o.x; }
      const h = Hh(s[2]);
      books.push({ name: s[0], x: rx, y: o.y + row * gapY - h, w, h, c: PV.skillColor(s[0], i), row, fm: s[1], body: s[2] });
      rx += w; cum += w;
    });
    this.host.style.perspective = (o.persp ?? 2000) + 'px';
    const S = this.layer();
    S.wrap.style.transformStyle = 'preserve-3d';
    const rows = [...new Set(books.map((b) => b.row))];
    const rowBase = rows.map((r) => o.y + r * gapY);
    rowBase.forEach((y, r) => S.box(o.x - 30, y, perRow + 60, 22, { r: 4, fill: 'faint', color: 'soft', sw: 2.4, at: at + r * 0.15, dur: 0.4, texture: false }));
    const H = S.layer();
    H.wrap.style.transformStyle = 'preserve-3d';
    let hero = null;
    books.forEach((b, i) => {
      const t = at + 0.3 + (i / books.length) * dur, isHero = b.name === o.hero;
      const L = isHero ? H : S;
      L.box(b.x + 1, b.y, Math.max(2, b.w - 2), b.h, { r: 2, fill: b.c + 'F', color: b.c, sw: isHero ? 2.6 : 1.3, at: t, dur: 0.12, texture: false, rough: 0.4 });
      if (isHero) hero = b;
    });
    // dim veil over every book except the hero (the hero sits on H, above S's own svg)
    if (o.dim) S.liveRough((lt, R) => { const k = o.dim(lt); return k > 0.01 ? [R.box(o.x - 50, o.y - 185, perRow + 100, gapY * (nRows - 1) + 215, { r: 4, fill: `rgba(251,248,241,${(0.78 * k).toFixed(3)})`, color: 'rgba(0,0,0,0)', sw: 0.1, seed: 9 })] : null; });
    const sx = o.x + perRow / 2, sy = o.y + gapY * 0.5;
    this.tick((lt) => {
      const tl = o.tilt ? o.tilt(lt) : {};
      S.wrap.style.transformOrigin = `${tl.ox ?? sx}px ${tl.oy ?? sy}px`;
      S.wrap.style.opacity = (tl.op ?? 1).toFixed(3);
      S.wrap.style.transform = `rotateX(${(tl.rx ?? 8).toFixed(2)}deg) rotateY(${(tl.ry ?? -14).toFixed(2)}deg) scale(${(tl.s ?? 1).toFixed(4)})`;
    });
    return { S, H, books, hero, rowBase };
  };
})();
