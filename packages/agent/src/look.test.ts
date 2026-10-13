import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLook } from './look.js';

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
