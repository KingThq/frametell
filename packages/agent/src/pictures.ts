// A film's generated pictures. Code draws text, numbers, charts and parts that move one by one; it draws a whale, a
// lit street or a character badly. A style that allows it lets the storyboard ask an image model for a few pictures
// (`look.pictures`): the first is drawn at once as the film's sample, for the person to confirm the look (and adjust it)
// before the go-ahead; the rest are drawn from it, side by side, while the film is narrated. Pages place them with
// P.img and draw everything else on top in code. The style's own words for the model (pictures.json in the style's
// folder) are added to every prompt: the storyboard only says what is in the picture.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ENGINE_DIR } from '@frametell/engine/tools/project.mjs';
import { readIn } from './projectfs.js';

/** where a film keeps its generated pictures, with their list */
export const PICTURES_DIR = 'assets/gen';
export const PICTURES_MANIFEST = `${PICTURES_DIR}/pictures.json`;

export type PictureKind = 'scene' | 'object' | 'character' | 'texture';
export type PictureShape = 'wide' | 'tall' | 'square';
const KINDS: PictureKind[] = ['scene', 'object', 'character', 'texture'];
const SHAPES: Record<PictureShape, string> = { wide: '1536x1024', tall: '1024x1536', square: '1024x1024' };
/** a cut-out stands on the page by itself: drawn on a transparent ground */
export const cutOut = (k: PictureKind) => k === 'object' || k === 'character';

/** one picture as the storyboard asks for it. `like`: another picture of the film that shows the same thing (the same
 *  character in another pose): it is drawn from that one, so the two match */
export interface PicturePlan { id: string; kind: PictureKind; what: string; shape: PictureShape; pages: string[]; like?: string }

/** what a style tells the image model, from its folder's pictures.json; no file: the style draws everything in code */
export interface PictureStyle { kinds: PictureKind[]; max: number; quality: 'low' | 'medium'; prefix: string; avoid: string }

/** one picture as drawn: the file (its name carries the content's hash, so a picture drawn again is a new file and the
 *  render's segment cache never shows a stale one) and the prompt it was drawn from */
export interface Picture {
  id: string; file: string; prompt: string; w: number; h: number; alpha: boolean; at: string;
  /** what the person asked of this picture alone */
  note?: string;
  /** what it was drawn for (pictureKey): a picture is drawn again only when this changes, never because its prompt was
   *  worded another way (an adjusted sample is drawn from the one before it, a plain one from nothing) */
  key?: string;
}
/** the film's pictures: `notes` are the person's adjustments to the look, at the sample, which every picture follows */
export interface Pictures { notes: string[]; items: Picture[] }

/** draws one picture; `refs`: pictures it is drawn from (the sample's look, the same character) */
export interface ImageProvider {
  readonly model: string;
  draw(o: { prompt: string; size: string; quality: string; transparent: boolean; refs?: Uint8Array[]; signal?: AbortSignal }): Promise<Uint8Array>;
}

const ID = /^[a-z][a-z0-9-]{1,30}$/;
export const PICTURES_MAX = 12;

export function pictureStyle(style: string): PictureStyle | undefined {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(fs.readFileSync(path.join(ENGINE_DIR, 'styles', style, 'pictures.json'), 'utf8')); } catch { return undefined; }
  const kinds = Array.isArray(raw.kinds) ? KINDS.filter((k) => (raw.kinds as unknown[]).includes(k)) : [];
  const prefix = typeof raw.prefix === 'string' ? raw.prefix.trim() : '';
  if (!kinds.length || !prefix) return undefined;
  const max = typeof raw.max === 'number' && raw.max >= 1 ? Math.min(PICTURES_MAX, Math.floor(raw.max)) : 6;
  const quality = raw.quality === 'low' ? 'low' : 'medium';
  return { kinds, max, quality, prefix, avoid: typeof raw.avoid === 'string' ? raw.avoid.trim() : '' };
}

const listOf = (look: unknown) => (look && typeof look === 'object' ? (look as Record<string, unknown>).pictures : undefined);

/** the pictures the storyboard asks for, as far as they are well formed (the sample first) */
export function picturePlan(look: unknown, style?: PictureStyle): PicturePlan[] {
  const list = listOf(look);
  if (!Array.isArray(list) || !style) return [];
  const out: PicturePlan[] = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const kind = KINDS.find((k) => k === o.kind && style.kinds.includes(k));
    const what = typeof o.what === 'string' ? o.what.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
    const shape = (Object.keys(SHAPES) as PictureShape[]).find((s) => s === o.shape) ?? 'wide';
    const pages = Array.isArray(o.pages) ? o.pages.filter((p): p is string => typeof p === 'string') : [];
    if (!ID.test(id) || !kind || !what || out.some((p) => p.id === id)) continue;
    const like = typeof o.like === 'string' && out.some((p) => p.id === o.like && !p.like) ? o.like : undefined;
    out.push({ id, kind, what, shape, pages, ...(like && out.length ? { like } : {}) });
    if (out.length === style.max) break;
  }
  return out;
}

