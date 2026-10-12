import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withDefaults, type Config, type ConfigStore } from './config.js';
import { Studio } from './studio.js';

/** settings a host keeps itself (in memory here) instead of a config.json */
function memoryConfig(initial: Partial<Config> = {}): ConfigStore & { saved: Config[] } {
  let c = withDefaults(initial);
  const saved: Config[] = [];
  return { saved, load: () => structuredClone(c), save(next) { c = structuredClone(next); saved.push(next); } };
}

test('a Studio keeps its projects and settings where it is told', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-studio-'));
  try {
    const config = memoryConfig({ keys: { relay: 'sk-flash-0123456789abcdef' }, defaults: { style: 'chalkboard' } as Config['defaults'] });
    const studio = new Studio({ dataDir, config });
    assert.equal(studio.projectsDir, path.join(dataDir, 'projects'));
    assert.deepEqual(studio.projects(), []);
    // settings come from the host's store, masked as always, and changes go back to it, not to a file
    assert.equal(studio.settings().keys.relay, 'sk-flash…cdef');
    assert.equal(studio.settings().defaults.style, 'chalkboard');
    studio.updateSettings({ defaults: { durationSec: 90 } as Config['defaults'] });
    assert.equal(config.saved.at(-1)?.defaults.durationSec, 90);
    assert.equal(fs.existsSync(path.join(dataDir, 'config.json')), false);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('two Studios in one process do not see each other', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-b-'));
  try {
    const one = new Studio({ dataDir: a, config: memoryConfig({ keys: { relay: 'sk-flash-aaaaaaaaaaaaaaaa' } }) });
    const two = new Studio({ dataDir: b, config: memoryConfig() });
    // a project made by hand in one Studio's data dir, the way Projects.create lays it out
    const dir = path.join(a, 'projects', '2026-10-11-abc123');
    fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id: '2026-10-11-abc123', title: 'A', style: 'whiteboard', durationSec: 60, model: 'relay/x', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
    assert.deepEqual(one.projects().map((p) => p.id), ['2026-10-11-abc123']);
    assert.deepEqual(two.projects(), []);
    assert.throws(() => two.project('2026-10-11-abc123'));
    assert.equal(two.settings().keys.relay, undefined);
  } finally { for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('after a restart, a run cut short is picked up again, a paused one is left alone', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-resume-'));
  try {
    const now = new Date().toISOString();
    const make = (id: string, last: object) => {
      const dir = path.join(dataDir, 'projects', id);
      fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id, title: id, style: 'whiteboard', durationSec: 60, model: 'nowhere/none', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
      fs.writeFileSync(path.join(dir, '.studio', 'state.json'), JSON.stringify({ stage: 'pages' }));
      fs.writeFileSync(path.join(dir, '.studio', 'events.jsonl'), [{ type: 'stage', stage: 'pages', status: 'start', seq: 1, at: 1 }, { ...last, seq: 2, at: 2 }].map((e) => JSON.stringify(e)).join('\n') + '\n');
    };
    make('2026-10-12-cut000000001', { type: 'agent', session: 'page-p01', event: { type: 'text', text: '…' } });
    make('2026-10-12-paused0000001', { type: 'paused', reason: 'user', stage: 'pages' });
    const studio = new Studio({ dataDir, config: memoryConfig() });
    assert.deepEqual(studio.resumeInterrupted(), ['2026-10-12-cut000000001']);
    // it tried to continue (and, with no model here, stopped with an error rather than staying silently paused)
    await new Promise((r) => setTimeout(r, 200));
    const log = fs.readFileSync(path.join(dataDir, 'projects', '2026-10-12-cut000000001', '.studio', 'events.jsonl'), 'utf8');
    assert.match(log, /"reason":"interrupted"/);
    assert.match(log, /"type":"error"/);
    assert.deepEqual(studio.resumeInterrupted(), []);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('continuing a paused film says so at once, before the director is ready', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-continue-'));
  try {
    const id = '2026-10-12-paused0000002', dir = path.join(dataDir, 'projects', id), now = new Date().toISOString();
    fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id, title: id, style: 'whiteboard', durationSec: 60, model: 'nowhere/none', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
    fs.writeFileSync(path.join(dir, '.studio', 'state.json'), JSON.stringify({ stage: 'pages' }));
    fs.writeFileSync(path.join(dir, '.studio', 'events.jsonl'), JSON.stringify({ type: 'paused', reason: 'error', stage: 'pages', seq: 1, at: 1 }) + '\n');
    const studio = new Studio({ dataDir, config: memoryConfig() });
    const seen: string[] = [];
    const off = studio.subscribe(id, 1, (e) => seen.push(e.type));
    const started = studio.start(id);
    // before anything slow (materials, the model catalog): every client can stop showing it paused
    assert.deepEqual(seen, ['resumed']);
    await started;
    // with no model here it stops again, with the reason
    assert.deepEqual(seen, ['resumed', 'error', 'paused']);
    off();
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('an ElevenLabs voice list is fetched once per key and shared, and a failed fetch is tried again', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-studio-'));
  const real = globalThis.fetch;
  let calls = 0, fail = true;
  globalThis.fetch = (async () => {
    calls++;
    if (fail) return new Response(JSON.stringify({ detail: { status: 'invalid_api_key' } }), { status: 401 });
    return new Response(JSON.stringify({ voices: [{ voice_id: 'v1', name: 'Sarah' }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const a = new Studio({ dataDir, config: memoryConfig({ tts: { elevenlabs: 'sk_cache_test_key' } }) });
    const b = new Studio({ dataDir, config: memoryConfig({ tts: { elevenlabs: 'sk_cache_test_key' } }) });
    assert.equal((await a.voices()).problems?.elevenlabs?.problem, 'key');
    fail = false;
    const [x, y] = await Promise.all([a.voices(), b.voices()]);   // the failure was not kept; the two share one fetch
    assert.equal(calls, 2);
    assert.ok(x.voices.some((v) => v.id === 'v1') && y.voices.some((v) => v.id === 'v1'));
    await a.voices();
    assert.equal(calls, 2);
  } finally { globalThis.fetch = real; fs.rmSync(dataDir, { recursive: true, force: true }); }
});
