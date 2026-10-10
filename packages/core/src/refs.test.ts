import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { attach, cleanRefs, withRefs } from './refs.js';

test('references lead the message, with times in the film and paths the director can open', () => {
  const out = withRefs('这里节奏再慢一点', [
    { kind: 'page', page: 'p04', label: '第 4 页「节奏」' },
    { kind: 'line', page: 'p04', label: 'x', at: 35.2, text: '连续完成 4 个番茄钟之后，' },
    { kind: 'frame', page: 'p04', label: 'x', at: 36.4, path: 'out/frames/364.jpg', text: '连续完成' },
  ]);
  assert.match(out, /^<references>/);
  assert.match(out, /<page id="p04" file="pages\/p04.js">第 4 页「节奏」<\/page>/);
  assert.match(out, /<line page="p04" at="0:35">连续完成 4 个番茄钟之后，<\/line>/);
  assert.match(out, /image="out\/frames\/364.jpg"/);
  assert.match(out, /\n\n这里节奏再慢一点$/);
  assert.equal(withRefs('只有字', []), '只有字');
});

test('references that point outside the project are dropped', () => {
  const kept = cleanRefs([
    { kind: 'file', label: 'a', path: '../../etc/passwd', image: false },
    { kind: 'frame', label: 'b', page: 'p01', at: 1, path: '/abs.jpg' },
    { kind: 'file', label: 'c', path: 'refs/x.png', image: true },
    { kind: 'nope', label: 'd' },
  ]);
  assert.deepEqual(kept.map((r) => r.label), ['c']);
});

test('attached files land in refs/, and unsupported ones are refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-refs-'));
  const r = await attach(dir, '截图 1.png', new Uint8Array([137, 80, 78, 71]));
  assert.equal(r.kind, 'file');
  assert.ok(r.kind === 'file' && r.image && /^refs\/\d{14}-截图_1\.png$/.test(r.path) && fs.existsSync(path.join(dir, r.path)));
  await assert.rejects(attach(dir, 'x.exe', new Uint8Array([1])), /格式还不支持/);
});
