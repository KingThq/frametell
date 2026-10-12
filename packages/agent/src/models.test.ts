import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import type { AgentRuntime, SessionOptions } from './runtime/types.js';

/** a runtime that answers nothing: opening a session takes one turn of `tokens` input tokens */
const fake = (id: string, opened: string[], tokens = 1e6): AgentRuntime => ({
  id: 'pi', model: { provider: 'x', id },
  async open(o: SessionOptions) {
    opened.push(`${id}:${o.name}`);
    o.onEvent?.({ type: 'turn', usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0 } } as never);
    return { ref: '', send: async () => ({}) as never, close: async () => {} } as never;
  },
});

test('the pages and the film check run on the page model, each turn priced at its own model', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-models-'));
  const opened: string[] = [];
  const d = new Director({
    dir, style: 'chalkboard', brief: { durationSec: 60 },
    runtime: fake('opus', opened), prices: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, currency: 'USD' },
    pages: { runtime: fake('flash', opened), prices: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0.3, currency: 'USD' } },
  });
  const open = (name: string) => (d as unknown as { session(n: string, s: string, t: number): Promise<unknown> }).session(name, '', 1);
  for (const name of ['planner', 'page-p01', 'page-p02', 'review', 'reviser']) await open(name);
  assert.deepEqual(opened, ['opus:planner', 'flash:page-p01', 'flash:page-p02', 'flash:review', 'opus:reviser']);
  // 2M tokens on Opus at $5, 3M on Flash at $0.3
  assert.equal(d.cost().amount.toFixed(2), (10 + 0.9).toFixed(2));
});

test('without a page model, every session runs on the director’s', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-models-'));
  const opened: string[] = [];
  const d = new Director({ dir, style: 'chalkboard', brief: { durationSec: 60 }, runtime: fake('one', opened), prices: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, currency: 'CNY' } });
  await (d as unknown as { session(n: string, s: string, t: number): Promise<unknown> }).session('page-p01', '', 1);
  assert.deepEqual(opened, ['one:page-p01']);
  assert.deepEqual(d.cost(), { amount: 1, currency: 'CNY' });
});
