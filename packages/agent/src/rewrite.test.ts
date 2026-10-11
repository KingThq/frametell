import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rewriteRefusal } from './runtime/types.js';
import { fileTools } from './tools/files.js';

const long = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n');

test('an existing page is never rewritten whole; new pages and other files are written freely', () => {
  assert.match(rewriteRefusal('pages/p03.js', long)!, /用 edit/);
  assert.equal(rewriteRefusal('pages/p03.js', undefined), undefined);        // a new page
  assert.equal(rewriteRefusal('pages/p03.js', 'short\nfile'), undefined);    // a stub
  assert.equal(rewriteRefusal('script.js', long), undefined);
  assert.equal(rewriteRefusal('.studio/revision.json', long), undefined);
});

test('the write tool refuses, and edit still works', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-tools-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(dir, 'pages/p01.js'), long);
  const tools = Object.fromEntries(fileTools(dir).map((t) => [t.name, t]));
  await assert.rejects(tools.write.execute('1', { path: 'pages/p01.js', content: 'x' } as never), /用 edit/);
  await tools.edit.execute('2', { path: 'pages/p01.js', old_string: 'line 7\n', new_string: 'line seven\n' } as never);
  assert.match(fs.readFileSync(path.join(dir, 'pages/p01.js'), 'utf8'), /line seven/);
  await tools.write.execute('3', { path: 'pages/p02.js', content: 'new page' } as never);
});
