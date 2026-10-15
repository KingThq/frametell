// A brand a film is made for: who it speaks for (name, what it does, its tone, its tagline) and its files (logos,
// icons, pictures), copied into the project's assets/brand/ when the film is made. The director reads it after the
// style card; a page that places one of its files is told how. Its colours and typeface reach the film as its `look`.

/** a logo, the logo for dark grounds, a mark with no words, an icon, or any other picture */
export type BrandAssetKind = 'logo' | 'logo-dark' | 'mark' | 'icon' | 'image';
export interface BrandAsset {
  /** its file name in assets/brand/ */
  file: string;
  kind: BrandAssetKind;
  name: string;
  /** one sentence on what it is: where it belongs is decided by it */
  note: string;
  /** its size in pixels (an SVG's viewBox) */
  w: number; h: number;
  /** a transparent background */
  alpha: boolean;
}
export interface BrandBrief {
  /** the host's own id for the brand, kept with the film */
  id?: string;
  name: string;
  /** what it does, and for whom */
  about?: string;
  /** how its words sound */
  tone?: string;
  tagline?: string;
  /** the logo opens and closes the film (default: yes) */
  bookends?: boolean;
  /** the palette name that carries the brand's main colour in the film's style (the host maps the colours) */
  emphasis?: string;
  assets: BrandAsset[];
}

/** where a film keeps its brand's files */
export const BRAND_DIR = 'assets/brand';
const KINDS: BrandAssetKind[] = ['logo', 'logo-dark', 'mark', 'icon', 'image'];
const LOGOS: BrandAssetKind[] = ['logo', 'logo-dark', 'mark'];
/** a plain file name of a picture: no folders, nothing hidden */
const FILE = /^[\w][\w.-]{0,95}\.(svg|png|jpe?g|webp)$/i;
const MAX_ASSETS = 30;
/** a palette name: a plain identifier */
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const block = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const px = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(20000, Math.round(v)) : 0);

/** the brief as a film keeps it: its fields trimmed to size, only files with plain picture names, each named once;
 *  undefined without a name */
export function cleanBrand(x: unknown): BrandBrief | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const name = text(o.name, 60);
  if (!name) return undefined;
  const seen = new Set<string>();
  const assets: BrandAsset[] = (Array.isArray(o.assets) ? o.assets : []).flatMap((a): BrandAsset[] => {
    if (!a || typeof a !== 'object') return [];
    const r = a as Record<string, unknown>;
    if (typeof r.file !== 'string' || !FILE.test(r.file) || seen.has(r.file.toLowerCase())) return [];
    seen.add(r.file.toLowerCase());
    const kind = KINDS.includes(r.kind as BrandAssetKind) ? r.kind as BrandAssetKind : 'image';
    return [{ file: r.file, kind, name: text(r.name, 80) || r.file, note: text(r.note, 200), w: px(r.w), h: px(r.h), alpha: r.alpha === true }];
  }).slice(0, MAX_ASSETS);
  const brief: BrandBrief = { name, assets };
  const id = text(o.id, 80);
  if (id) brief.id = id;
  const about = block(o.about, 500), tone = block(o.tone, 1000), tagline = text(o.tagline, 80);
  if (about) brief.about = about;
  if (tone) brief.tone = tone;
  if (tagline) brief.tagline = tagline;
  if (o.bookends === false) brief.bookends = false;
  if (typeof o.emphasis === 'string' && NAME.test(o.emphasis)) brief.emphasis = o.emphasis;
  return brief;
}

const pathOf = (a: BrandAsset) => `${BRAND_DIR}/${a.file}`;
const size = (a: BrandAsset) => (a.w && a.h ? `${a.w}×${a.h}` : 'size unknown');
const line = (a: BrandAsset) => `- \`${pathOf(a)}\`: ${a.kind}, ${size(a)}, ${a.alpha ? 'transparent background' : 'opaque background'}${a.name && a.name !== a.file ? `, “${a.name}”` : ''}${a.note ? `: ${a.note}` : ''}`;

/** The brand, for the director (storyboard, script, changes): after the style card, so it reads as who the film
 *  speaks for, not as a new style. '' without a brand, so the prompt stays as it was. */
