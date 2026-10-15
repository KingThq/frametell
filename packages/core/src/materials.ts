// Turns the binary documents in a project's materials/ (PDF, Word, PowerPoint, EPUB) into sibling Markdown files the
// director can `read`. Originals are never touched; a document is re-parsed only when it is newer than its .md.
// Pictures embedded in Word/PowerPoint are copied out next to it (<name>-img-01.png) so real figures can be used.
// Local only: there is no OCR, so a scanned PDF without a text layer comes out (nearly) empty, with a warning.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { tr } from './i18n.js';

export type MaterialKind = 'text' | 'image' | 'document';
export interface PreparedMaterial { name: string; kind: MaterialKind; parsedTo?: string; pages?: number; chars: number; warning?: string }

const TEXT = /\.(md|markdown|txt)$/i;
const IMAGE = /\.(png|jpe?g|webp|gif|svg)$/i;
const DOCUMENT = /\.(pdf|docx|pptx|epub)$/i;
/** pictures worth keeping: formats the agent and a browser can show, big enough not to be a bullet or a logo sliver */
const KEEP_IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const MIN_IMAGE_BYTES = 4 * 1024;
const MAX_IMAGES = 40;
/** below this many characters per page a PDF is most likely scanned */
const SPARSE_CHARS_PER_PAGE = 40;

const MARK = /^<!-- frametell: parsed from "(.*?)"(?: pages=(\d+))? -->/;
const header = (source: string, pages?: number) => `<!-- frametell: parsed from "${source}"${pages ? ` pages=${pages}` : ''} -->\n\n`;

export const kindOf = (name: string): MaterialKind | undefined =>
  DOCUMENT.test(name) ? 'document' : TEXT.test(name) ? 'text' : IMAGE.test(name) ? 'image' : undefined;

interface Parsed { markdown: string; pages?: number; warning?: string }
type ImageSink = (data: Uint8Array, ext: string) => string | undefined;

/** the headings a parse writes into the Markdown the director reads, in the film's language */
const LABELS = {
  zh: { page: (n: number, title?: string) => `第 ${n} 页${title ? `：${title}` : ''}`, notes: '备注：' },
  en: { page: (n: number, title?: string) => `Page ${n}${title ? `: ${title}` : ''}`, notes: 'Notes: ' },
};
export type MaterialLang = keyof typeof LABELS;

/**
 * The documents of a folder parsed to Markdown (parseMaterials). With the network taken away (a hosted sandbox) the
 * parse runs in a child confined to that folder: a PDF or a Word file comes from outside and its parsers are a large
 * surface, so they never run in the process that has the network. The child's answer is read as JSON, nothing more.
 */
export async function prepareMaterials(dir: string, lang: MaterialLang = 'en'): Promise<{ files: PreparedMaterial[] }> {
  if (process.env.FRAMETELL_SANDBOX_NONET !== '1') return parseMaterials(dir, lang);
  if (!fs.existsSync(dir)) return { files: [] };
  return parseInChild(dir, lang);
}

const KINDS: readonly string[] = ['text', 'image', 'document'] satisfies MaterialKind[];
/** a plain file name in that folder, never a path. Not only [\w.-]: people name their documents in their own language
 *  (报告.docx) and attach() keeps that */
const plain = (n: unknown): n is string => typeof n === 'string' && n.length >= 1 && n.length <= 200 && n !== '.' && n !== '..' && !/[\\/\u0000-\u001f]/.test(n);
const isEntry = (f: unknown): f is PreparedMaterial => {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
  const x = f as Record<string, unknown>;
  // the parse of a document is x.md, or x.pdf.md beside a user's own x.md (parseMaterials): nothing else
  return plain(x.name) && typeof x.kind === 'string' && KINDS.includes(x.kind)
    && (x.parsedTo === undefined || (plain(x.parsedTo) && (x.parsedTo === `${x.name.replace(/\.[^.]+$/, '')}.md` || x.parsedTo === `${x.name}.md`)))
    && (x.pages === undefined || (typeof x.pages === 'number' && Number.isFinite(x.pages)))
    && typeof x.chars === 'number' && Number.isFinite(x.chars) && (x.warning === undefined || typeof x.warning === 'string');
};