/** what is wrong with `look.pictures`, for the storyboard check (nothing when there are none: pictures are optional) */
export function pictureIssues(look: unknown, pageIds: string[], style: PictureStyle): string[] {
  const list = listOf(look);
  if (list === undefined) return [];
  if (!Array.isArray(list)) return ['`look.pictures` must be a list of { id, kind, what, shape, pages }'];
  const out: string[] = [];
  const ids = new Set(pageIds), seen = new Map<string, Record<string, unknown>>();
  if (list.length > style.max) out.push(`\`look.pictures\` lists ${list.length} pictures: this style allows ${style.max}; keep the ones code would draw worst`);
  list.forEach((x, i) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    if (!ID.test(id)) { out.push(`\`look.pictures\`: "${String(o.id)}" is not a picture id (lower-case letters, digits and dashes, 2–31 long)`); return; }
    if (seen.has(id)) out.push(`\`look.pictures\`: ${id} is listed twice`);
    seen.set(id, o);
    if (!KINDS.includes(o.kind as PictureKind) || !style.kinds.includes(o.kind as PictureKind)) out.push(`\`look.pictures\`: ${id} has kind "${String(o.kind)}"; this style draws ${style.kinds.join(', ')}`);
    if (o.shape !== undefined && !(String(o.shape) in SHAPES)) out.push(`\`look.pictures\`: ${id} has shape "${String(o.shape)}"; use wide, tall or square`);
    const what = typeof o.what === 'string' ? o.what.trim() : '';
    if (what.length < 10) out.push(`\`look.pictures\`: ${id} needs \`what\`: what the picture shows, in a sentence`);
    else if (what.length > 400) out.push(`\`look.pictures\`: ${id}'s \`what\` is ${what.length} characters: say it in at most 400`);
    const pages = Array.isArray(o.pages) ? o.pages : [];
    const unknown = pages.filter((p) => typeof p !== 'string' || !ids.has(p));
    if (unknown.length) out.push(`\`look.pictures\`: ${id} names pages the storyboard does not have: ${unknown.join(', ')}`);
    else if (!pages.length) out.push(`\`look.pictures\`: ${id} is on no page: list the pages that show it, or leave it out`);
    if (o.like !== undefined) {
      const base = seen.get(String(o.like));
      if (i === 0) out.push(`\`look.pictures\`: ${id} is the first picture, the film's sample: it is drawn from nothing, so it can't have \`like\``);
      else if (!base || base === o) out.push(`\`look.pictures\`: ${id} is \`like\` "${String(o.like)}", which is not a picture listed before it`);
      else if (base.like !== undefined) out.push(`\`look.pictures\`: ${id} is \`like\` ${String(o.like)}, which is itself \`like\` another: name the first one`);
    }
  });
  return out;
}

const KIND_LINE: Record<PictureKind, string> = {
  scene: 'A full-frame illustration that fills the whole canvas edge to edge.',
  object: 'One object alone, whole and uncropped, centred with a clear margin, on a fully transparent background, no ground, no shadow.',
  character: 'One character alone, full body, whole and uncropped, centred with a clear margin, on a fully transparent background, no ground, no shadow.',
  texture: 'A full-frame ground texture with no objects in it, even in tone so text can sit on top.',
};

/** the prompt a picture is drawn from: the style's words, what the picture is, the person's adjustments, and what the
 *  pictures it is drawn from are for */
export function picturePrompt(style: PictureStyle, p: PicturePlan, notes: string[], refs: 'none' | 'look' | 'same' | 'adjust', note?: string): string {
  return [
    `${style.prefix.replace(/[.\s]+$/, '')}.`,
    KIND_LINE[p.kind],
    `Subject: ${p.what.replace(/[.\s]+$/, '')}.`,
    refs === 'look' ? 'The reference image shows the look of this film: match its style, palette, shading and level of detail exactly, but draw the subject above, not what the reference shows.' : '',
    refs === 'same' ? 'The reference image shows this very subject: keep it exactly the same (shape, proportions, colours, details); change only what the subject above says.' : '',
    refs === 'adjust' ? 'The reference image is this picture as it is now: keep its subject, pose, composition and look, and change only what the latest adjustment below asks.' : '',
    notes.length ? `Adjustments to the look: ${notes.join('; ')}.` : '',
    note ? `For this picture: ${note}.` : '',
    style.avoid || 'No text, no letters, no numbers, no signature, no watermark.',
  ].filter(Boolean).join('\n');
}

