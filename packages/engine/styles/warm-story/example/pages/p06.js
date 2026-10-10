/* p06 收束：树苗从土里长出来，长高结满果子；一只手把一枚硬币埋进树下的土里。 */
ENGINE.visual('p06', (P) => {
  P.title('越早开始越好', { accent: 'green' });
  P.ground(780, { at: 0 });
  const t0 = P.c(0), t2 = P.c(2), t3 = P.c(3);
  P.tree(1120, 790, 560, { at: 0, grow: (lt) => PV.ease.inOut(PV.clamp((lt - t0) / (t2 + 1 - t0))), fruits: (lt) => PV.clamp((lt - t2) / 2.2) * 6 });
  P.calendar(470, 470, 260, { at: 0.2, label: '今天' });
  P.hand(800, (lt) => PV.lerp(560, 640, PV.ease.inOut(PV.clamp((lt - t3) / 0.8))), 160, { at: t3 - 0.4, rot: 12 });
  P.coin(900, 780, 26, { at: t3 + 0.5, fall: { from: 660, at: t3 + 0.5, dur: 0.45 } });
  P.cam([P.push(t2, 1120, 470, 1.1), P.back(t3)]);
});
