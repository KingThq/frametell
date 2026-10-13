import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withDefaults, type Config, type ConfigStore } from './config.js';
import { Studio } from './studio.js';
import type { NewProjectInput } from './types.js';

/** settings a host keeps itself (in memory here) instead of a config.json */
function memoryConfig(initial: Partial<Config> = {}): ConfigStore & { saved: Config[] } {
  let c = withDefaults(initial);
  const saved: Config[] = [];
  return { saved, load: () => structuredClone(c), save(next) { c = structuredClone(next); saved.push(next); } };
}

test('a Studio keeps its projects and settings where it is told', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-studio-'));
  try {
    const config = memoryConfig({ keys: { anthropic: 'sk-ant-0123456789abcdef' }, defaults: { style: 'chalkboard' } as Config['defaults'] });
    const studio = new Studio({ dataDir, config });
    assert.equal(studio.projectsDir, path.join(dataDir, 'projects'));
    assert.deepEqual(studio.projects(), []);
    // settings come from the host's store, masked as always, and changes go back to it, not to a file
    assert.equal(studio.settings().keys.anthropic, 'sk-ant-0…cdef');
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
    const one = new Studio({ dataDir: a, config: memoryConfig({ keys: { anthropic: 'sk-ant-aaaaaaaaaaaaaaaa' } }) });
    const two = new Studio({ dataDir: b, config: memoryConfig() });
    // a project made by hand in one Studio's data dir, the way Projects.create lays it out
    const dir = path.join(a, 'projects', '2026-10-11-abc123');
    fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id: '2026-10-11-abc123', title: 'A', style: 'whiteboard', durationSec: 60, model: 'anthropic/x', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
    assert.deepEqual(one.projects().map((p) => p.id), ['2026-10-11-abc123']);
    assert.deepEqual(two.projects(), []);
    assert.throws(() => two.project('2026-10-11-abc123'));
    assert.equal(two.settings().keys.anthropic, undefined);
  } finally { for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('a project can be deleted, but not while another process is making it, and only by its own id', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-delete-'));
  try {
    const studio = new Studio({ dataDir, config: memoryConfig() });
    const now = new Date().toISOString();
    const make = (id: string) => {
      const dir = path.join(dataDir, 'projects', id);
      fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id, title: id, style: 'whiteboard', durationSec: 60, model: 'anthropic/x', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
      return dir;
    };
    const kept = make('2026-10-12-keep'), gone = make('2026-10-12-gone');
    studio.deleteProject('2026-10-12-gone');
    assert.equal(fs.existsSync(gone), false);
    assert.deepEqual(studio.projects().map((p) => p.id), ['2026-10-12-keep']);
    assert.throws(() => studio.deleteProject('2026-10-12-gone'));
    assert.throws(() => studio.deleteProject('..'));
    // a run held by another live process (this test's parent stands in for it)
    fs.writeFileSync(path.join(kept, '.studio', 'run.lock'), String(process.ppid));
    assert.throws(() => studio.deleteProject('2026-10-12-keep'), /Stop it|先停下/);
    assert.equal(fs.existsSync(kept), true);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('after a restart, a run cut short is picked up again, a paused one is left alone', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-resume-'));
  try {
    const now = new Date().toISOString();
    const make = (id: string, ...after: object[]) => {
      const dir = path.join(dataDir, 'projects', id);
      fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id, title: id, style: 'whiteboard', durationSec: 60, model: 'nowhere/none', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
      fs.writeFileSync(path.join(dir, '.studio', 'state.json'), JSON.stringify({ stage: 'pages' }));
      fs.writeFileSync(path.join(dir, '.studio', 'events.jsonl'), [{ type: 'stage', stage: 'pages', status: 'start' }, ...after].map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: i + 1 })).join('\n') + '\n');
    };
    make('2026-10-12-cut000000001', { type: 'agent', session: 'page-p01', event: { type: 'text', text: '…' } });
    make('2026-10-12-paused0000001', { type: 'paused', reason: 'user', stage: 'pages' });
    // paused, with pages that wound down after it (seen on a deploy: such a film went on by itself)
    make('2026-10-12-paused0000002', { type: 'paused', reason: 'user', stage: 'pages' }, { type: 'page', id: 'p04', status: 'checking', round: 2, issues: [] });
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

test('a finished film exports even when the model it was made with is gone', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-export-'));
  try {
    // made with a provider this version no longer has: drawing more would need a model, exporting does not
    const id = '2026-10-12-export0000001', dir = path.join(dataDir, 'projects', id), now = new Date().toISOString();
    fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.studio', 'project.json'), JSON.stringify({ id, title: id, style: 'whiteboard', durationSec: 60, model: 'retired/gemini-3.7-flash-high', runtime: 'pi', subtitles: true, materials: [], createdAt: now, updatedAt: now }));
    fs.writeFileSync(path.join(dir, '.studio', 'state.json'), JSON.stringify({ stage: 'done' }));
    fs.writeFileSync(path.join(dir, 'script.js'), "const SCRIPT = {\n  META: { style: 'whiteboard', lang: 'zh' },\n  PAGES: [],\n};\n");
    let rendered = 0;
    const studio = new Studio({ dataDir, config: memoryConfig(), renderer: async () => { rendered++; throw new Error('rendered here'); } });
    const seen: { type: string; message?: string }[] = [];
    const off = studio.subscribe(id, 0, (e) => seen.push(e as never));
    assert.equal(studio.export(id), true);
    for (let i = 0; i < 50 && !seen.some((e) => e.type === 'error'); i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(rendered, 1);
    assert.deepEqual(seen.filter((e) => e.type === 'error').map((e) => e.message), ['rendered here']);
    assert.ok(!seen.some((e) => e.type === 'paused'));
    off();
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a new film keeps its style notes and look, the look checked', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-look-'));
  try {
    const studio = new Studio({ dataDir, config: memoryConfig({ defaults: { model: 'anthropic/x' } as Config['defaults'] }) });
    const p = studio.createProject({ topic: '鲲鹏', styleNotes: '  - 留白多一点  ', look: { palette: { red: '#a8301f', nope: 'x' } } }, []);
    studio.stop(p.id);
    const meta = JSON.parse(fs.readFileSync(path.join(studio.projectsDir, p.id, '.studio', 'project.json'), 'utf8'));
    assert.equal(meta.styleNotes, '- 留白多一点');
    assert.deepEqual(meta.look, { palette: { red: '#A8301F' } });
    await new Promise((r) => setTimeout(r, 50));   // the run createProject started ends before its folder goes
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a run asks for its settings with its own project; everything else asks without one', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-ctx-'));
  const asked: (string | undefined)[] = [];
  const base = withDefaults({ defaults: { model: 'anthropic/claude-opus-5-5' } as Config['defaults'] });
  const config: ConfigStore = { load: (ctx) => { asked.push(ctx?.project); return structuredClone(base); }, save() {} };
  try {
    const studio = new Studio({ dataDir, config });
    const p = studio.createProject({ topic: 'tides' } as NewProjectInput, []);
    // the run starts by itself and stops at once: there is no key for its model
    for (let i = 0; i < 200 && studio.project(p.id).status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(asked.includes(p.id), 'the run named its project');
    assert.ok(asked.includes(undefined), 'creating the project did not');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
