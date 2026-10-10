/* Boot. ?render → fixed-size frame capture (1920×1080, or 1080×1920 with ?portrait). ?subs → burn subtitles (preview). ?t=12.3 → still. ?only=p01,p02 → build a subset. */
(function () {
  const q = new URLSearchParams(location.search);
  const frame = document.getElementById('frame');
  // paper: warm fibres + faint dot grid, generated once
  const noise = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" seed="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.42  0 0 0 0 0.33  0 0 0 0 0.22  0 0 0 0.16 0"/></filter><rect width="480" height="480" filter="url(#n)"/></svg>');
  const blotch = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${STAGE.w}" height="${STAGE.h}"><filter id="b"><feTurbulence type="fractalNoise" baseFrequency="0.004" numOctaves="3" seed="11"/><feColorMatrix values="0 0 0 0 0.62  0 0 0 0 0.48  0 0 0 0 0.3  0 0 0 0.11 0"/></filter><rect width="${STAGE.w}" height="${STAGE.h}" filter="url(#b)"/></svg>`);
  const bg = document.getElementById('bg');
  bg.style.background = [
    'radial-gradient(circle, rgba(120, 100, 80, 0.13) 1.3px, transparent 1.6px) 0 0 / 40px 40px',
    `url("data:image/svg+xml;utf8,${noise}")`,
    `url("data:image/svg+xml;utf8,${blotch}")`,
    'radial-gradient(1300px 800px at 35% 30%, #FBF7EE, #F3EBDC 70%, #EDE3D1)',
  ].join(',');

  const only = q.get('only') ? q.get('only').split(',') : null;
  // 预览时把画面缩放到窗口里并居中（画面比窗口大时，grid 居中会贴左上角，所以直接算位置）
  const frameScale = () => {
    const k = Math.min(innerWidth / STAGE.w, innerHeight / STAGE.h);
    Object.assign(frame.style, { position: 'absolute', left: `${(innerWidth - STAGE.w) / 2}px`, top: `${(innerHeight - STAGE.h) / 2}px`, transform: `scale(${k})` });
  };

  if (!q.has('render')) { addEventListener('resize', frameScale); frameScale(); }

  window.__ready = (async () => {
    // pass 1: build once to discover every glyph, load those font subsets, then build for real (so text can be measured)
    ENGINE.init({ only });
    await document.fonts.ready;
    // request every glyph subset used anywhere (fonts are split by unicode-range)
    const all = document.getElementById('stage').textContent + SCRIPT.PAGES.map((p) => p.cues.map((c) => (typeof c === 'string' ? c : c.t)).join('') + p.section).join('') + '0123456789/·';
    await Promise.all(['400', '700'].flatMap((w) => [document.fonts.load(`${w} 40px "LXGW WenKai"`, all)]).concat([
      document.fonts.load('400 30px "JetBrains Mono"', all), document.fonts.load('600 30px "JetBrains Mono"', all),
      document.fonts.load('700 30px Caveat', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/'),
    ]).concat((window.EXTRA_FONTS || []).map((f) => document.fonts.load(f, all + '0123456789%.,+-×÷=¥?!？！'))));   // extras can register more font faces
    await document.fonts.ready;
    ENGINE.init({ subs: q.has('subs') || (!q.has('render') && !q.has('t') && !q.has('nosubs')), only });
    ENGINE.renderAt(0);
    return ENGINE.layout.duration;
  })();

  const t0 = q.has('t') ? parseFloat(q.get('t')) : null;
  if (t0 != null) { window.__ready.then(() => ENGINE.renderAt(t0)); return; }
  if (q.has('render')) return;
  // live preview（直接打开 index.html）：播放器见 player.js；?from=秒 从某处开始，默认带字幕（?nosubs 关掉）
  frame.style.visibility = 'hidden';   // 第一遍建页会露出所有元素，等就绪再显示，避免「闪一下」
  window.__ready.then(() => {
    frameScale();
    frame.style.visibility = '';
    PLAYER({ from: parseFloat(q.get('from') || '0'), render: (t) => ENGINE.renderAt(t) });
  });
})();
