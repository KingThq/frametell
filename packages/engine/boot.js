/* Boot: an episode's index.html loads its script.js, then this file. Writes the stage DOM and loads, in order:
 * kit runtime → third-party libs (SCRIPT.META.libs, paths under kit/node_modules; .css or classic/UMD .js)
 * → episode extras (SCRIPT.META.extras) → one pages/<id>.js per SCRIPT.PAGES entry → main.
 * META.vendor: ESM-only libs bundled by esbuild into classic IIFE files under kit/vendor/ (e.g. 'three' → vendor/three.js, global THREE).
 * Not ES modules + import map: Chromium blocks module scripts on file:// (CORS, origin null), in preview and in render. */
(function () {
  // canvas: landscape 1920×1080 by default; ?portrait → 1080×1920 with pages from pages-portrait/ (same script.js)
  const portrait = /[?&]portrait(&|=|$)/.test(location.search);
  window.STAGE = portrait ? { w: 1080, h: 1920, portrait: true } : { w: 1920, h: 1080, portrait: false };
  const KIT = document.currentScript.src.replace(/boot\.js(\?.*)?$/, '');
  // browser libraries and fonts: the project's engine_modules/ link (where npm or pnpm actually installed them), named by
  // <meta name="engine-modules">; falls back to the engine's own node_modules/
  const nmMeta = document.querySelector('meta[name="engine-modules"]');
  const NM = nmMeta ? new URL(nmMeta.content, location.href).href : KIT + 'node_modules/';
  const css = [
    'lxgw-wenkai-webfont/lxgwwenkai-regular.css', 'lxgw-wenkai-webfont/lxgwwenkai-bold.css',
    '@fontsource/jetbrains-mono/400.css', '@fontsource/jetbrains-mono/600.css',
    '@fontsource/caveat/500.css', '@fontsource/caveat/700.css',
    '@fontsource/fredoka/500.css', '@fontsource/fredoka/600.css',   // rounded numerals for illustrated styles
  ].map((f) => NM + f).concat(KIT + 'runtime/base.css');
  const meta = (window.SCRIPT && SCRIPT.META) || {};
  // style pack: META.style = 'warm-story' → styles/warm-story/style.css (after base.css) + style.js (before the runtime)
  const style = meta.style || 'study';
  css.push(`${KIT}styles/${style}/style.css`);
  const libs = (meta.libs || []).map((f) => NM + f);
  css.push(...libs.filter((f) => f.endsWith('.css')));
  const js = [NM + 'roughjs/bundled/rough.js', `${KIT}styles/${style}/style.js`]
    .concat(['timing', 'core', 'text', 'doodles', 'widgets', 'live', 'tokens', 'shell3d', 'three', 'media', 'player'].map((f) => `${KIT}runtime/${f}.js`))
    .concat((meta.vendor || []).map((v) => `${KIT}vendor/${v}.js`))
    .concat(libs.filter((f) => !f.endsWith('.css')))
    .concat(meta.voice ? ['voice.js'] : [])      // real narration timing from kit/tools/tts.mjs (SCRIPT.VOICE)
    .concat(meta.extras || [])
    .concat(KIT + 'runtime/engine.js')
    .concat(SCRIPT.PAGES.map((p) => `${portrait ? 'pages-portrait' : 'pages'}/${p.id}.js`))
    .concat(KIT + 'runtime/main.js');
  document.write(css.map((h) => `<link rel="stylesheet" href="${h}">`).join('') + `
<svg width="0" height="0" style="position:absolute"><defs>
  <filter id="wc" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
</defs></svg>
<div id="viewport"><div id="frame"${portrait ? ' class="portrait"' : ''}><div id="bg"></div><div id="stage"></div><div id="vignette"></div></div></div>` +
    js.map((s) => `<script src="${s}"><\/script>`).join(''));
})();
