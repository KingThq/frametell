// The application core as one object. Every client capability is a method here; transports (HTTP + SSE in the CLI,
// IPC in the desktop app) only translate calls and stream events, so behaviour is identical everywhere.
import fs from 'node:fs';
import path from 'node:path';
import { createCatalog } from '@frametell/models';
import { bundledSample, elevenLabsTts, listElevenLabsVoices, volcengineTts, VOLCENGINE_VOICES } from '@frametell/voice';
import { Project, STYLES, type Timeline } from '@frametell/agent';
import { DATA_DIR, loadConfig, patchConfig, publicConfig, saveConfig } from './config.js';
import { listProjects, newProject, projectDir, readMeta, runner } from './runner.js';
import { checkEnv } from './env.js';
import { applyProxy } from './net.js';
import type { EnvCheck, LoggedEvent, ModelInfo, NewProjectInput, ProjectMeta, ProjectSummary, PublicSettings, SettingsPatch, StyleInfo, Voice } from './types.js';

export interface MaterialFile { name: string; data: Uint8Array }

export class Studio {
  constructor() { applyProxy(loadConfig().proxy); }

  // ── settings and environment ──
  settings(): PublicSettings { return publicConfig(loadConfig()); }
  updateSettings(patch: SettingsPatch): PublicSettings {
    const next = patchConfig(loadConfig(), patch);
    saveConfig(next);
    applyProxy(next.proxy);
    return publicConfig(next);
  }
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

  /**
   * A short sample of a narrator: the one shipped with Studio for a built-in voice (free), else synthesized once with
   * the user's key and kept on this machine (the same sentence for every voice, so they compare fairly). Returns the
   * mp3 path; ElevenLabs voices also carry a hosted previewUrl.
   */
  async voicePreview(provider: 'volcengine' | 'elevenlabs', id: string): Promise<string> {
    if (!/^[\w.-]+$/.test(id)) throw new Error('音色 id 不合法');
    const shipped = provider === 'volcengine' ? bundledSample(id) : undefined;
    if (shipped) return shipped;
    const dir = path.join(DATA_DIR, 'voice-previews');
    const file = path.join(dir, `${provider}-${id}.mp3`);
    if (fs.existsSync(file)) return file;
    const cfg = loadConfig();
    const key = provider === 'elevenlabs' ? cfg.tts.elevenlabs : cfg.tts.volcengine;
    if (!key) throw new Error('先在设置里连接配音服务');
    const tts = provider === 'elevenlabs' ? elevenLabsTts(key) : volcengineTts(key);
    const text = provider === 'elevenlabs' ? 'Hi, I will narrate your video, one clear idea at a time.' : '你好，我来给你的视频配音。我们一句一句，把道理讲清楚。';
    const { audio } = await tts.synth(text, { voice: id, instruction: '像跟朋友分享一个实用的发现，语气轻松、真诚、自然' });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, audio);
    return file;
  }

  // ── projects ──
  projects(): ProjectSummary[] { return listProjects(); }
  project(id: string): ProjectSummary { return { ...readMeta(id), ...runner(id).summary() }; }

  /** create a project from materials and start it right away (it pauses at the storyboard for approval) */
  createProject(input: NewProjectInput, files: MaterialFile[]): ProjectMeta {
    const d = loadConfig().defaults;
    const model = input.model || d.model;
    if (!model) throw new Error('请先在设置里配置模型');
    const said = input.notes?.trim();
    if (!files.length && !said && !input.topic) throw new Error('说一句想讲什么，或者附上资料');
    // without materials, the sentence the user wrote is the topic; it also names the project
    const topic = input.topic || (files.length ? undefined : said);
    const fromText = (t?: string) => t?.replace(/^(讲讲|讲一讲|介绍一下|介绍|聊聊|说说|帮我做一条|做一条)/, '').replace(/[。！？!?，,].*$/, '').trim().slice(0, 24) || undefined;
    const meta = newProject({
      title: input.title?.trim() || fromText(topic) || fromText(said) || files[0]?.name.replace(/\.[^.]+$/, '') || '未命名视频',
      style: input.style || d.style, durationSec: input.durationSec || d.durationSec, model,
      runtime: input.runtime || d.runtime, voice: input.voice ?? d.voice, subtitles: input.subtitles ?? d.subtitles,
      topic, notes: topic ? undefined : input.notes,
    }, files.map((f) => ({ name: f.name, data: Buffer.from(f.data) })));
    void runner(meta.id).start();
    return meta;
  }

  /**
   * Pages with their narration lines and times (from script.js + voice.js), for the page canvas; null until the script
   * exists. Cached on the two files' mtimes, since computing it loads the engine.
   */
  timeline(id: string): Timeline | null {
    const dir = projectDir(id);
    const film = (() => { try { return fs.readdirSync(path.join(dir, 'out')).find((f) => f.endsWith('-无字幕.mp4')); } catch { return undefined; } })();
    const stamp = ['script.js', 'voice.js', film ? `out/${film}` : ''].map((f) => { try { return f ? fs.statSync(path.join(dir, f)).mtimeMs : 0; } catch { return 0; } }).join('|');
    if (stamp.startsWith('0|')) return null;
    const hit = this.timelines.get(id);
    if (hit?.stamp === stamp) return hit.value;
    let value: Timeline | null = null;
    try {
      const project = new Project(dir);
      value = project.timeline();
      if (film) value.posters = project.posters(path.join(dir, 'out', film), value.pages);
    } catch { value = null; }
    this.timelines.set(id, { stamp, value });
    return value;
  }
  private timelines = new Map<string, { stamp: string; value: Timeline | null }>();

  /** a full-resolution frame of the finished film (the no-subtitle cut) at `t` seconds: a project-relative path */
  async frame(id: string, t: number): Promise<string | null> {
    const dir = projectDir(id);
    const film = (() => { try { return fs.readdirSync(path.join(dir, 'out')).find((f) => f.endsWith('-无字幕.mp4')); } catch { return undefined; } })();
    if (!film || !Number.isFinite(t) || t < 0) return null;
    return new Project(dir).still(path.join(dir, 'out', film), t);
  }

  start(id: string) { return runner(id).start(); }
  approve(id: string, feedback?: string) { return runner(id).approve(feedback); }
  stop(id: string) { runner(id).stop(); }
  /** talk to the director: storyboard feedback, a note mid-run, or a change to the finished film */
  say(id: string, text: string) { return runner(id).say(text); }

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
