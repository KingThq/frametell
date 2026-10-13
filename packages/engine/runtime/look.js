/* A film's own look (SCRIPT.META.look) over its style's: palette entries by the runtime's colour names, the hand and
 * latin font stacks (their stylesheets are linked by boot.js from META.look.css). Loaded after the style's style.js and
 * before the runtime, which reads STYLE.palette. A new paper colour becomes the ground, plain. */
(function () {
  const look = window.SCRIPT && SCRIPT.META && SCRIPT.META.look;
  if (!look) return;
  const style = (window.STYLE = window.STYLE || {});
  const palette = look.palette || {};
  style.palette = Object.assign({}, style.palette, palette);
  if (palette.paper) style.background = () => palette.paper;
  const root = document.documentElement.style;
  for (const k of ['ink', 'soft', 'muted']) if (palette[k]) root.setProperty('--' + k, palette[k]);
  const fonts = look.fonts || {};
  if (fonts.hand) root.setProperty('--hand', fonts.hand);
  if (fonts.latin) root.setProperty('--latin', fonts.latin);
})();
