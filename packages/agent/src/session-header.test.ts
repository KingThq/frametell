import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createCatalog } from '@frametell/models';
import { piRuntime } from './runtime/pi.js';

test('every model request names the session that sent it', async () => {
  const seen: string[] = [];
  const server = http.createServer((req, res) => { seen.push(String(req.headers['x-frametell-session'])); res.writeHead(500).end('{"error":"test"}'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-session-'));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const catalog = await createCatalog({ keys: [{ providerId: 'custom-test', apiKey: 'k' }], custom: [{ id: 'custom-test', name: 'Test', protocol: 'openai', baseUrl: url, models: [{ id: 'm' }], discover: false }] });
    const model = catalog.get('custom-test', 'm');
    assert.ok(model);
    const session = await piRuntime(catalog.models, model).open({ name: 'page-p03', system: 's', cwd, maxTurns: 1 });
    await session.send({ text: 'hi' });
    assert.ok(seen.length >= 1);
    assert.ok(seen.every((s) => s === 'page-p03'), `got ${seen.join(',')}`);
  } finally { server.close(); fs.rmSync(cwd, { recursive: true, force: true }); }
});
