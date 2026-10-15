import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { execFileSync } from 'node:child_process';
import diagnostics from 'node:diagnostics_channel';
import type { ChildProcess } from 'node:child_process';
import { prepareMaterials, htmlToMarkdown, parseInChild } from './materials.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fs-materials-'));
/** a "picture": a PNG signature followed by enough bytes to pass the tiny-image filter */
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(6000, 7)]);
const zip = async (files: Record<string, string | Buffer>) => {
  const z = new JSZip();
  for (const [k, v] of Object.entries(files)) z.file(k, v);
  return z.generateAsync({ type: 'nodebuffer' });
};

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
async function docx() {
  const p = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const tc = (t: string) => `<w:tc>${p(t)}</w:tc>`;
  const pic = `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="1" name="p" descr="架构图"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
    'word/styles.xml': `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
    'word/media/image1.png': png(),
    'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${p('第一章 缘起', 'Heading1')}${p('这是正文 & 一些细节。')}${p('小节', 'Heading2')}<w:tbl>${`<w:tr>${tc('指标')}${tc('数值')}</w:tr><w:tr>${tc('用户')}${tc('42')}</w:tr>`}</w:tbl>${pic}</w:body></w:document>`,
  });
}

const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const sp = (ph: string, paras: [string, number?][]) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${paras.map(([t, l]) => `<a:p>${l ? `<a:pPr lvl="${l}"/>` : ''}<a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
const rels = (r: [string, string, string][]) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r.map(([id, t, target]) => `<Relationship Id="${id}" Type="${REL}/${t}" Target="${target}"/>`).join('')}</Relationships>`;
async function pptx() {
  return zip({
    // slide2.xml is shown first: order must follow presentation.xml, not file names
    'ppt/presentation.xml': `<?xml version="1.0"?><p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rB"/><p:sldId id="257" r:id="rA"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels([['rA', 'slide', 'slides/slide1.xml'], ['rB', 'slide', 'slides/slide2.xml']]),
    'ppt/slides/slide2.xml': `<?xml version="1.0"?><p:sld ${P}><p:cSld><p:spTree>${sp('title', [['开场：为什么']])}${sp('body', [['要点一'], ['细节 a', 1], ['要点二 &amp; 三']])}<p:pic><p:blipFill><a:blip r:embed="rI"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`,
    'ppt/slides/_rels/slide2.xml.rels': rels([['rN', 'notesSlide', '../notesSlides/notesSlide7.xml'], ['rI', 'image', '../media/image1.png']]),
    'ppt/notesSlides/notesSlide7.xml': `<?xml version="1.0"?><p:notes ${P}><p:cSld><p:spTree>${sp('sldImg', [])}${sp('body', [['先讲痛点'], ['再给数字']])}${sp('sldNum', [['1']])}</p:spTree></p:cSld></p:notes>`,
    'ppt/media/image1.png': png(),
    'ppt/slides/slide1.xml': `<?xml version="1.0"?><p:sld ${P}><p:cSld><p:spTree>${sp('ctrTitle', [['结尾']])}<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>年份</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>收入</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>2026</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>¥9</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
  });
}

async function epub() {
  const ch = (t: string, body: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{}</style></head><body><h1>${t}</h1>${body}</body></html>`;
  return zip({
    'mimetype': 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/content.opf': '<?xml version="1.0"?><package><manifest><item id="c2" href="text/ch2.xhtml"/><item id="c1" href="text/ch1.xhtml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
    'OEBPS/text/ch1.xhtml': ch('第一章', '<p>很久很久以前，有一个关于 <em>视频</em> 的故事。</p><ul><li>甲</li><li>乙</li></ul>'),
    'OEBPS/text/ch2.xhtml': ch('第二章', '<p>后来，故事讲完了，大家都很满意。</p>'),
  });
}

/** a hand-written two-page PDF: a big heading and body text in Helvetica */
function pdf() {
  const streams = [
    `BT /F1 24 Tf 72 720 Td (Frametell Overview) Tj ET BT /F1 11 Tf 72 680 Td (Studio turns your materials into explainer videos.) Tj ET BT /F1 11 Tf 72 660 Td (It runs locally and needs no cloud OCR.) Tj ET`,
    `BT /F1 11 Tf 72 720 Td (Second page body text goes here for testing.) Tj ET`,
  ];
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams.map((s) => `<< /Length ${s.length} >>\nstream\n${s}\nendstream`),
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test('docx: headings, paragraphs, tables and embedded pictures', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'report.docx'), await docx());
  const { files } = await prepareMaterials(dir);
  const doc = files.find((f) => f.name === 'report.docx')!;
  assert.equal(doc.parsedTo, 'report.md');
  const md = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
  assert.match(md, /^<!-- frametell: parsed from "report.docx" -->/);
  assert.match(md, /^# report$/m);
  assert.match(md, /^## 第一章 缘起$/m);
  assert.match(md, /^这是正文 & 一些细节。$/m);
  assert.match(md, /^### 小节$/m);
  assert.match(md, /^\| 指标 \| 数值 \|\n\| --- \| --- \|\n\| 用户 \| 42 \|$/m);
  assert.match(md, /!\[架构图\]\(report-img-01\.png\)/);
  assert.ok(fs.existsSync(path.join(dir, 'report-img-01.png')));
  assert.ok(files.some((f) => f.name === 'report-img-01.png' && f.kind === 'image'));
  assert.ok(!files.some((f) => f.name === 'report.md'), 'the parse is reported as parsedTo, not as a separate text file');
});

test('pptx: slides in presentation order, titles, bullet levels, tables, notes, pictures', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'deck.pptx'), await pptx());
  const { files } = await prepareMaterials(dir, 'zh');
  assert.equal(files.find((f) => f.name === 'deck.pptx')?.pages, 2);
  const md = fs.readFileSync(path.join(dir, 'deck.md'), 'utf8');
  const first = md.indexOf('## 第 1 页：开场：为什么'), second = md.indexOf('## 第 2 页：结尾');
  assert.ok(first > 0 && second > first, md);
  assert.match(md, /^- 要点一\n  - 细节 a\n- 要点二 & 三$/m);
  assert.match(md, /!\[\]\(deck-img-01\.png\)/);
  assert.match(md, /^> 备注：先讲痛点\n>\n> 再给数字$/m);
  assert.ok(!md.includes('- 1\n'), 'the slide-number placeholder in the notes is not speaker text');
  assert.match(md, /^\| 年份 \| 收入 \|\n\| --- \| --- \|\n\| 2026 \| ¥9 \|$/m);
});

test('epub: chapters in spine order with headings and lists', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'book.epub'), await epub());
  const { files } = await prepareMaterials(dir);
  assert.equal(files[0].pages, 2);
  const md = fs.readFileSync(path.join(dir, 'book.md'), 'utf8');
  assert.ok(md.indexOf('## 第一章') < md.indexOf('## 第二章'));
  assert.match(md, /有一个关于 \*视频\* 的故事。/);
  assert.match(md, /^- 甲\n- 乙$/m);
  assert.ok(!md.includes('p{}'));
});

test('pdf: page headings, a large line becomes a heading, body text kept', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'paper.pdf'), pdf());
  const { files } = await prepareMaterials(dir, 'zh');
  const f = files[0];
  assert.equal(f.pages, 2);
  assert.equal(f.warning, undefined);
  const md = fs.readFileSync(path.join(dir, 'paper.md'), 'utf8');
  assert.match(md, /^## 第 1 页$/m);
  assert.match(md, /^### Frametell Overview$/m);
  assert.match(md, /Studio turns your materials into explainer videos\./);
  assert.ok(md.indexOf('## 第 2 页') > md.indexOf('no cloud OCR'));
});

test('page headings and speaker notes follow the film language', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'deck.pptx'), await pptx());
  fs.writeFileSync(path.join(dir, 'paper.pdf'), pdf());
  await prepareMaterials(dir, 'en');
  const deck = fs.readFileSync(path.join(dir, 'deck.md'), 'utf8'), paper = fs.readFileSync(path.join(dir, 'paper.md'), 'utf8');
  assert.ok(deck.includes('## Page 1: 开场：为什么') && deck.includes('## Page 2: 结尾'), deck);
  assert.match(deck, /^> Notes: 先讲痛点$/m);
  assert.match(paper, /^## Page 1$/m);
  assert.ok(!/第 \d+ 页|备注/.test(deck + paper));
});

test('idempotent, never touches originals or a user-written x.md, reports failures', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'deck.pptx'), await pptx());
  fs.writeFileSync(path.join(dir, 'notes.md'), '# my notes');
  fs.writeFileSync(path.join(dir, 'notes.docx'), await docx());
  fs.writeFileSync(path.join(dir, 'broken.pdf'), 'not a pdf');
  const a = await prepareMaterials(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8'), '# my notes');
  assert.equal(a.files.find((f) => f.name === 'notes.docx')?.parsedTo, 'notes.docx.md');
  assert.ok(a.files.some((f) => f.name === 'notes.md' && f.kind === 'text'));
  const broken = a.files.find((f) => f.name === 'broken.pdf')!;
  assert.equal(broken.parsedTo, undefined);
  assert.match(broken.warning ?? '', /解析失败|couldn't parse/);
  assert.ok(fs.existsSync(path.join(dir, 'broken.pdf')) && fs.existsSync(path.join(dir, 'deck.pptx')));

  const before = fs.statSync(path.join(dir, 'deck.md')).mtimeMs;
  const b = await prepareMaterials(dir);
  assert.equal(fs.statSync(path.join(dir, 'deck.md')).mtimeMs, before, 'an up-to-date parse is not redone');
  assert.equal(b.files.find((f) => f.name === 'deck.pptx')?.pages, 2);
  assert.equal(b.files.find((f) => f.name === 'notes.docx')?.parsedTo, 'notes.docx.md');

  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(dir, 'deck.pptx'), later, later);
  await prepareMaterials(dir);
  assert.notEqual(fs.statSync(path.join(dir, 'deck.md')).mtimeMs, before, 'a newer source is parsed again');
});

test('htmlToMarkdown: nested and ordered lists', () => {
  assert.equal(htmlToMarkdown('<ol><li>one<ul><li>a</li></ul></li><li>two</li></ol><p>after</p>'), '1. one\n  - a\n2. two\n\nafter');
});

const bwrap = process.platform === 'linux' && (() => { try { execFileSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', 'true'], { stdio: 'ignore' }); return true; } catch { return false; } })();
test('with no network, documents are parsed in a confined child, with the same result', { skip: !bwrap && 'bubblewrap only' }, async () => {
  const a = tmp(), b = tmp();
  const was = process.env.FRAMETELL_SANDBOX_NONET;
  // every child this process starts (Node publishes each one): the proof the parse ran in one, under bubblewrap
  const started: ChildProcess[] = [];
  const seen = (m: unknown) => { started.push((m as { process: ChildProcess }).process); };
  try {
    fs.writeFileSync(path.join(a, 'r.docx'), await docx());
    fs.writeFileSync(path.join(b, 'r.docx'), await docx());
    const here = await prepareMaterials(a, 'zh');
    diagnostics.subscribe('child_process', seen);
    process.env.FRAMETELL_SANDBOX_NONET = '1';
    assert.deepEqual(await prepareMaterials(b, 'zh'), JSON.parse(JSON.stringify(here)));   // the child's answer is JSON: no keys left undefined
    assert.equal(fs.readFileSync(path.join(b, 'r.md'), 'utf8'), fs.readFileSync(path.join(a, 'r.md'), 'utf8'));
    const parse = started.map((c) => c.spawnargs).filter((x) => x.some((y) => y.endsWith('materials-child.js')));
    assert.equal(parse.length, 1, 'the documents were parsed in this process, not in a child');
    assert.match(path.basename(parse[0][0]), /^bwrap$/, `the child ran unconfined: ${parse[0].join(' ')}`);
  } finally {
    diagnostics.unsubscribe('child_process', seen);
    if (was === undefined) delete process.env.FRAMETELL_SANDBOX_NONET; else process.env.FRAMETELL_SANDBOX_NONET = was;
    for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('what the document parser\'s child answers is checked: names that are paths, unknown kinds and wrong shapes are refused', async () => {
  const dir = tmp(), bin = tmp();
  try {
    const forge = (answer: unknown) => { const f = path.join(bin, `c${Math.random().toString(36).slice(2)}.mjs`); fs.writeFileSync(f, `console.log(${JSON.stringify(JSON.stringify(answer))});`); return f; };
    const good = { name: 'r.docx', kind: 'document', parsedTo: 'r.md', pages: 2, chars: 10, warning: 'w' };
    // the control: a well-formed answer is taken as it is
    const files = [good, { ...good, name: '季度 报告.pdf', parsedTo: '季度 报告.pdf.md' }, { name: 'a.png', kind: 'image', chars: 0 }];
    assert.deepEqual(await parseInChild(dir, 'en', forge({ files })), { files });
    const bad: [string, unknown][] = [
      ['parsedTo climbs out', { files: [{ ...good, parsedTo: '../../x.md' }] }],
      ['parsedTo is absolute', { files: [{ ...good, parsedTo: '/etc/passwd' }] }],
      ['parsedTo has a slash', { files: [{ ...good, parsedTo: 'a/b.md' }] }],
      ['parsedTo is ..', { files: [{ ...good, parsedTo: '..' }] }],
      ['parsedTo is .', { files: [{ ...good, parsedTo: '.' }] }],
      ['parsedTo is not text', { files: [{ ...good, parsedTo: 5 }] }],
      ['parsedTo is another file', { files: [{ ...good, parsedTo: 'script.js' }] }],
      ['a name that is a path', { files: [{ ...good, name: '../r.docx', parsedTo: '../r.md' }] }],
      ['an unknown kind', { files: [{ ...good, kind: 'program' }] }],
      ['a name that is not text', { files: [{ ...good, name: {} }] }],
      ['chars that is not a number', { files: [{ ...good, chars: '1' }] }],
      ['pages that is not a number', { files: [{ ...good, pages: '1' }] }],
      ['a warning that is not text', { files: [{ ...good, warning: 1 }] }],
      ['an entry that is not an object', { files: ['r.docx'] }],
      ['files not a list', { files: {} }],
    ];
    for (const [what, answer] of bad) await assert.rejects(parseInChild(dir, 'en', forge(answer)), /documents could not be read/, what);
  } finally { for (const d of [dir, bin]) fs.rmSync(d, { recursive: true, force: true }); }
});
