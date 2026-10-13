// A film's own colours and type over its style's (script.js META.look): palette entries by the runtime's colour names
// (ink, red, redF, paper…), CSS font stacks for the hand and latin faces, and the stylesheets that bring those fonts
// (paths under the engine's styles/). engine/runtime/look.js applies it; the server writes it, so it is checked here.
export interface Look { palette?: Record<string, string>; fonts?: { hand?: string; latin?: string }; css?: string[] }

const NAME = /^[a-z]{2,12}F?$/;
const HEX = /^#[0-9a-f]{6}$/i;
const STACK = /^[\w\s'",.-]{1,160}$/;
const CSS = /^[\w-]+(\/[\w.-]+)*\.css$/;

/** what of `x` is a look; undefined when nothing is */
export function cleanLook(x: unknown): Look | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const look: Look = {};
  if (o.palette && typeof o.palette === 'object') {
    const p = Object.fromEntries(Object.entries(o.palette as Record<string, unknown>)
      .filter(([k, v]) => NAME.test(k) && typeof v === 'string' && HEX.test(v)).map(([k, v]) => [k, (v as string).toUpperCase()]));
    if (Object.keys(p).length) look.palette = p;
  }
  if (o.fonts && typeof o.fonts === 'object') {
    const f = o.fonts as Record<string, unknown>;
    const fonts = Object.fromEntries((['hand', 'latin'] as const).filter((k) => typeof f[k] === 'string' && STACK.test(f[k] as string)).map((k) => [k, f[k] as string]));
    if (Object.keys(fonts).length) look.fonts = fonts;
  }
  if (Array.isArray(o.css)) {
    const css = o.css.filter((c): c is string => typeof c === 'string' && CSS.test(c) && !c.split('/').includes('..')).slice(0, 4);
    if (css.length) look.css = css;
  }
  return Object.keys(look).length ? look : undefined;
}
