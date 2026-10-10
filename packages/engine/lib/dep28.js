/* Episode 28 widgets: a "示意" tag, a mm:ss formatter, a server/container box, and a falling-debris driver. All pure in lt. */
(function () {
  const { clamp, ease, Builder } = PV;
  const B = Builder.prototype;

  /** 185 → '3:05' */
  PV.mmss = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  /** demo(x, y, o) — a small muted "示意" tag (for made-up examples and illustrative numbers). o: { at, label, w } */
  B.demo = function (x, y, o = {}) {
    const label = o.label ?? '示意';
    return this.chip(x, y, o.w ?? Math.max(90, label.length * 26 + 30), label, { color: 'muted', h: 42, size: 24, at: o.at ?? 0 });
  };

  /**
   * fall(L, t, o) — make layer L drop off the page at time t (debris): accelerates down, spins a little, fades.
   * o: { spin (deg/s), dx (px/s drift), g (px/s²), origin: [x, y] }
   */
  B.fall = function (L, t, o = {}) {
    if (o.origin) L.wrap.style.transformOrigin = `${o.origin[0]}px ${o.origin[1]}px`;
    const g = o.g ?? 1800, spin = o.spin ?? 30, dx = o.dx ?? 0;
    this.tick((lt) => {
      const u = lt - t;
      if (u <= 0) { L.wrap.style.transform = ''; L.wrap.style.opacity = ''; return; }
      L.wrap.style.transform = `translate(${(dx * u).toFixed(1)}px, ${(0.5 * g * u * u).toFixed(1)}px) rotate(${(spin * u).toFixed(2)}deg)`;
      L.wrap.style.opacity = (1 - clamp((u - 0.5) / 0.6)).toFixed(3);
    });
    return L;
  };

  /**
   * srv(x, y, w, h, label, o) — a container / server box with a heading chip and an optional logo.
   * o: { at, color, logo, fill, size }. Returns { x, y, w, h }.
   */
  B.srv = function (x, y, w, hh, label, o = {}) {
    const at = o.at ?? 0, c = o.color || 'ink', size = o.size ?? 30;
    this.box(x, y, w, hh, { r: 20, fill: o.fill || 'paper', color: c, sw: 3, at, dur: 0.6, texture: false });
    const lx = o.logo ? x + 70 : x + 24;
    if (o.logo) this.logo(o.logo, x + 40, y + 34, 40, { at: at + 0.3 });
    this.text(label, { x: lx, y: y + 34 - size * 0.7, size, weight: 700, color: c, at: at + 0.3, mode: 'fade' });
    return { x, y, w, h: hh };
  };


  /**
   * PV.CPU — an illustrative CPU trace of one agent task (fixed seed): long idle waits for the LLM, short tool bursts.
   * { dt, v: [0..1 per sample], segs: [{ a, b, kind: 'llm' | 'tool', label }], T }
   */
  PV.CPU = (() => {
    const rng = PV.rng(2809), dt = 0.5, v = [], segs = [];
    const plan = [['llm', 9], ['tool', 4, '读文件', 0.35], ['llm', 8], ['tool', 7, '跑测试', 0.95], ['llm', 11], ['tool', 5, '编译', 0.85], ['llm', 8], ['tool', 6, '跑测试', 0.95], ['llm', 9]];
    let t = 0;
    plan.forEach(([kind, len, label, peak]) => {
      const n = Math.round(len / dt);
      segs.push({ a: t, b: t + len, kind, label });
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1 || 1), ramp = Math.min(1, u * 4, (1 - u) * 4 + 0.2);
        v.push(kind === 'llm' ? 0.03 + rng() * 0.05 : Math.min(1, peak * (0.8 + rng() * 0.2) * ramp + 0.04));
      }
      t += len;
    });
    return { dt, v, segs, T: t, at: (s) => v[Math.max(0, Math.min(v.length - 1, Math.floor(s / dt)))] };
  })();

  /** blink(lt, t0, hz) → 0/1 square wave after t0 (for status lights). */
  PV.blink = (lt, t0 = 0, hz = 2) => (lt < t0 ? 0 : Math.floor((lt - t0) * hz * 2) % 2 === 0 ? 1 : 0);
  PV.eout = ease.out;
})();