export function brandSection(brand?: BrandBrief) {
  if (!brand) return '';
  const bookends = brand.bookends !== false && brand.assets.some((a) => a.kind === 'logo' || a.kind === 'mark');
  return `---
# This film's brand

The film is made for a brand and speaks for it. Its colours and typeface, when it has them, are already the film's palette and fonts (use them by name); what follows is who it is.

- Name: ${brand.name}${brand.about ? `\n- About: ${brand.about}` : ''}${brand.tagline ? `\n- Tagline: “${brand.tagline}”` : ''}${brand.tone ? `\n- Tone of voice:\n\n<brand-tone>\n${brand.tone}\n</brand-tone>` : ''}

Its files, in the project (open a picture with read to see it):
${brand.assets.length ? brand.assets.map(line).join('\n') : '(none)'}

- ${bookends ? 'The first page opens on the brand\'s logo and the last page closes on it; the last page may also carry the tagline.' : 'Show the logo only where the content calls for it.'}
- Use the other files only where the content calls for them (the product's screenshot where the film shows the product); never put one in because it is there.
- A beat that places a file names its path in its object (\`${BRAND_DIR}/…\`), so the page agent places that very file.
${brand.emphasis ? `${emphasisRule(brand.emphasis)}\n` : ''}- Write the narration and the words on screen in the brand's tone. The rules on facts still hold: the tone never adds a claim, a number or a promise the material doesn't support.`;
}

/** the brand's files a page places: those its storyboard names, and on the first and last page the logos when the
 *  film opens and closes on them */
export function brandFilesOn(brand: BrandBrief | undefined, pages: { id: string; section?: string; say?: string; beats?: { object?: string; action?: string; text?: string }[] }[], id: string): BrandAsset[] {
  if (!brand?.assets.length) return [];
  const i = pages.findIndex((p) => p.id === id);
  const p = pages[i];
  if (!p) return [];
  const words = [p.section, p.say, ...(p.beats ?? []).flatMap((b) => [b.object, b.action, b.text])].filter(Boolean).join('\n');
  const named = brand.assets.filter((a) => words.includes(a.file));
  const bookend = brand.bookends !== false && (i === 0 || i === pages.length - 1);
  const used = brand.assets.filter((a) => named.includes(a) || (bookend && LOGOS.includes(a.kind)));
  // a page with the logo also gets its dark version, for a dark ground
  if (used.some((a) => a.kind === 'logo')) for (const a of brand.assets) if (a.kind === 'logo-dark' && !used.includes(a)) used.push(a);
  return brand.assets.filter((a) => used.includes(a));
}

const call = (a: BrandAsset) => {
  const h = a.w && a.h ? `w * ${a.h} / ${a.w}` : 'h';
  // a logo or an icon stands on the page as it is: P.img frames a picture (rounded corners, an outline, a shadow) unless told not to
  return LOGOS.includes(a.kind) || a.kind === 'icon'
    ? `P.img('${pathOf(a)}', x, y, w, ${h}, { fit: 'contain', border: false, shadow: false, r: 0 })`
    : `P.img('${pathOf(a)}', x, y, w, ${h}, { fit: 'cover' })`;
};

const emphasisRule = (name: string) => `- The brand's main colour is the palette's \`${name}\`: use it for emphasis (highlights, underlines, the key number) rather than other accents.`;

/** For the page agent: the brand's colour for emphasis, and the brand's files this page places, with the call that
 *  places each, and how a logo is treated. '' when there is neither, so the prompt stays as it was. */
export function brandPageNote(files: BrandAsset[], emphasis?: string) {
  if (!files.length) return emphasis ? `\n\n## The brand\n${emphasisRule(emphasis)}` : '';
  const logos = files.some((a) => LOGOS.includes(a.kind));
  const dark = files.find((a) => a.kind === 'logo-dark');
  return `

## The brand's files on this page
${files.map((a) => `${line(a)}\n  \`${call(a)}\``).join('\n')}
${logos ? `
- A logo keeps its own proportions (height = width × its h / w, \`fit: 'contain'\`): never stretch, crop, recolour, filter, blend or rotate it, and never draw it yourself.
- A logo or an icon is never framed, bordered or shadowed: keep \`border: false, shadow: false, r: 0\` as in the calls above, so it stands on the page as it is.
- Leave clear space around a logo, at least half its height, with nothing else in it; nothing passes over it.
- ${dark ? `On a dark ground use \`${pathOf(dark)}\`; on a light ground the logo.` : 'On a dark ground, set the logo on a light card of its own rather than on the dark.'}
- A logo with an opaque background sits on a ground that matches it, or on a card, never cut out.` : ''}
- Place only these files, where the storyboard puts them; reveal them as you would any element.${emphasis ? `\n${emphasisRule(emphasis)}` : ''}`;
}

/** For the page's reviewer: one more check when a logo is on the page. '' otherwise. */
export function brandReviewNote(files: BrandAsset[]) {
  const logos = files.filter((a) => LOGOS.includes(a.kind));
  if (!logos.length) return '';
  return `\nThe brand's logo is on this page (${logos.map((a) => a.file).join(', ')}). Fail the page if the logo is stretched or squashed, cropped, recoloured, covered by anything, crowded by other marks, or too small or faint to read.\n`;
}
