/* p02 未命中：虚线中段描出缓存节点；请求块撞进去闪出 MISS、穿过去到源站；响应回来时在缓存里落下一份副本，再回到浏览器。 */
ENGINE.visual('p02', (P) => {
  P.title('中间放一个缓存', { accent: 'blue' });
  const N = PV.NET;
  const t0 = P.c(0), t1 = P.c(1), t2 = P.c(2);
  P.net({ cache: true, cacheAt: t0 + 0.2, cacheDur: 0.7 });
  const go = t1 + 0.2, hit = go + 0.7, far = go + 1.8, back = t2 - 0.5, drop = t2 + 0.3, home = t2 + 1.4;
  const keys = [[go, N.browser + 190], [hit, N.cache - 190], [far, N.origin - 190], [back, N.origin - 190], [drop, N.cache], [home, N.browser + 190]];
  P.packets((lt) => (lt < go || lt > home + 0.3 ? [] : [{ x: PV.keys(keys, lt), color: lt > far ? 'blue' : 'blue' }]));
  P.chip(N.cache - 90, 300, 180, 'MISS', { color: 'red', at: hit, h: 56, size: 30 }).hide(t2, 0.4);
  // the copy that stays behind
  const [sx, sy] = N.slots[0];
  P.box(sx + 8, sy + 8, 94, 70, { r: 6, color: 'blue', fill: 'blue', at: drop, dur: 0.3, texture: false });
  P.text('副本', { x: sx + 55, y: sy + 16, w: 120, align: 'c', size: 36, weight: 700, color: 'paper', at: drop + 0.2, mode: 'fade' });
  P.cam([P.push(hit - 0.2, N.cache, 500, 1.12), P.back(far + 0.2)]);
});
