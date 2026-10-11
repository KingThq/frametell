import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskProxy } from './net.js';

test('the proxy password never reaches the panel', () => {
  assert.equal(maskProxy('http://me:secret@127.0.0.1:7890'), 'http://me:••••@127.0.0.1:7890');
  assert.equal(maskProxy('http://127.0.0.1:7890'), 'http://127.0.0.1:7890');
  assert.equal(maskProxy(undefined), '');
});

test('saving the masked proxy back keeps the saved password', async () => {
  const { patchConfig, loadConfig } = await import('./config.js');
  const c = { ...loadConfig(), proxy: 'http://me:secret@127.0.0.1:7890' };
  assert.equal(patchConfig(c, { proxy: 'http://me:••••@127.0.0.1:7891' }).proxy, 'http://me:secret@127.0.0.1:7891');
  assert.equal(patchConfig(c, { proxy: '' }).proxy, undefined);
  assert.throws(() => patchConfig(c, { proxy: 'socks5://127.0.0.1:1080' }), /http:\/\//);
});
