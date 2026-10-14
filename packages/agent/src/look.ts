// A film's own colours and type over its style's (script.js META.look): palette entries by the runtime's colour names
// (ink, red, redF, paper…), CSS font stacks for the hand and latin faces, and the stylesheets that bring those fonts
// (paths under the engine's styles/), and the character of its line. engine/runtime/look.js applies it; the server
// writes it, so it is checked here.
//
// A designed style (one with styles/<id>/fonts.json) has no look of its own: the director designs each film's in
// storyboard.json (`look`: a style card, a palette, one of the style's fonts, a line), and it is turned into a Look here.
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_DIR } from '@frametell/engine/tools/project.mjs';

/** the line: how rough the hand is (0 ruled, 1 the runtime's own, up to 2), how much a stroke bows, its width, and
 *  whether each stroke is traced once */
export interface Line { rough?: number; bow?: number; sw?: number; single?: boolean }
export interface Look { palette?: Record<string, string>; fonts?: { hand?: string; latin?: string }; css?: string[]; line?: Line }

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
  if (o.line && typeof o.line === 'object') {
    const l = o.line as Record<string, unknown>;
    const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
    const line: Line = { rough: num(l.rough, 0, 2), bow: num(l.bow, 0, 2), sw: num(l.sw, 1, 8), single: typeof l.single === 'boolean' ? l.single : undefined };
    for (const k of Object.keys(line) as (keyof Line)[]) if (line[k] === undefined) delete line[k];
    if (Object.keys(line).length) look.line = line;
  }
  if (Array.isArray(o.css)) {
    const css = o.css.filter((c): c is string => typeof c === 'string' && CSS.test(c) && !c.split('/').includes('..')).slice(0, 4);
    if (css.length) look.css = css;
  }
  return Object.keys(look).length ? look : undefined;
}

/** a typeface a designed style offers: the CSS stacks for the hand and latin faces, and the stylesheets that bring them */
export interface FontChoice { name: string; hand: string; latin?: string; css?: string[] }

/** the fonts a designed style offers (styles/<id>/fonts.json); undefined for a style with a look of its own */
export function designedFonts(style: string): Record<string, FontChoice> | undefined {
  try { return JSON.parse(fs.readFileSync(path.join(ENGINE_DIR, 'styles', style, 'fonts.json'), 'utf8')); } catch { return undefined; }
}

/** the lines a film may be drawn with, by the name the director picks */
export const LINES: Record<string, Line> = {
  sketch: { rough: 1, bow: 1, single: false },
  pen: { rough: 0.45, bow: 0.5, single: true },
  clean: { rough: 0, bow: 0, single: true },
};

const mix = (a: string, b: string, k: number) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * k + parseInt(b.slice(i, i + 2), 16) * (1 - k)).toString(16).padStart(2, '0')).join('').toUpperCase();

/** a designed film's look as the director wrote it in storyboard.json: its style card, and the Look it comes to (each
 *  colour's light fill (`nameF`) mixed toward the paper, unless it was given). undefined without a card */
export function designedLook(x: unknown, fonts: Record<string, FontChoice>): { card: string; look?: Look } | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const card = typeof o.card === 'string' ? o.card.trim().slice(0, 6000) : '';
  if (!card) return undefined;
  const palette = cleanLook({ palette: o.palette })?.palette ?? {};
  const paper = palette.paper ?? '#FFFFFF';
  for (const [k, v] of Object.entries(palette)) if (!k.endsWith('F') && k !== 'paper' && !palette[`${k}F`]) palette[`${k}F`] = mix(v, paper, 0.22);
  const font = typeof o.font === 'string' && Object.hasOwn(fonts, o.font) ? fonts[o.font] : undefined;
  const line = typeof o.line === 'string' && Object.hasOwn(LINES, o.line) ? LINES[o.line] : undefined;
  const look = cleanLook({
    palette, line,
    fonts: font ? { hand: font.hand, latin: font.latin ?? font.hand } : undefined,
    css: font?.css,
  });
  return { card, look };
}

/** what is missing from a designed film's look, for the storyboard check */
export function designedIssues(x: unknown, fonts: Record<string, FontChoice>): string[] {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const out: string[] = [];
  if (typeof o.card !== 'string' || o.card.trim().length < 200) out.push('`look.card` is missing or too short: write this film\'s style card (see the style card in your instructions)');
  const p = cleanLook({ palette: o.palette })?.palette ?? {};
  for (const k of ['paper', 'ink']) if (!p[k]) out.push(`\`look.palette.${k}\` is missing (a #RRGGBB colour)`);
  if (typeof o.font !== 'string' || !Object.hasOwn(fonts, o.font)) out.push(`\`look.font\` must be one of: ${Object.keys(fonts).join(', ')}`);
  if (typeof o.line !== 'string' || !Object.hasOwn(LINES, o.line)) out.push(`\`look.line\` must be one of: ${Object.keys(LINES).join(', ')}`);
  return out;
}
