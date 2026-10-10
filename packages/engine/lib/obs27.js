/* Episode 27 helpers: drive a layer by lt (mv), rough text width (PV.tw), and a paper "receipt / panel" row list. All pure in lt. */
(function () {
  const { Builder } = PV;
  const B = Builder.prototype;
  /** Approximate rendered width of a string (CJK = 1 em, ASCII ≈ 0.56 em). */
  PV.tw = (str, size) => [...str].reduce((a, ch) => a + (/[\x00-\x7f]/.test(ch) ? 0.56 : 1), 0) * size;

  /** mv(L, fn, origin) — drive a layer: fn(lt) → { x, y, s, rot, op } | null (null hides it). */
  B.mv = function (L, fn, origin) {
    if (origin) L.wrap.style.transformOrigin = `${origin[0]}px ${origin[1]}px`;
    this.tick((lt) => {
      const v = fn(lt);
      if (!v) { L.wrap.style.opacity = '0'; return; }
      L.wrap.style.opacity = (v.op ?? 1).toFixed(3);
      L.wrap.style.transform = `translate(${(v.x ?? 0).toFixed(1)}px, ${(v.y ?? 0).toFixed(1)}px) rotate(${(v.rot ?? 0).toFixed(2)}deg) scale(${(v.s ?? 1).toFixed(4)})`;
    });
    return L;
  };

  /** fmtMin(sec) → "mm:ss"; money(v) → "$12.34". */
  PV.mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  PV.money = (v) => '$' + v.toFixed(2);
})();
