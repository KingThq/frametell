/* Episode 31 widgets: six-pillar palette, the four frameworks, a qualitative score per pillar (illustrative, from the article's
 * wording), a six-tube score card whose tubes fill with lt, a logo+name badge, a "示意" tag and the six-colour ruler. Pure in lt. */
(function () {
  const { clamp, ease, lerp, Builder } = PV;
  const B = Builder.prototype;

  /** The six pillars, one colour each (same order everywhere). */
  PV.PIL = [
    { key: 'loop', en: 'Loop', zh: '循环', color: 'red' },
    { key: 'tool', en: 'Tool', zh: '工具', color: 'orange' },
    { key: 'ctx', en: 'Context', zh: '上下文', color: 'purple' },
    { key: 'mem', en: 'Memory', zh: '记忆', color: 'blue' },
    { key: 'multi', en: '多 Agent', zh: '多 Agent', color: 'green' },
    { key: 'har', en: 'Harness', zh: 'Harness', color: 'soft' },
  ];

  /** The four frameworks. logo = key in PV.LOGOS, or null (no official mark available → name only). */
  PV.FW = {
    oa: { name: 'OpenAI Agents SDK', short: 'OpenAI', logo: 'openai', color: 'ink' },
    cl: { name: 'Claude Agent SDK', short: 'Claude', logo: 'claude', color: 'orange' },
    ma: { name: 'Mastra', short: 'Mastra', logo: null, color: 'purple' },
    pi: { name: 'Pi', short: 'Pi', logo: null, color: 'blue' },
  };
  /** Qualitative coverage 0..3 per pillar (Loop, Tool, Context, Memory, Multi, Harness) — an illustration of the article's verdicts. */
  PV.SC = {
    oa: [2, 2.5, 0.3, 1, 2, 1],
    cl: [3, 3, 3, 1.6, 2.6, 3],
    ma: [1.6, 2.5, 0.3, 3, 2, 1.6],
    pi: [2, 1, 0.8, 1, 0.2, 0.2],
    claw: [0.4, 1.6, 2, 0.6, 1.8, 2.4], // what OpenClaw adds on top of Pi
  };
  PV.LEVELS = ['空白', '基础', '完整', '最完备'];
  /** 185 → '03:05' */
  PV.mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  /** demo(x, y, o) — a small muted "示意" tag. o: { at, label, w } */
  B.demo = function (x, y, o = {}) {
    const label = o.label ?? '示意';
    return this.chip(x, y, o.w ?? PV.tw(label, 24) + 36, label, { color: 'muted', h: 42, size: 24, at: o.at ?? 0 });
  };

  /** badge(key, x, y, o) — logo (if any) + framework name, left-aligned at (x, y = vertical centre). o: { at, size, logo, color, name } */
  B.badge = function (key, x, y, o = {}) {
    const f = PV.FW[key], size = o.size ?? 36, at = o.at ?? 0, lg = o.logo ?? size * 1.3;
    let tx = x;
    if (f.logo) { this.logo(f.logo, x + lg / 2, y, lg, { at }); tx = x + lg + 14; }
    return this.text(o.name ?? f.name, { x: tx, y: y - size * 0.72, size, weight: 700, font: 'latin', color: o.color || (f.logo ? 'ink' : f.color), at: at + 0.15, mode: 'fade' });
  };

  /**
   * card6(x, y, o) — six vertical tubes, one per pillar; tube i fills to val(i, lt) (0..3). Optional second segment on top: extra(i, lt).
   * o: { at, tw: 104, gap: 34, h: 300, val, extra, extraColor: 'faint', labels: true, levels: true, size }
   * Returns { cx(i) → tube centre x, top(i, lt) → screen y of the fill top, W }.
   */
  B.card6 = function (x, y, o = {}) {
    const tw = o.tw ?? 104, gap = o.gap ?? 34, hh = o.h ?? 300, at = o.at ?? 0, size = o.size ?? 26;
    const W = 6 * tw + 5 * gap, unit = hh / 3, base = y + hh;
    const cx = (i) => x + i * (tw + gap) + tw / 2;
    if (o.levels !== false) {
      [1, 2, 3].forEach((k) => {
        this.line(x - 16, base - k * unit, x + W + 8, base - k * unit, { color: 'faint', sw: 1.4, at: at + 0.1, dur: 0.5, rough: 0.3 });
        this.text(PV.LEVELS[k], { x: x - 24, y: base - k * unit - size * 0.7, size: 24, align: 'r', w: 140, color: 'muted', at: at + 0.3, mode: 'fade' });
      });
    }
    PV.PIL.forEach((p, i) => {
      this.box(x + i * (tw + gap), y, tw, hh, { r: 16, color: p.color, sw: 2.6, at: at + i * 0.06, dur: 0.5, texture: false, rough: 0.6 });
      if (o.labels !== false) this.text(p.en, { x: cx(i), y: base + 12, w: tw + gap, align: 'c', size, weight: 700, color: p.color, at: at + 0.2 + i * 0.06, mode: 'fade' });
    });
    const fill = (i, lt) => clamp(o.val ? o.val(i, lt) : 0, 0, 3);
    const ex = (i, lt) => clamp(o.extra ? o.extra(i, lt) : 0, 0, 3 - fill(i, lt));
    this.liveRough((lt, R) => {
      const out = [];
      PV.PIL.forEach((p, i) => {
        const v = fill(i, lt), e = ex(i, lt), bx = x + i * (tw + gap) + 8;
        if (v * unit > 4) out.push(R.box(bx, base - v * unit + 2, tw - 16, v * unit - 8, { r: 10, fill: p.color + 'F', color: p.color, sw: 2, seed: 70 + i, rough: 0.6 }));
        if (e * unit > 4) out.push(R.box(bx, base - (v + e) * unit + 2, tw - 16, e * unit - 4, { r: 10, fill: 'paper', color: o.extraColor || 'muted', sw: 2.4, seed: 90 + i, rough: 0.9 }));
      });
      return out;
    });
    return { cx, W, top: (i, lt) => base - (fill(i, lt) + ex(i, lt)) * unit, base, unit };
  };

  /** Fill helper: tube i rises to target v at time t(i) (eased 0.7 s). */
  PV.rise = (vals, t) => (i, lt) => vals[i] * ease.out(clamp((lt - t(i)) / 0.7));

  /**
   * ruler(x, y, w, o) — a long hand-drawn ruler split into six coloured segments with pillar names.
   * o: { at, h: 110, size: 30, dur } — draws on at; returns { seg(i) → { x, w } }.
   */
  B.ruler = function (x, y, w, o = {}) {
    const hh = o.h ?? 110, at = o.at ?? 0, sw = w / 6, size = o.size ?? 30;
    this.box(x, y, w, hh, { r: 12, fill: 'yellow', color: 'ink', sw: 3, at, dur: 0.6, texture: false, rough: 0.8 });
    for (let k = 1; k < 60; k++) {
      const tx = x + (k * w) / 60, big = k % 10 === 0;
      this.line(tx, y, tx, y + (big ? 34 : k % 5 === 0 ? 24 : 14), { color: 'ink', sw: big ? 2.6 : 1.6, at: at + 0.3 + k * 0.006, dur: 0.1, rough: 0.2 });
    }
    PV.PIL.forEach((p, i) => {
      this.box(x + i * sw + 8, y + hh - 56, sw - 16, 46, { r: 10, fill: p.color + 'F', color: p.color, sw: 2, at: at + 0.5 + i * 0.08, dur: 0.3, texture: false, rough: 0.5 });
      this.text(p.en, { x: x + i * sw + sw / 2, y: y + hh - 55, w: sw, align: 'c', size, weight: 700, color: p.color, at: at + 0.6 + i * 0.08, mode: 'fade' });
    });
    return { seg: (i) => ({ x: x + i * sw, w: sw }) };
  };
})();