export const pictureSize = (p: PicturePlan) => SHAPES[p.shape];
/** what a picture is drawn for: what the storyboard asks, and the look's adjustments it follows */
export const pictureKey = (p: PicturePlan, notes: string[]) => createHash('sha256').update(JSON.stringify([p.kind, p.shape, p.what, p.like ?? '', notes])).digest('hex').slice(0, 16);
export const picturePath = (p: Pick<Picture, 'file'>) => `${PICTURES_DIR}/${p.file}`;
export const pictureFile = (id: string, data: Uint8Array, type: 'png' | 'jpg' | 'webp') => `${id}-${createHash('sha256').update(data).digest('hex').slice(0, 10)}.${type}`;

/** a picture's type and size from its first bytes, and whether it can be transparent; undefined when it is none of PNG,
 *  JPEG or WebP (an answer that isn't a picture is never kept) */
export function sniffPicture(b: Uint8Array): { type: 'png' | 'jpg' | 'webp'; w: number; h: number; alpha: boolean } | undefined {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (buf.length > 26 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') {
    const color = buf[25];
    return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), alpha: color === 4 || color === 6 || buf.includes(Buffer.from('tRNS')) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'jpg', w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), alpha: false };
      i += 2 + len;
    }
    return undefined;
  }
  if (buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = buf.toString('latin1', 12, 16);
    if (chunk === 'VP8X') return { type: 'webp', w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), alpha: (buf[20] & 0x10) !== 0 };
    if (chunk === 'VP8L') { const v = buf.readUInt32LE(21); return { type: 'webp', w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff), alpha: ((v >> 28) & 1) === 1 }; }
    if (chunk === 'VP8 ') return { type: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, alpha: false };
  }
  return undefined;
}

const FILE = /^[a-z][a-z0-9-]{1,30}-[0-9a-f]{10}\.(png|jpg|webp)$/;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** the film's pictures as its list says, read through the checked reader (the agents' shell writes the project): only
 *  entries with a file name this module gives; nothing when there is no list */
export function readPictures(dir: string): Pictures {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(readIn(dir, PICTURES_MANIFEST, { record: true }).toString('utf8')); } catch { return { notes: [], items: [] }; }
  const notes = Array.isArray(raw.notes) ? raw.notes.map((n) => text(n, 300)).filter(Boolean).slice(0, 20) : [];
  const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((x): Picture[] => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    if (typeof o.id !== 'string' || !ID.test(o.id) || typeof o.file !== 'string' || !FILE.test(o.file)) return [];
    const px = (v: unknown) => (typeof v === 'number' && v > 0 && v < 100000 ? Math.round(v) : 0);
    const note = text(o.note, 300);
    return [{ id: o.id, file: o.file, prompt: typeof o.prompt === 'string' ? o.prompt.slice(0, 4000) : '', w: px(o.w), h: px(o.h), alpha: o.alpha === true, at: typeof o.at === 'string' ? o.at : '', ...(note ? { note } : {}), ...(typeof o.key === 'string' && /^[0-9a-f]{16}$/.test(o.key) ? { key: o.key } : {}) }];
  });
  return { notes, items: items.filter((p, i) => items.findIndex((q) => q.id === p.id) === i) };
}

/** the pictures a page places: those the storyboard puts on it, drawn */
export function picturesOn(plan: PicturePlan[], drawn: Picture[], page: string): (Picture & PicturePlan)[] {
  return plan.filter((p) => p.pages.includes(page)).flatMap((p) => { const d = drawn.find((x) => x.id === p.id); return d ? [{ ...p, ...d }] : []; });
}

/** the call that places it at its own proportions */
export const pictureCall = (p: Picture & PicturePlan) => {
  const h = p.w && p.h ? `w * ${p.h} / ${p.w}` : 'h';
  return p.kind === 'scene' || p.kind === 'texture'
    ? `P.img('${picturePath(p)}', x, y, w, ${h}, { fit: 'cover', border: false, shadow: false, r: 0, at })`
    : `P.img('${picturePath(p)}', x, y, w, ${h}, { fit: 'contain', border: false, shadow: false, r: 0, at })`;
};