/** parseMaterials in a child (`script`: materials-child.js; another only in a test), confined to `dir` by confinedCmd.
 *  The child parsed documents from outside: its answer is taken only when every entry has the shape of one */
export async function parseInChild(dir: string, lang: MaterialLang, script = fileURLToPath(new URL('./materials-child.js', import.meta.url))): Promise<{ files: PreparedMaterial[] }> {
  // loaded here, not at the top: the child imports this module and needs none of the agent
  const { confinedCmd, nodeEnv } = await import('@frametell/agent');
  const [cmd, argv] = confinedCmd(dir, process.execPath, [script, lang]);
  const out = await new Promise<string>((ok, fail) => execFile(cmd, argv, { cwd: dir, env: nodeEnv(), encoding: 'utf8', timeout: 300_000, maxBuffer: 16 << 20 },
    (e, so, se) => (e ? fail(new Error(`the documents could not be read: ${String(se || e.message).trim().slice(-1000)}`)) : ok(String(so)))));
  let r: { files?: unknown } | undefined;
  try { r = JSON.parse(out.trim().split('\n').pop() || '{}'); } catch { /* said below */ }
  if (!r || !Array.isArray(r.files) || !r.files.every(isEntry)) throw new Error('the documents could not be read: the parser\'s answer has the wrong shape');
  return { files: r.files };
}

export async function parseMaterials(dir: string, lang: MaterialLang = 'en'): Promise<{ files: PreparedMaterial[] }> {
  const L = LABELS[lang] ?? LABELS.en;
  if (!fs.existsSync(dir)) return { files: [] };
  const names = fs.readdirSync(dir).filter((n) => !n.startsWith('.') && fs.statSync(path.join(dir, n)).isFile()).sort();
  const files: PreparedMaterial[] = [];
  const outputs = new Set<string>();

  for (const name of names.filter((n) => kindOf(n) === 'document')) {
    const src = path.join(dir, name);
    const base = name.replace(/\.[^.]+$/, '');
    // a user's own x.md is never overwritten: then the parse goes to x.pdf.md
    let out = `${base}.md`;
    const existing = readHead(path.join(dir, out));
    if (existing !== undefined && MARK.exec(existing)?.[1] !== name) out = `${name}.md`;
    const outPath = path.join(dir, out);
    outputs.add(out);

    const prev = readHead(outPath);
    const m = prev !== undefined ? MARK.exec(prev) : null;
    if (m && fs.statSync(outPath).mtimeMs >= fs.statSync(src).mtimeMs) {
      const md = fs.readFileSync(outPath, 'utf8');
      files.push({ name, kind: 'document', parsedTo: out, pages: m[2] ? +m[2] : undefined, chars: md.length - m[0].length });
      continue;
    }

    let n = 0;
    const sink: ImageSink = (data, ext) => {
      if (n >= MAX_IMAGES || data.byteLength < MIN_IMAGE_BYTES || !KEEP_IMAGE.test(`x.${ext}`)) return undefined;
      const file = `${base}-img-${String(++n).padStart(2, '0')}.${ext.toLowerCase().replace('jpeg', 'jpg')}`;
      fs.writeFileSync(path.join(dir, file), data);
      outputs.add(file);
      return file;
    };
    try {
      const buf = fs.readFileSync(src);
      const ext = path.extname(name).slice(1).toLowerCase();
      const r = ext === 'pdf' ? await parsePdf(buf, L) : ext === 'docx' ? await parseDocx(buf, sink) : ext === 'pptx' ? await parsePptx(buf, sink, L) : await parseEpub(buf);
      const body = tidy(r.markdown);
      fs.writeFileSync(outPath, header(name, r.pages) + `# ${base}\n\n` + body + '\n');
      const warning = r.warning ?? (body.trim() ? undefined : tr('没有提取到文字', 'no text found'));
      files.push({ name, kind: 'document', parsedTo: out, pages: r.pages, chars: body.length, warning });
    } catch (e) {
      outputs.delete(out);
      files.push({ name, kind: 'document', chars: 0, warning: tr(`解析失败：${(e as Error).message}`, `couldn't parse: ${(e as Error).message}`) });
    }
  }

  for (const name of fs.readdirSync(dir).sort()) {
    const kind = kindOf(name);
    if (!kind || kind === 'document' || outputs.has(name) && kind === 'text') continue;
    if (kind === 'text' && MARK.test(readHead(path.join(dir, name)) ?? '')) continue; // a parse of a document that is gone
    files.push({ name, kind, chars: kind === 'text' ? fs.readFileSync(path.join(dir, name), 'utf8').length : 0 });
  }
  return { files };
}

