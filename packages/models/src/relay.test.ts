import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toModel } from './relay.js';

test('Claude and Gemini use the Anthropic protocol at the gateway root, GPT the Responses API under /v1', () => {
  const claude = toModel({ id: 'claude-opus-5-5', category: 'reasoning', pricing: { input_per_1m: 5, output_per_1m: 25, cached_per_1m: 1 } }, 'https://gw');
  assert.equal(claude?.api, 'anthropic-messages');
  assert.equal(claude?.baseUrl, 'https://gw');
  assert.deepEqual(claude?.cost, { input: 5, output: 25, cacheRead: 1, cacheWrite: 6.25 });
  const gemini = toModel({ id: 'gemini-3.7-flash-high', category: 'chat' }, 'https://gw');
  assert.equal(gemini?.api, 'anthropic-messages');
  const gpt = toModel({ id: 'gpt-5.5', category: 'reasoning' }, 'https://gw');
  assert.equal(gpt?.api, 'openai-responses');
  assert.equal(gpt?.baseUrl, 'https://gw/v1');
});

test('image models are left out of the chat catalog', () => {
  assert.equal(toModel({ id: 'gpt-image-2', category: 'image' }, 'https://gw'), null);
  assert.equal(toModel({ id: 'gpt-image-2-4k' }, 'https://gw'), null);
});
