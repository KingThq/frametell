import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandFilesOn, brandSection, cleanBrand, type BrandBrief } from './brand.js';
import { pagePrompt, pageSystem, plannerSystem, reviewerPrompt, reviewerSystem } from './prompts.js';
import type { PageTiming, Storyboard } from './project.js';

const brand: BrandBrief = {
  name: 'Tidewise', about: 'A tide-table app for sailors', tone: 'Calm, exact, a little dry.\nNever hype.', tagline: 'Know the water',
  assets: [
    { file: 'a1.svg', kind: 'logo', name: 'Logo', note: 'the main logo', w: 600, h: 200, alpha: true },
    { file: 'a2.svg', kind: 'logo-dark', name: 'Logo (dark)', note: '', w: 600, h: 200, alpha: true },
    { file: 'a3.png', kind: 'image', name: 'Home screen', note: 'the app\'s home screen', w: 1170, h: 2532, alpha: false },
  ],
};
const sb: Storyboard = { title: 'Tides', summary: 'How the moon pulls the sea', style: 'warm-story', cast: '', lang: 'en', pages: [
  { id: 'p01', section: 'Open', say: 'The sea rises twice a day', beats: [{ at: 'c1', object: 'shore', action: 'water rises' }] },
  { id: 'p02', section: 'How', say: 'The app shows it', beats: [{ at: 'c1', object: 'phone with assets/brand/a3.png', action: 'slides in' }] },
  { id: 'p03', section: 'Middle', say: 'The moon pulls', beats: [{ at: 'c1', object: 'moon', action: 'pulls' }] },
  { id: 'p04', section: 'Close', say: 'Next time, think of the moon', beats: [{ at: 'c1', object: 'moon and sea', action: 'still' }] },
] };
const t: PageTiming = { id: 'p01', start: 0, end: 8, speechEnd: 7, cues: [{ i: 1, at: 0.4, abs: 0.4, text: 'The sea rises' }] };

test('a brief is trimmed to size, keeps only plain picture names, and needs a name', () => {
  assert.equal(cleanBrand({ assets: [] }), undefined);
  assert.equal(cleanBrand('Tidewise'), undefined);
  const b = cleanBrand({
    name: '  Tidewise  ', tagline: 'x'.repeat(200), bookends: false, id: 'b-1', nope: 1,
    assets: [
      { file: 'a1.svg', kind: 'logo', name: 'Logo', note: 'n', w: 600.4, h: 200, alpha: true },
      { file: '../a.svg', kind: 'logo' }, { file: 'x/a.png' }, { file: '.hidden.png' }, { file: 'a.gif' }, { file: 'A1.SVG' },
      { file: 'b.webp', kind: 'hologram', w: -3, h: 'x' },
    ],
  })!;
  assert.equal(b.name, 'Tidewise');
  assert.equal(b.id, 'b-1');
  assert.equal(b.tagline!.length, 80);
  assert.equal(b.bookends, false);
  assert.ok(!('nope' in b));
  assert.deepEqual(b.assets.map((a) => a.file), ['a1.svg', 'b.webp']);
  assert.deepEqual(b.assets[0], { file: 'a1.svg', kind: 'logo', name: 'Logo', note: 'n', w: 600, h: 200, alpha: true });
  assert.deepEqual(b.assets[1], { file: 'b.webp', kind: 'image', name: 'b.webp', note: '', w: 0, h: 0, alpha: false });
  assert.equal(cleanBrand({ name: 'x', assets: Array.from({ length: 40 }, (_, i) => ({ file: `f${i}.png` })) })!.assets.length, 30);
});

test('the brand follows the style card and its notes in the director\'s prompt, and adds nothing else', () => {
  const sys = plannerSystem('warm-story', '- chatty', '- more white space', brand);
  const card = sys.indexOf("# This film's style"), own = sys.indexOf("# This film's own look"), it = sys.indexOf("# This film's brand");
  assert.ok(card >= 0 && own > card && it > own);
  assert.ok(sys.indexOf('<preferences>') > it, 'the preferences still close the prompt');
  assert.equal(sys.replace('\n\n' + brandSection(brand), ''), plannerSystem('warm-story', '- chatty', '- more white space'));
  for (const s of ['Name: Tidewise', 'About: A tide-table app for sailors', 'Tagline: “Know the water”', '<brand-tone>\nCalm, exact, a little dry.\nNever hype.\n</brand-tone>',
    '`assets/brand/a1.svg`: logo, 600×200, transparent background, “Logo”: the main logo', '`assets/brand/a3.png`: image, 1170×2532, opaque background, “Home screen”: the app\'s home screen',
    'The first page opens on the brand\'s logo and the last page closes on it', 'only where the content calls for them', 'The rules on facts still hold']) assert.ok(sys.includes(s), s);
  assert.ok(brandSection({ ...brand, bookends: false }).includes('Show the logo only where the content calls for it.'));
});