function readHead(file: string): string | undefined {
  try {
    const fd = fs.openSync(file, 'r');
    try { const b = Buffer.alloc(512); const n = fs.readSync(fd, b, 0, 512, 0); return b.subarray(0, n).toString('utf8'); }
    finally { fs.closeSync(fd); }
  } catch { return undefined; }
}

const tidy = (s: string) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// ── XML helpers (OOXML / XHTML are regular enough for this) ────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e.toLowerCase()] ?? all);
}
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
function table(rows: string[][]) {
  rows = rows.filter((r) => r.some((c) => c));
  if (!rows.length) return '';
  const w = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: w }, (_, i) => cell(r[i] ?? '')).join(' | ')} |`;
  return [line(rows[0]), `| ${Array(w).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}
/** resolve a relationship target relative to the part that owns it */
const resolve = (from: string, target: string) => path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
async function rels(zip: JSZip, part: string) {
  const file = path.posix.join(path.posix.dirname(part), '_rels', path.posix.basename(part) + '.rels');
  const xml = (await zip.file(file)?.async('string')) ?? '';
  const map = new Map<string, { type: string; target: string }>();
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'), target = attr(m[0], 'Target');
    if (id && target && attr(m[0], 'TargetMode') !== 'External') map.set(id, { type: attr(m[0], 'Type') ?? '', target: resolve(part, target) });
  }
  return map;
}

// ── PDF ───────────────────────────────────────────────────────────────────────────────────────────────────────

