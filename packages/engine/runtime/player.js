/* 浏览器预览播放器（只在直接打开 index.html 时启用；?render / ?t 截图出片不走这里）。
 * 点击画面或空格：播放 / 暂停；← →：前后 5 秒；F：全屏；底部进度条可拖动。有配音（SCRIPT.VOICE）就同步播放每句的音频。 */
(function () {
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  window.PLAYER = function ({ from = 0, render }) {
    const dur = ENGINE.layout.duration;
    let t = Math.min(from, dur), playing = false, t0 = 0, wall = 0;

    // ── 配音：每句一个 <audio>，播放时按当前时刻对齐 ──
    const clips = ENGINE.layout.pages.flatMap((p) => p.cues).filter((c) => c.audio)
      .map((c) => ({ at: c.audioAt ?? c.start, d: c.dur ?? c.end - c.start, src: c.audio, el: null }));
    const sfx = TIMING.sfxTimes ? TIMING.sfxTimes(ENGINE.layout).map((s) => ({ ...s, el: null })) : [];
    const syncAudio = () => {
      for (const c of clips) {
        const inside = playing && t >= c.at && t < c.at + c.d - 0.03;
        if (inside) {
          if (!c.el) { c.el = new Audio(c.src); c.el.preload = 'auto'; }
          if (c.el.paused) { c.el.currentTime = Math.max(0, t - c.at); c.el.play().catch(() => {}); }
        } else if (c.el && !c.el.paused) c.el.pause();
      }
      // sound effects / music beds (page.sfx): volume and fades approximated, no ducking (the render mixes them exactly)
      for (const s of sfx) {
        const end = s.t1 ?? Infinity, inside = playing && t >= s.t0 && t < end;
        if (!inside) { if (s.el && !s.el.paused) s.el.pause(); continue; }
        if (!s.el) { s.el = new Audio(s.f); s.el.loop = s.loop; s.el.preload = 'auto'; s.el.playbackRate = s.rate; }
        let g = Math.pow(10, s.vol / 20);
        if (s.fin > 0) g *= Math.min(1, (t - s.t0) / s.fin);
        if (s.fout > 0 && end < Infinity) g *= Math.min(1, (end - t) / s.fout);
        s.el.volume = Math.max(0, Math.min(1, g));
        if (s.el.paused) {
          const pos = t - s.t0 + s.from, d = s.el.duration;
          if (!s.loop && d && pos >= d) continue;
          s.el.currentTime = s.loop && d ? pos % d : pos;
          s.el.play().catch(() => {});
        }
      }
    };

    // ── 控制条 ──
    const css = document.createElement('style');
    css.textContent = `
#pv-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 99; display: flex; align-items: center; gap: 14px; padding: 14px 22px 18px;
  background: linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0)); color: #fff; font: 600 15px -apple-system, "PingFang SC", sans-serif; transition: opacity .3s; }
#pv-bar.idle { opacity: 0; }
#pv-bar button { background: none; border: 0; color: #fff; font-size: 22px; cursor: pointer; width: 36px; height: 36px; border-radius: 8px; }
#pv-bar button:hover { background: rgba(255,255,255,0.15); }
#pv-bar input { flex: 1; accent-color: #FF9A3C; height: 6px; cursor: pointer; }
#pv-time { font-variant-numeric: tabular-nums; min-width: 96px; text-align: center; }
#pv-hint { position: fixed; inset: 0; display: grid; place-items: center; z-index: 98; pointer-events: none; }
#pv-hint span { background: rgba(0,0,0,0.55); color: #fff; font: 600 22px -apple-system, "PingFang SC", sans-serif; padding: 16px 28px; border-radius: 40px; transition: opacity .3s; }
#viewport { cursor: pointer; }`;
    document.head.appendChild(css);
    const bar = document.createElement('div');
    bar.id = 'pv-bar';
    bar.innerHTML = '<button id="pv-play" title="播放 / 暂停（空格）">▶</button><span id="pv-time"></span><input id="pv-seek" type="range" min="0" step="0.05"><button id="pv-fs" title="全屏（F）">⛶</button>';
    document.body.appendChild(bar);
    const hint = document.createElement('div');
    hint.id = 'pv-hint';
    hint.innerHTML = '<span>点击画面或按空格开始播放</span>';
    document.body.appendChild(hint);
    const $ = (id) => document.getElementById(id);
    const seek = $('pv-seek');
    const embedded = window.parent !== window;
    seek.max = dur.toFixed(2);

    const show = () => {
      render(t);
      seek.value = t.toFixed(2);
      $('pv-time').textContent = `${fmt(t)} / ${fmt(dur)}`;
      $('pv-play').textContent = playing ? '❚❚' : '▶';
      if (embedded) parent.postMessage({ type: 'studio:time', t, playing }, '*');   // the Studio panel follows along
    };
    const loop = (now) => {
      if (!playing) return;
      t = Math.min(dur, wall + (now - t0) / 1000);
      if (t >= dur) playing = false;
      syncAudio();
      show();
      if (playing) requestAnimationFrame(loop);
    };
    const play = () => {
      if (t >= dur - 0.05) t = 0;
      playing = true; wall = t; t0 = performance.now();
      hint.firstChild.style.opacity = '0';
      requestAnimationFrame(loop);
    };
    const pause = () => { playing = false; syncAudio(); show(); };
    const toggle = () => (playing ? pause() : play());
    const jump = (to) => { t = Math.max(0, Math.min(dur, to)); wall = t; t0 = performance.now(); for (const c of clips) if (c.el) c.el.pause(); syncAudio(); show(); };
    const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});

    document.getElementById('viewport').addEventListener('click', toggle);
    $('pv-play').addEventListener('click', toggle);
    $('pv-fs').addEventListener('click', fullscreen);
    seek.addEventListener('input', () => jump(parseFloat(seek.value)));
    addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      else if (e.code === 'ArrowRight') jump(t + 5);
      else if (e.code === 'ArrowLeft') jump(t - 5);
      else if (e.code === 'KeyF') fullscreen();
    });
    // 嵌在 Studio 面板里：面板可以跳到某句、开始或暂停（{ type: 'studio:seek', t, play }）
    addEventListener('message', (e) => {
      const m = e.data;
      if (m?.type === 'studio:seek') { jump(+m.t || 0); if (m.play && !playing) play(); }
      else if (m?.type === 'studio:pause') pause();
    });
    // 播放时鼠标不动 2 秒，控制条自动隐藏
    let idle;
    addEventListener('mousemove', () => { bar.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => playing && bar.classList.add('idle'), 2000); });
    show();
    if (embedded) parent.postMessage({ type: 'studio:ready', duration: dur }, '*');
  };
})();
