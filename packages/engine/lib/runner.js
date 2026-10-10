/* Path runner: sample points along an SVG path by arc length, so things can travel along drawn routes as a function of lt. */
(function () {
  const { s, Builder } = PV;

  /** pathAt(d) → { len, at(u) → { x, y, a } } — u in [0, 1] of the arc length, a = heading in degrees. */
  Builder.prototype.pathAt = function (d) {
    const p = s('path', { d, fill: 'none', stroke: 'none' }, this.svg);
    const len = p.getTotalLength();
    return {
      len,
      at(u) {
        const l = Math.max(0, Math.min(1, u)) * len;
        const q = p.getPointAtLength(l), r = p.getPointAtLength(Math.min(len, l + 1)), b = p.getPointAtLength(Math.max(0, l - 1));
        return { x: q.x, y: q.y, a: (Math.atan2(r.y - b.y, r.x - b.x) * 180) / Math.PI };
      },
    };
  };

  /**
   * Piecewise-linear keyframes → value at lt, eased per segment. keys: [[t, v], …] sorted by t.
   * Before the first key → first value; after the last → last value.
   */
  PV.keys = (keys, lt, e = PV.ease.inOut) => {
    if (lt <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      if (lt < t1) return v0 + (v1 - v0) * e(PV.clamp((lt - t0) / Math.max(1e-6, t1 - t0)));
    }
    return keys[keys.length - 1][1];
  };

  /** Blend two palette colours: mix('blue', 'red', k) → 'rgb(…)'. */
  PV.mix = (a, b, k) => {
    const hex = (c) => { const v = PV.col(c).replace('#', ''); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };
    const A = hex(a), Bc = hex(b);
    return `rgb(${A.map((v, i) => Math.round(v + (Bc[i] - v) * PV.clamp(k))).join(',')})`;
  };
})();
