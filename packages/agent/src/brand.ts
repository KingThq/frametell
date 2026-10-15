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
  /** the director may give the logo a few planned moments (default: yes); false: no logo on screen at all, the brand
   *  only in its colours and tone */
  showLogo?: boolean;
  /** the palette name that carries the brand's main colour in the film's style (the host maps the colours) */
  emphasis?: string;
  /** the film's palette as the host set it from the brand's colours (name → #RRGGBB), so its colours are described as
   *  they are now */
  palette?: Record<string, string>;
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
  if (o.showLogo === false) brief.showLogo = false;
  if (typeof o.emphasis === 'string' && NAME.test(o.emphasis)) brief.emphasis = o.emphasis;
  if (o.palette && typeof o.palette === 'object' && !Array.isArray(o.palette)) {
    const palette = Object.fromEntries(Object.entries(o.palette as Record<string, unknown>)
      .filter((e): e is [string, string] => NAME.test(e[0]) && typeof e[1] === 'string' && /^#[0-9a-f]{6}$/i.test(e[1])).slice(0, 24).map(([k, v]) => [k, v.toUpperCase()]));
    if (Object.keys(palette).length) brief.palette = palette;
  }
  return brief;
}

const pathOf = (a: BrandAsset) => `${BRAND_DIR}/${a.file}`;
const size = (a: BrandAsset) => (a.w && a.h ? `${a.w}×${a.h}` : 'size unknown');
const line = (a: BrandAsset) => `- \`${pathOf(a)}\`: ${a.kind}, ${size(a)}, ${a.alpha ? 'transparent background' : 'opaque background'}${a.name && a.name !== a.file ? `, “${a.name}”` : ''}${a.note ? `: ${a.note}` : ''}`;

/** How the brand's logo shows in a film: in a few moments the director plans, never stamped on pages by rule. The
 *  rules as the director reads them (a host writing the brand down for a film, as brand.md, can use the same words). */
export const BRAND_MOMENT_RULES = `- The logo appears only in brand moments you plan: 0 to 3 in the film, and a short film usually needs one. Restraint beats repetition.
- Each brand moment is its own beat, and that beat says so in its object: \`brand moment: ${BRAND_DIR}/<file>\`, the kind of moment, and roughly where and when (e.g. \`brand moment: ${BRAND_DIR}/logo.svg, closing sign-off, centred once the scene has cleared, tagline under it\`). The page agent draws exactly that, and only there.
- A typical moment is a closing sign-off as a composed beat of its own: the scene clears or settles first, then the logo enters with the style's own motion (drawn, stamped, faded in), the tagline under it, and holds at least 2 seconds.
- Or a placement native to the style: in ink and wash a seal-like mark in a corner near the title, on a chalkboard signed in a corner, in an editorial layout a masthead.
- Never on top of or crowding a title, a label, a diagram or the subject, never in the middle of a content page, and at most one logo in a frame.
- The logo file itself is never distorted, recoloured, cropped or framed, whatever the moment.`;

/** The brand, for the director (storyboard, script, changes): after the style card, so it reads as who the film
 *  speaks for, not as a new style. '' without a brand, so the prompt stays as it was. */
export function brandSection(brand?: BrandBrief) {
  if (!brand) return '';
  const logo = brand.assets.some((a) => LOGOS.includes(a.kind));
  const shown = brand.showLogo !== false;
  const files = brand.assets.filter((a) => shown || !LOGOS.includes(a.kind));
  return `---
# This film's brand

The film is made for a brand and speaks for it. Its colours and typeface, when it has them, are already the film's palette and fonts (use them by name); what follows is who it is.

- Name: ${brand.name}${brand.about ? `\n- About: ${brand.about}` : ''}${brand.tagline ? `\n- Tagline: “${brand.tagline}”` : ''}${brand.tone ? `\n- Tone of voice:\n\n<brand-tone>\n${brand.tone}\n</brand-tone>` : ''}

Its files, in the project (open a picture with read to see it):
${files.length ? files.map(line).join('\n') : '(none)'}

${logo && shown ? `## Brand moments\n\n${BRAND_MOMENT_RULES}\n\n## Everything else\n\n` : ''}${!shown ? '- No logo on screen anywhere in this film: the brand shows in its colours and its tone only.\n' : ''}- Use the other files only where the content calls for them (the product's screenshot where the film shows the product); never put one in because it is there. A beat that places one names its path in its object (\`${BRAND_DIR}/…\`), so the page agent places that very file.
${brand.palette ? `- In this film the palette's colours are: ${Object.entries(brand.palette).map(([k, v]) => `${k} ${v}`).join(', ')}. Describe colours by what they are now, not by the style card's names.\n` : ''}${brand.emphasis ? `${emphasisRule(brand.emphasis)}\n` : ''}- Write the narration and the words on screen in the brand's tone. The rules on facts still hold: the tone never adds a claim, a number or a promise the material doesn't support.`;
}

/** the brand's files a page places: those its storyboard names (no logo when the film shows none), the logo bringing
 *  its dark version along for a dark ground */
export function brandFilesOn(brand: BrandBrief | undefined, pages: { id: string; section?: string; say?: string; beats?: { object?: string; action?: string; text?: string }[] }[], id: string): BrandAsset[] {
  if (!brand?.assets.length) return [];
  const p = pages.find((x) => x.id === id);
  if (!p) return [];
  const allowed = brand.assets.filter((a) => brand.showLogo !== false || !LOGOS.includes(a.kind));
  const words = [p.section, p.say, ...(p.beats ?? []).flatMap((b) => [b.object, b.action, b.text])].filter(Boolean).join('\n');
  const used = allowed.filter((a) => words.includes(a.file));
  if (used.some((a) => a.kind === 'logo')) for (const a of allowed) if (a.kind === 'logo-dark' && !used.includes(a)) used.push(a);
  return allowed.filter((a) => used.includes(a));
}

const call = (a: BrandAsset) => {
  const h = a.w && a.h ? `w * ${a.h} / ${a.w}` : 'h';
  // a logo or an icon stands on the page as it is: P.img frames a picture (rounded corners, an outline, a shadow) unless told not to
  return LOGOS.includes(a.kind) || a.kind === 'icon'
    ? `P.img('${pathOf(a)}', x, y, w, ${h}, { fit: 'contain', border: false, shadow: false, r: 0, pop: 0, at, dur: 0.8 })`
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
- The storyboard plans the brand moment: draw exactly the beat that names the logo, where and when it says, and nowhere else on the page.
- Compose the moment around the logo: nothing else within about one logo-height of it, never over or crowding a title, a label, a diagram or the subject, and only one logo in a frame.
- It enters with the style's own motion (drawn on, stamped, faded in: \`pop: 0\` and a slow \`dur\`, as in the calls above), never a pop; a sign-off holds at least 2 seconds.
- A logo keeps its own proportions (height = width × its h / w, \`fit: 'contain'\`): never stretch, crop, recolour, filter, blend or rotate it, and never draw it yourself.
- A logo or an icon is never framed, bordered or shadowed: keep \`border: false, shadow: false, r: 0\` as in the calls above, so it stands on the page as it is.
- ${dark ? `On a dark ground use \`${pathOf(dark)}\`; on a light ground the logo.` : 'On a dark ground, set the logo on a light card of its own rather than on the dark.'}
- A logo with an opaque background sits on a ground that matches it, or on a card, never cut out.` : ''}
- Place only these files, where and when the storyboard puts them.${emphasis ? `\n${emphasisRule(emphasis)}` : ''}`;
}

/** For the page's reviewer: the logo checked where the storyboard puts it, and looked for where it doesn't. '' for a
 *  film with no logo of a brand. */
export function brandReviewNote(brand: BrandBrief | undefined, files: BrandAsset[]) {
  if (!brand?.assets.some((a) => LOGOS.includes(a.kind))) return '';
  const logos = files.filter((a) => LOGOS.includes(a.kind));
  if (!logos.length) return `\nThe storyboard puts no brand logo on this page: fail it if one appears.\n`;
  return `\nThe storyboard puts the brand's logo on this page (${logos.map((a) => a.file).join(', ')}). Fail the page if the logo is stretched or squashed, cropped, recoloured, framed, covered by anything, overlapping or crowding any other element, in the middle of the content, more than one in a frame, or too small or faint to read.\n`;
}