async function parsePdf(buf: Buffer, L: (typeof LABELS)[MaterialLang]): Promise<Parsed> {
  const { getDocumentProxy, extractTextItems } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf), { verbosity: 0 });
  try {
    const { totalPages, items } = await extractTextItems(pdf);
    // lines per page, each with its biggest font size; the body size is the one most characters are set in
    const pages = items.map((page) => {
      const lines: { text: string; size: number }[] = [];
      let cur = { text: '', size: 0 };
      let y = NaN, end = -Infinity;
      for (const it of page) {
        // some PDFs (fake bold, per-glyph repaints) emit runs that overlap the previous one on the same line, which would
        // read "聚聚光光": drop the characters already covered
        let str = it.str;
        const cw = str.length ? it.width / str.length : 0;
        if (Math.abs(it.y - y) > 1) end = -Infinity;
        if (cw > 0 && it.x < end - cw / 2) {
          const k = Math.min(str.length, Math.round((end - it.x) / cw));
          if (k && cur.text.endsWith(str.slice(0, k))) str = str.slice(k);
        }
        if (cw > 0) { y = it.y; end = Math.max(end, it.x + it.width); }
        cur.text += unbold(str);
        if (it.str.trim()) cur.size = Math.max(cur.size, Math.round(it.fontSize * 2) / 2);
        if (it.hasEOL) { lines.push(cur); cur = { text: '', size: 0 }; end = -Infinity; }
      }
      lines.push(cur);
      return lines.map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim(), size: l.size }))
        // list numbers and bullets that the PDF sets apart from their text carry nothing on their own
        .filter((l) => l.text && !/^((\d+\.)+|[a-zA-Z]\.|[-–○●•▪■◦·\s]+)$/.test(l.text));
    });
    const bySize = new Map<number, number>();
    for (const l of pages.flat()) bySize.set(l.size, (bySize.get(l.size) ?? 0) + l.text.length);
    const body = [...bySize].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;

    const out: string[] = [];
    let chars = 0;
    pages.forEach((lines, i) => {
      out.push(`## ${L.page(i + 1)}`);
      let para = '', heading = '';
      const flush = () => { if (para) out.push(para); if (heading) out.push(heading); para = heading = ''; };
      for (const l of lines) {
        chars += l.text.length;
        if (body && l.size >= body * 1.25 && l.text.length <= 80) {
          // a title set over two lines is still one heading
          const marks = l.size >= body * 1.6 ? '###' : '####';
          if (heading.startsWith(marks + ' ') && !para) { heading += (cjkJoin(heading, l.text) ? '' : ' ') + l.text; continue; }
          flush(); heading = `${marks} ${l.text}`; continue;
        }
        if (heading) { out.push(heading); heading = ''; }
        if (/^([•●▪■◦–*·]\s*|-\s+|\d{1,2}[.)]\s+|\d{1,2}、|[（(]\d{1,2}[)）])/.test(l.text)) { flush(); para = `- ${l.text.replace(/^([•●▪■◦–*·]|-(?=\s))\s*/, '')}`; }
        // join wrapped lines: CJK runs straight on, Latin gets a space
        else para = para ? para + (cjkJoin(para, l.text) ? '' : ' ') + l.text : l.text;
        if (/[。！？.!?:：]$/.test(l.text)) flush();
      }
      flush();
    });
    const warning = chars / Math.max(totalPages, 1) < SPARSE_CHARS_PER_PAGE
      ? tr(`几乎没有可提取的文字（${chars} 字 / ${totalPages} 页），可能是扫描件；需要 OCR 后再用`, `almost no extractable text (${chars} characters / ${totalPages} pages); it may be a scan and needs OCR first`) : undefined;
    return { markdown: out.join('\n\n'), pages: totalPages, warning };
  } finally {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
}
const CJK = /[\u3000-\u9fff\uff00-\uffef]/;
const cjkJoin = (a: string, b: string) => CJK.test(a.slice(-1)) || CJK.test(b[0] ?? '');
/** fake bold (each glyph painted twice) comes out as "聚聚光光": every pair doubled → keep one of each */
function unbold(s: string) {
  if (s.length < 4 || s.length % 2) return s;
  for (let i = 0; i < s.length; i += 2) if (s[i] !== s[i + 1]) return s;
  let r = '';
  for (let i = 0; i < s.length; i += 2) r += s[i];
  return r;
}

// ── DOCX (mammoth → HTML → Markdown) ──────────────────────────────────────────────────────────────────────────

async function parseDocx(buf: Buffer, sink: ImageSink): Promise<Parsed> {
  const { value, messages } = await mammoth.convertToHtml({ buffer: buf }, {
    convertImage: mammoth.images.imgElement(async (img) => {
      const file = sink(new Uint8Array(await img.readAsBuffer()), img.contentType.split('/')[1] ?? 'bin');
      return { src: file ?? '' };
    }),
  });
  void messages;
  return { markdown: htmlToMarkdown(value) };
}

