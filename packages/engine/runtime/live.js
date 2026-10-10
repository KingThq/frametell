/* Time-driven building blocks (from episode 03): rough shapes re-drawn per frame (liveRough), text that follows lt (follow), bars, slider, KaTeX formula (tex, needs META.libs katex), canvas, PV.K / PV.softmax. */
(function () {
  const { s, h, col, gen, rrect, clamp, ease, Builder } = PV;
  const B = Builder.prototype;

  /** Eased progress of lt through [a, a + dur]. */
  PV.K = (lt, a, dur = 0.6, e = ease.inOut) => e(clamp((lt - a) / dur));
  /** softmax(z / T) → probabilities. */
  PV.softmax = (z, T = 1) => {
    const m = Math.max(...z.map((v) => v / T));
    const ex = z.map((v) => (v === -Infinity ? 0 : Math.exp(v / T - m)));
    const sum = ex.reduce((a, b) => a + b, 0);
    return ex.map((v) => v / sum);
  };

  /** Paints rough drawables into g (fills with the watercolour filter, then ink on top). */
  function paint(g, items) {
    const strokes = [];
    for (const it of items) {
      if (!it) continue;
      for (const set of it.sets) {
        const d = gen.opsToPath(set, 2), op = it.options;
        if (set.type === 'fillPath') s('path', { d, fill: op.fill, stroke: 'none', filter: 'url(#wc)' }, g);
        else strokes.push({ d, stroke: set.type === 'fillSketch' ? op.fill : op.stroke, w: set.type === 'fillSketch' ? op.fillWeight : op.strokeWidth });
      }
    }
    for (const q of strokes) s('path', { d: q.d, fill: 'none', stroke: q.stroke, 'stroke-width': q.w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  }

  /**
   * Rough shapes whose geometry is a function of time: fn(lt, R) → [drawables] | null.
   * R.box(x, y, w, h, o) / R.path(d, o) / R.circle(cx, cy, d, o) / R.line(x1, y1, x2, y2, o) — seeds stay fixed so the wobble does not boil.
   */
  B.liveRough = function (fn, o = {}) {
    const g = s('g', {}, this.svg);
    const seed = this.seed() * 13;
    const ro = (oo = {}, k = 0) => this.ro(Object.assign({}, oo, { seed: oo.seed ?? seed + k }));
    const R = {
      box: (x, y, w, hh, oo = {}) => {
        if (![x, y, w, hh].every(Number.isFinite)) throw new Error(`box(${[x, y, w, hh].join(', ')}) has a non-finite value`);
        return gen.path(rrect(x, y, w, hh, oo.r ?? 10), ro(oo, 1));
      },
      path: (d, oo = {}) => gen.path(d, ro(oo, 2)),
      circle: (cx, cy, d, oo = {}) => gen.circle(cx, cy, d, ro(oo, 3)),
      line: (x1, y1, x2, y2, oo = {}) => gen.line(x1, y1, x2, y2, ro(oo, 4)),
    };
    const id = this.page.id;
    this.tick((lt) => {
      let items;
      try { items = fn(lt, R); } catch (e) { throw new Error(`liveRough @${id} lt=${lt.toFixed(3)}: ${e.message}`); }
      g.textContent = '';
      if (items) paint(g, items);
    });
    if (o.opacity) this.tick((lt) => { g.style.opacity = o.opacity(lt).toFixed(3); });
    return g;
  };

  /** A <canvas> redrawn every frame: draw(ctx, lt, w, h). Good for dense things (heatmaps, particles). */
  B.canvas = function (x, y, w, hh, draw) {
    const c = h('canvas', null, null, this.html);
    c.width = w; c.height = hh;
    Object.assign(c.style, { position: 'absolute', left: x + 'px', top: y + 'px' });
    const ctx = c.getContext('2d');
    this.tick((lt) => { ctx.clearRect(0, 0, w, hh); draw(ctx, lt, w, hh); });
    return c;
  };

  /** KaTeX formula. o: { x, y, size, color, align: 'c', w, at } */
  B.tex = function (src, o = {}) {
    const el = h('div', 'tx', null, this.html);
    katex.render(src, el, { throwOnError: false, displayMode: false });
    const w = o.w ?? 900;
    Object.assign(el.style, { left: (o.align === 'c' ? o.x - w / 2 : o.x) + 'px', top: o.y + 'px', fontSize: (o.size ?? 44) + 'px',
      color: col(o.color || 'ink'), width: o.align === 'c' ? w + 'px' : 'auto', textAlign: o.align === 'c' ? 'center' : 'left', whiteSpace: 'nowrap' });
    this.show(el, { at: o.at ?? 0, dur: o.dur ?? 0.6 });
    return el;
  };

  /** Text whose content and position follow lt: fn(lt) → { text, x, y, opacity? } | null. */
  B.follow = function (fn, o = {}) {
    const el = h('div', 'tx ' + (o.font || 'hand'), '', this.html);
    Object.assign(el.style, { fontSize: (o.size ?? 30) + 'px', color: col(o.color || 'ink'), fontWeight: o.weight || 400, whiteSpace: 'nowrap',
      width: (o.w ?? 200) + 'px', textAlign: 'center' });
    this.tick((lt) => {
      const v = fn(lt);
      if (!v) { el.style.opacity = '0'; return; }
      if (el._t !== v.text) { el._t = v.text; el.innerHTML = v.text; }
      el.style.left = (v.x - (o.w ?? 200) / 2).toFixed(1) + 'px';
      el.style.top = v.y.toFixed(1) + 'px';
      el.style.opacity = (v.opacity ?? 1).toFixed(3);
      if (v.color) el.style.color = col(v.color);
    });
    return el;
  };

  /**
   * Bar chart around a baseline. items: [{ label, color }]; value(i, lt) → number (negative goes below).
   * o: { x, base, bw, gap, scale (px per unit), at, fmt(v, i) → str, labelSize, valueSize, axis: true }
   */
  B.bars = function (items, value, o = {}) {
    const bw = o.bw ?? 90, gap = o.gap ?? 40, scale = o.scale ?? 40, base = o.base, x0 = o.x, at = o.at ?? 0;
    const W = items.length * (bw + gap) - gap;
    if (o.axis !== false) this.line(x0 - 30, base, x0 + W + 30, base, { color: 'soft', sw: 2.4, at, dur: 0.5 });
    const grow = (lt) => ease.out(clamp((lt - at - 0.2) / 0.7));
    items.forEach((it, i) => {
      const x = x0 + i * (bw + gap), c = it.color || 'blue';
      this.liveRough((lt, R) => {
        const v = value(i, lt) * grow(lt), hh = Math.abs(v) * scale;
        if (hh < 1) return null;
        return [R.box(x, v >= 0 ? base - hh : base, bw, hh, { r: 8, fill: c + 'F', color: c, sw: 2.4, seed: 100 + i })];
      });
      if (it.label != null) this.text(it.label, { x: x + bw / 2, y: base + (o.labelGap ?? 14), w: bw + gap, align: 'c', size: o.labelSize ?? 34, at: at + 0.3 + i * 0.08, mode: 'fade', color: it.lcolor });
      if (o.fmt) this.follow((lt) => {
        const v = value(i, lt), k = grow(lt);
        if (k <= 0) return null;
        const hh = Math.abs(v * k) * scale, above = v >= 0;
        if (hh < 1) return null;   // no label until the bar is actually there
        return { text: o.fmt(v, i, lt), x: x + bw / 2, y: above ? base - hh - (o.valueSize ?? 30) * 1.5 : base + hh + 8 + (o.negGap ?? 0), opacity: k };
      }, { size: o.valueSize ?? 30, font: o.valueFont || 'latin', color: c, w: bw + gap });
    });
    return { W, x: (i) => x0 + i * (bw + gap) + bw / 2 };
  };

  /** Slider: value(lt) in [min, max]. o: { at, label(v) → str, ticks: [[v, text]] } */
  B.slider = function (x, y, w, min, max, value, o = {}) {
    const at = o.at ?? 0, px = (v) => x + ((v - min) / (max - min)) * w;
    this.line(x, y, x + w, y, { color: 'faint', sw: 6, at, dur: 0.5 });
    for (const [v, t] of o.ticks || []) {
      this.line(px(v), y + 12, px(v), y + 24, { color: 'muted', sw: 2, at: at + 0.2, dur: 0.2 });
      this.text(t, { x: px(v), y: y + 28, w: 160, align: 'c', size: 26, color: 'muted', at: at + 0.3, mode: 'fade' });
    }
    this.liveRough((lt, R) => {
      if (lt < at + 0.3) return null;
      const cx = px(value(lt));
      return [R.line(x, y, cx, y, { color: o.color || 'orange', sw: 6 }), R.circle(cx, y, 44, { fill: 'paper', color: o.color || 'orange', sw: 3.2 })];
    });
    if (o.label) this.follow((lt) => (lt < at + 0.3 ? null : { text: o.label(value(lt)), x: px(value(lt)), y: y - 74 }),
      { size: 36, font: 'latin', weight: 700, color: o.color || 'orange', w: 300 });
  };
})();
