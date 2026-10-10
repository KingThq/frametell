// The application core as one object. Every client capability is a method here; transports (HTTP + SSE in the CLI,
// IPC in the desktop app) only translate calls and stream events, so behaviour is identical everywhere.
import fs from 'node:fs';
import path from 'node:path';
import { createCatalog } from '@frametell/models';
import { listElevenLabsVoices, VOLCENGINE_VOICES } from '@frametell/voice';
import { STYLES } from '@frametell/agent';
import { loadConfig, patchConfig, publicConfig, saveConfig } from './config.js';
import { listProjects, newProject, projectDir, readMeta, runner } from './runner.js';
import { checkEnv } from './env.js';
import type { EnvCheck, LoggedEvent, ModelInfo, NewProjectInput, ProjectMeta, ProjectSummary, PublicSettings, SettingsPatch, StyleInfo, Voice } from './types.js';

export interface MaterialFile { name: string; data: Uint8Array }

export class Studio {
  // ── settings and environment ──
  settings(): PublicSettings { return publicConfig(loadConfig()); }
  updateSettings(patch: SettingsPatch): PublicSettings { const next = patchConfig(loadConfig(), patch); saveConfig(next); return publicConfig(next); }
  env(): EnvCheck[] { return checkEnv(); }
  styles(): StyleInfo[] { return STYLES; }

  async models(): Promise<{ models: ModelInfo[]; default?: ModelInfo }> {
    const cfg = loadConfig();
    const catalog = await createCatalog({ keys: Object.entries(cfg.keys).map(([providerId, apiKey]) => ({ providerId, apiKey })), custom: cfg.custom });
    return { models: await catalog.available(), default: await catalog.defaultModel() };
  }

  async voices(): Promise<{ voices: Voice[]; configured: { volcengine: boolean; elevenlabs: boolean } }> {
    const cfg = loadConfig();
    const voices: Voice[] = cfg.tts.volcengine ? [...VOLCENGINE_VOICES] : [];
    if (cfg.tts.elevenlabs) { try { voices.push(...(await listElevenLabsVoices(cfg.tts.elevenlabs))); } catch {} }
    return { voices, configured: { volcengine: !!cfg.tts.volcengine, elevenlabs: !!cfg.tts.elevenlabs } };
  }

  // ── projects ──
  projects(): ProjectSummary[] { return listProjects(); }
  project(id: string): ProjectSummary { return { ...readMeta(id), ...runner(id).summary() }; }

  /** create a project from materials and start it right away (it pauses at the storyboard for approval) */
  createProject(input: NewProjectInput, files: MaterialFile[]): ProjectMeta {
    const d = loadConfig().defaults;
    const model = input.model || d.model;
    if (!model) throw new Error('请先在设置里配置模型');
    const meta = newProject({
      title: input.title?.trim() || files[0]?.name.replace(/\.[^.]+$/, '') || '未命名视频',
      style: input.style || d.style, durationSec: input.durationSec || d.durationSec, model,
      runtime: input.runtime || d.runtime, voice: input.voice ?? d.voice, subtitles: input.subtitles ?? d.subtitles,
      topic: input.topic, notes: input.notes,
    }, files.map((f) => ({ name: f.name, data: Buffer.from(f.data) })));
    void runner(meta.id).start();
    return meta;
  }

  start(id: string) { return runner(id).start(); }
  approve(id: string, feedback?: string) { return runner(id).approve(feedback); }
  stop(id: string) { runner(id).stop(); }

  /** replay events after `since`, then stream live ones; returns the unsubscribe function */
  subscribe(id: string, since: number, fn: (e: LoggedEvent) => void): () => void { return runner(id).subscribe(fn, since); }

  /** absolute path of a file inside a project (preview player, snapshots, audio, video), or null */
  projectFile(id: string, rel: string): string | null {
    if (!/^[\w-]+$/.test(id)) return null;
    const root = projectDir(id);
    const abs = path.resolve(root, rel || 'index.html');
    const r = path.relative(root, abs);
    if (r.startsWith('..') || path.isAbsolute(r)) return null;
    try { return fs.statSync(abs).isFile() ? abs : null; } catch { return null; }
  }
}
