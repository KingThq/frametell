/* p01 · 开场：大标题 */
ENGINE.visual('p01', (P) => {
  P.text('__TITLE__', { x: 960, y: 380, size: 104, weight: 700, align: 'c', w: 1600, at: P.c(0, 0.2), cps: 9 });
  P.underline(760, 530, 400, { color: 'orange', at: P.c(1, 0.6), sw: 3.6 });
  P.icon('robot', 960, 720, 140, { at: P.c(2) });
});
