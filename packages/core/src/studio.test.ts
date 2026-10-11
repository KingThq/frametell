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