/** a small HTML → Markdown converter for mammoth's (and most EPUB) markup: headings, paragraphs, lists, tables, images */
export function htmlToMarkdown(html: string): string {
  html = html.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const tables: string[] = [];
  html = html.replace(/<table\b[\s\S]*?<\/table>/gi, (t) => {
    const rows = [...t.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((r) => [...r[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => inline(c[1])));
    tables.push(table(rows));
    return `\n\n\u0000T${tables.length - 1}\u0000\n\n`;
  });
  const out: { text: string; li: boolean }[] = [];
  const depth: ('ul' | 'ol')[] = [];
  const counters: number[] = [];
  // walk the block-level tags; whatever sits between them is inline text
  const re = /<(\/?)(h[1-6]|p|div|li|ul|ol|blockquote|br|hr|section|article|tr)\b[^>]*>/gi;
  let last = 0, buf = '', prefix = '';
  const flush = () => { const t = inline(buf); if (t) out.push({ text: prefix + t.replace(/\n/g, '\n' + ' '.repeat(prefix.length)), li: /^ *(-|\d+\.) $/.test(prefix) }); buf = ''; prefix = ''; };
  for (const m of html.matchAll(re)) {
    buf += html.slice(last, m.index);
    last = m.index! + m[0].length;
    const close = !!m[1], tag = m[2].toLowerCase();
    if (tag === 'br') { buf += '\n'; continue; }
    flush();
    if (tag === 'hr') { out.push({ text: '---', li: false }); continue; }
    if (tag === 'ul' || tag === 'ol') { if (close) { depth.pop(); counters.pop(); } else { depth.push(tag); counters.push(0); } continue; }
    if (close) continue;
    if (/^h[1-6]$/.test(tag)) prefix = '#'.repeat(Math.min(+tag[1] + 1, 6)) + ' '; // the file title is the only #
    else if (tag === 'li') {
      const d = depth.length - 1, ordered = depth[d] === 'ol';
      if (ordered) counters[d]++;
      prefix = '  '.repeat(Math.max(d, 0)) + (ordered ? `${counters[d]}. ` : '- ');
    } else if (tag === 'blockquote') prefix = '> ';
  }
  buf += html.slice(last);
  flush();
  // list items read better without blank lines between them
  return out.map((b, i) => (i ? (b.li && out[i - 1].li ? '\n' : '\n\n') : '') + b.text).join('')
    .replace(/\u0000T(\d+)\u0000/g, (_, i) => tables[+i]);
}
function inline(s: string) {
  return decode(s
    .replace(/<img\b[^>]*>/gi, (t) => { const src = attr(t, 'src'); return src && !src.startsWith('data:') ? `![${attr(t, 'alt') ?? ''}](${src})` : ''; })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t: string) => (t.trim() ? `**${t.trim()}**` : t))
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t: string) => (t.trim() ? `*${t.trim()}*` : t))
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

// ── PPTX ──────────────────────────────────────────────────────────────────────────────────────────────────────

const REL_SLIDE = /\/slide$/, REL_NOTES = /\/notesSlide$/, REL_IMAGE = /\/image$/;

