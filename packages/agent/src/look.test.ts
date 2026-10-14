import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLook, designedIssues, designedLook, type FontChoice } from './look.js';

test('a look keeps colours by the runtime\'s names, font stacks and stylesheet paths', () => {
  assert.deepEqual(cleanLook({
    palette: { red: '#a8301f', redF: '#F2D3C2', paper: '#F1EADA' },
    fonts: { hand: "'Noto Serif SC Variable', 'Songti SC', serif" },
    css: ['_fonts/noto-serif-sc/wght.css'],
  }), {
    palette: { red: '#A8301F', redF: '#F2D3C2', paper: '#F1EADA' },
    fonts: { hand: "'Noto Serif SC Variable', 'Songti SC', serif" },
    css: ['_fonts/noto-serif-sc/wght.css'],
  });
});

test('anything else is dropped, and an empty look is none', () => {
  assert.equal(cleanLook({ palette: { red: 'red', 'x y': '#000000', ink: '#00000' }, fonts: { hand: 'x; } body { display:none' }, css: ['../../etc/passwd.css', 'a.js', '/abs.css'] }), undefined);
  assert.equal(cleanLook(null), undefined);
  assert.equal(cleanLook('#fff'), undefined);
  assert.deepEqual(cleanLook({ palette: { ink: '#111111', bogus: 1 } }), { palette: { ink: '#111111' } });
});

const FONTS: Record<string, FontChoice> = { serif: { name: 'Serif', hand: "'Noto Serif SC Variable', serif", latin: "'Fraunces Variable', serif", css: ['_fonts/noto-serif-sc/wght.css', '_fonts/fraunces/wght.css'] } };

test('a designed film\'s look: its card, its colours with their light fills, the font it picked and its line', () => {
  const d = designedLook({ card: 'A newspaper from 1930: halftone, two inks.', palette: { paper: '#f2ead8', ink: '#1a1a1a', red: '#B3261E', redF: '#EECCCC' }, font: 'serif', line: 'clean' }, FONTS);
  assert.equal(d?.card, 'A newspaper from 1930: halftone, two inks.');
  assert.deepEqual(d?.look, {
    palette: { paper: '#F2EAD8', ink: '#1A1A1A', red: '#B3261E', redF: '#EECCCC', inkF: '#C2BCAE' },
    fonts: { hand: "'Noto Serif SC Variable', serif", latin: "'Fraunces Variable', serif" },
    css: ['_fonts/noto-serif-sc/wght.css', '_fonts/fraunces/wght.css'],
    line: { rough: 0, bow: 0, single: true },
  });
  // no card, no designed look; a font or line the style doesn't offer is left out
  assert.equal(designedLook({ palette: { ink: '#000000' } }, FONTS), undefined);
  assert.deepEqual(designedLook({ card: 'x', font: 'comic', line: 'wobbly' }, FONTS), { card: 'x', look: undefined });
});

test('the storyboard check says what a designed look still lacks', () => {
  assert.deepEqual(designedIssues({ card: 'x'.repeat(240), palette: { paper: '#FFFFFF', ink: '#000000' }, font: 'serif', line: 'pen' }, FONTS), []);
  const missing = designedIssues(undefined, FONTS);
  assert.equal(missing.length, 5);
  assert.ok(missing.some((m) => m.includes('serif')));
});