test('without a brand the system prompts are as they were', () => {
  assert.equal(plannerSystem('warm-story', 'p', 'n', undefined), plannerSystem('warm-story', 'p', 'n'));
  assert.equal(brandSection(undefined), '');
  for (const sys of [plannerSystem('warm-story'), pageSystem('warm-story'), reviewerSystem('warm-story')]) assert.ok(!sys.includes("# This film's brand") && !sys.includes('assets/brand'));
});

test('a page is told of the brand files it places: the logos on the first and last page, a file its storyboard names', () => {
  assert.deepEqual(brandFilesOn(brand, sb.pages, 'p01').map((a) => a.file), ['a1.svg', 'a2.svg']);
  assert.deepEqual(brandFilesOn(brand, sb.pages, 'p02').map((a) => a.file), ['a3.png']);
  assert.deepEqual(brandFilesOn(brand, sb.pages, 'p03'), []);
  assert.deepEqual(brandFilesOn(brand, sb.pages, 'p04').map((a) => a.file), ['a1.svg', 'a2.svg']);
  assert.deepEqual(brandFilesOn({ ...brand, bookends: false }, sb.pages, 'p01'), []);

  const first = pagePrompt(sb, 'p01', t, 'en', 'en', false, brand);
  assert.ok(first.includes("## The brand's files on this page"));
  assert.ok(first.includes("P.img('assets/brand/a1.svg', x, y, w, w * 200 / 600, { fit: 'contain', border: false, shadow: false, r: 0 })"));
  assert.ok(first.includes('never stretch, crop, recolour'));
  assert.ok(first.includes('never framed, bordered or shadowed'));
  assert.ok(first.includes('Leave clear space around a logo'));
  assert.ok(first.includes('On a dark ground use `assets/brand/a2.svg`'));
  assert.ok(first.indexOf("## The brand's files") < first.indexOf('Stop once pages/p01.js'));
  const shot = pagePrompt(sb, 'p02', t, 'en', 'en', false, brand);
  assert.ok(shot.includes("P.img('assets/brand/a3.png', x, y, w, w * 2532 / 1170, { fit: 'cover' })"));
  assert.ok(!shot.includes('clear space'), 'no logo rules for a page without a logo');
  assert.ok(!shot.includes('border: false'), 'a picture that is not a logo is framed as any picture');
  assert.equal(pagePrompt(sb, 'p03', t, 'en', 'en', false, brand), pagePrompt(sb, 'p03', t, 'en', 'en', false));
});

test('the reviewer checks the logo only on a page that shows it', () => {
  const r = reviewerPrompt(sb, 'p04', t, 1, [], [{ local: 1 }], undefined, brand);
  assert.ok(r.includes("The brand's logo is on this page (a1.svg, a2.svg). Fail the page if the logo is stretched"));
  assert.ok(r.indexOf("brand's logo") < r.indexOf('## The checker'));
  assert.equal(reviewerPrompt(sb, 'p02', t, 1, [], [{ local: 1 }], undefined, brand), reviewerPrompt(sb, 'p02', t, 1, [], [{ local: 1 }]));
});

test('the brand\'s main colour, when the host names its palette name, is the one for emphasis: in the director\'s prompt and on every page', () => {
  const rule = "The brand's main colour is the palette's `teal`: use it for emphasis (highlights, underlines, the key number) rather than other accents.";
  const b = cleanBrand({ ...brand, emphasis: 'teal' })!;
  assert.equal(b.emphasis, 'teal');
  for (const bad of ['', 'te al', '--x', 'red;}', '1red', 'x'.repeat(40), 7]) assert.equal(cleanBrand({ ...brand, emphasis: bad })!.emphasis, undefined);
  assert.ok(brandSection(b).includes(`- ${rule}`));
  assert.ok(!brandSection(brand).includes('main colour'));
  const plain = pagePrompt(sb, 'p03', t, 'en', 'en', false, b);
  assert.ok(plain.includes(`## The brand\n- ${rule}`));
  assert.ok(plain.indexOf(rule) < plain.indexOf('Stop once pages/p03.js'));
  const first = pagePrompt(sb, 'p01', t, 'en', 'en', false, b);
  assert.ok(first.includes(rule) && first.includes("## The brand's files on this page"));
  assert.equal(pagePrompt(sb, 'p03', t, 'en', 'en', false, brand), pagePrompt(sb, 'p03', t, 'en', 'en', false));
});