async function parsePptx(buf: Buffer, sink: ImageSink, L: (typeof LABELS)[MaterialLang]): Promise<Parsed> {
  const zip = await JSZip.loadAsync(buf);
  const slideNo = (p: string) => +(/slide(\d+)\.xml$/.exec(p)?.[1] ?? 0);
  // presentation order comes from presentation.xml's slide list; fall back to slideN numbering
  let order: string[] = [];
  const pres = await zip.file('ppt/presentation.xml')?.async('string');
  if (pres) {
    const r = await rels(zip, 'ppt/presentation.xml');
    order = [...pres.matchAll(/<p:sldId\b[^>]*>/g)].map((m) => r.get(attr(m[0], 'r:id') ?? '')).filter((x) => x && REL_SLIDE.test(x.type)).map((x) => x!.target);
  }
  if (!order.length) order = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => slideNo(a) - slideNo(b));

  const out: string[] = [];
  const seen = new Map<string, string | undefined>();
  for (const [i, part] of order.entries()) {
    const xml = await zip.file(part)?.async('string');
    if (!xml) continue;
    const r = await rels(zip, part);
    let title = '';
    const lines: string[] = [];
    // shapes, tables and pictures in document order
    for (const m of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>|<a:tbl\b[\s\S]*?<\/a:tbl>|<p:pic\b[\s\S]*?<\/p:pic>/g)) {
      const el = m[0];
      if (el.startsWith('<a:tbl')) {
        const rows = [...el.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((tr) => [...tr[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((tc) => paragraphs(tc[0]).map((p) => p.text).join(' ')));
        const t = table(rows);
        if (t) lines.push('', t, '');
        continue;
      }
      if (el.startsWith('<p:pic')) {
        const id = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(el)?.[1];
        const target = id ? r.get(id) : undefined;
        if (target && REL_IMAGE.test(target.type)) {
          if (!seen.has(target.target)) {
            const data = await zip.file(target.target)?.async('uint8array');
            seen.set(target.target, data ? sink(data, path.posix.extname(target.target).slice(1)) : undefined);
          }
          const file = seen.get(target.target);
          if (file) lines.push('', `![](${file})`, '');
        }
        continue;
      }
      const ph = /<p:ph\b[^>]*>/.exec(el)?.[0];
      const isTitle = !!ph && /type="(title|ctrTitle)"/.test(ph);
      const paras = paragraphs(el);
      if (isTitle && !title) { title = paras.map((p) => p.text).join(' '); continue; }
      const sub = !!ph && /type="subTitle"/.test(ph);
      for (const p of paras) lines.push(sub ? p.text : `${'  '.repeat(p.level)}- ${p.text}`);
    }
    out.push(`## ${L.page(i + 1, title)}`);
    if (lines.length) out.push(lines.join('\n'));
    const notesPart = [...r.values()].find((x) => REL_NOTES.test(x.type))?.target;
    const notesXml = notesPart ? await zip.file(notesPart)?.async('string') : undefined;
    if (notesXml) {
      // the notes slide also holds a slide-image and a slide-number placeholder; only the body is the speaker's
      const notes = [...notesXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].filter((s) => /<p:ph\b[^>]*type="body"/.test(s[0])).flatMap((s) => paragraphs(s[0]).map((p) => p.text));
      if (notes.length) out.push(notes.map((n, k) => `> ${k ? '' : L.notes}${n}`).join('\n>\n'));
    }
  }
  return { markdown: out.join('\n\n'), pages: order.length };
}

function paragraphs(xml: string) {
  return [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((p) => ({
    level: +(/<a:pPr\b[^>]*\slvl="(\d+)"/.exec(p[1])?.[1] ?? 0),
    text: decode([...p[1].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/>/g)].map((t) => t[1] ?? ' ').join('')).replace(/\s+/g, ' ').trim(),
  })).filter((p) => p.text);
}

// ── EPUB ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function parseEpub(buf: Buffer): Promise<Parsed> {
  const zip = await JSZip.loadAsync(buf);
  const container = (await zip.file('META-INF/container.xml')?.async('string')) ?? '';
  const opfPath = attr(/<rootfile\b[^>]*>/.exec(container)?.[0] ?? '', 'full-path');
  const opf = opfPath ? await zip.file(opfPath)?.async('string') : undefined;
  if (!opfPath || !opf) throw new Error(tr('不是有效的 EPUB（缺少 OPF）', 'not a valid EPUB (no OPF)'));
  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = attr(m[0], 'id'), href = attr(m[0], 'href');
    if (id && href) manifest.set(id, resolve(opfPath, decodeURIComponent(href)));
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*>/g)].map((m) => manifest.get(attr(m[0], 'idref') ?? '')).filter((x): x is string => !!x);
  const out: string[] = [];
  let chapters = 0;
  for (const part of spine) {
    const html = await zip.file(part)?.async('string');
    if (!html) continue;
    const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
    // images inside the book are not copied out; drop them rather than leave dangling links
    const md = htmlToMarkdown(body.replace(/<(img|image)\b[^>]*>/gi, '')).trim();
    if (md.replace(/[#\s]/g, '').length < 10) continue; // covers, blank separators
    chapters++;
    out.push(md);
  }
  return { markdown: out.join('\n\n---\n\n'), pages: chapters };
}