/** For the director at the storyboard: what pictures it may ask for. '' when the style draws everything in code. */
export function picturePlanNote(style: PictureStyle | undefined): string {
  if (!style) return '';
  return `This style may also use up to ${style.max} generated pictures, listed in \`look.pictures\`: an image model draws them in the style's own look, and the pages place them and draw everything else on top in code.
\`"pictures": [{ "id": "whale", "kind": "object", "what": "a humpback whale gliding to the left, mouth closed, long white flippers", "shape": "wide", "pages": ["p02", "p05"] }]\`
- Ask for one only where code would look poor: ${style.kinds.map((k) => ({ scene: 'an illustrated place (`scene`, full frame)', object: 'a real thing such as an animal, a machine or a plant (`object`, cut out on a transparent ground)', character: 'a person or a creature (`character`, cut out)', texture: 'a ground of paper or grain (`texture`)' })[k]).join(', ')}. Never for text, numbers, labels, charts, diagrams, arrows or anything whose parts must move one by one: a picture only moves as a whole (it slides, grows, fades, is revealed), so what the narration points at part by part stays in code.
- \`what\` describes the subject only (what it is, its pose, what it does), never the style, colours of the look or a camera: the style's own words are added for you. Never ask for writing in a picture.
- The first picture is drawn at once as the film's sample: the user sees it with the storyboard and confirms the look before the go-ahead, and every other picture is drawn to match it. Put first the one that shows the film's look best.
- The same character or object in another pose is a picture of its own with \`"like": "<id of the first>"\`, so it is drawn from that one and matches it.
- 3–${Math.min(6, style.max)} pictures usually; a film whose pages need none has no \`pictures\`. A beat that shows one says so in its object (\`picture whale\`), so the page agent places it there. A picture on several pages is the same picture every time; a thing that recurs and must move part by part goes in \`kit\` instead.`;
}

/** For the page agent: the generated pictures on this page, each with its call. '' when none. */
export function picturePageNote(on: (Picture & PicturePlan)[]): string {
  if (!on.length) return '';
  return `

## This film's pictures on this page
Drawn for this film by an image model in the film's look (open one with read to see it):
${on.map((p) => `- \`${picturePath(p)}\` (picture ${p.id}): ${p.kind}, ${p.w}×${p.h}, ${p.alpha ? 'transparent background' : 'opaque'}: ${p.what}\n  \`${pictureCall(p)}\``).join('\n')}
- Place each where the storyboard's beats show it. A \`scene\` or \`texture\` is a backdrop: under everything, filling its area (\`fit: 'cover'\`); a cut-out stands on the page as it is.
- A picture moves as a whole only: slide, grow slowly, fade, reveal with a wipe, drift for parallax. Never stretch, squash, crop away its subject, recolour, filter or draw over its face.
- Everything the narration points at part by part, every label, number and word, is drawn in code on top, at the moment it is spoken, with room around it to read. Keep text off a busy part of a scene, or set it on a quiet patch of it.`;
}

/** For the page's reviewer. '' when none. */
export function pictureReviewNote(on: (Picture & PicturePlan)[]): string {
  if (!on.length) return '';
  return `\nThis page places ${on.length > 1 ? 'pictures' : 'a picture'} drawn for the film by an image model (${on.map((p) => `${p.id}: ${p.what}`).join('; ')}). Fail the page if one is missing, stretched or squashed, cropped so its subject is lost, covering the page's words, or if text sits on it where it can't be read. Don't fail it for the picture's own drawing.\n`;
}

/** an OpenAI-compatible image service (`/v1/images/generations`, and `/v1/images/edits` when drawn from pictures) */
export function openaiImages(key: string, o: { baseUrl?: string; model?: string } = {}): ImageProvider {
  const base = (o.baseUrl || 'https://api.openai.com').replace(/\/+$/, '').replace(/\/v1$/, '');
  const model = o.model || 'gpt-image-2';
  return {
    model,
    async draw({ prompt, size, quality, transparent, refs, signal }) {
      const timeout = AbortSignal.timeout(180_000);
      const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let res: Response;
      if (refs?.length) {
        const form = new FormData();
        form.append('model', model); form.append('prompt', prompt); form.append('size', size); form.append('quality', quality); form.append('n', '1');
        if (transparent) form.append('background', 'transparent');
        refs.forEach((r, i) => { const t = sniffPicture(r)?.type ?? 'png'; form.append('image[]', new Blob([r], { type: `image/${t === 'jpg' ? 'jpeg' : t}` }), `ref-${i}.${t}`); });
        res = await fetch(`${base}/v1/images/edits`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: sig });
      } else {
        res = await fetch(`${base}/v1/images/generations`, {
          method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: sig,
          body: JSON.stringify({ model, prompt, size, quality, n: 1, ...(transparent ? { background: 'transparent' } : {}) }),
        });
      }
      const body = await res.text();
      if (!res.ok) throw new Error(`image service ${res.status}: ${body.slice(0, 300)}`);
      let j: { data?: { b64_json?: string; url?: string }[] };
      try { j = JSON.parse(body); } catch { throw new Error('the image service did not answer with JSON'); }
      const d = j.data?.[0];
      if (d?.b64_json) return new Uint8Array(Buffer.from(d.b64_json, 'base64'));
      if (d?.url) { const r = await fetch(d.url, { signal: sig }); if (r.ok) return new Uint8Array(await r.arrayBuffer()); }
      throw new Error('the image service answered without a picture');
    },
  };
}
