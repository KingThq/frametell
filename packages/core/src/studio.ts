// The application core as one object. Every client capability is a method here; transports (HTTP + SSE in the CLI,
// IPC in the desktop app) only translate calls and stream events, so behaviour is identical everywhere.
import fs from 'node:fs';
import path from 'node:path';
import { createCatalog, PROVIDERS, type ProviderSpec } from '@frametell/models';
import { bundledSample, elevenLabsTts, listElevenLabsVoices, volcengineTts, VOLCENGINE_VOICES } from '@frametell/voice';
import { Project, STYLES, type Renderer, type Timeline } from '@frametell/agent';
import { linkProject } from '@frametell/engine/tools/project.mjs';
import { DATA_DIR, configFile, patchConfig, publicConfig, type ConfigStore } from './config.js';
import { Projects } from './runner.js';
import { checkEnv } from './env.js';
import { applyProxy } from './net.js';
import { attach, cleanRefs } from './refs.js';
import type { UserRef, EnvCheck, LoggedEvent, ModelInfo, NewProjectInput, ProjectMeta, ProjectSummary, PublicSettings, SettingsPatch, StyleInfo, Voice } from './types.js';
import { resolveLocale, tr } from './i18n.js';

export interface MaterialFile { name: string; data: Uint8Array }

export interface StudioOptions {
  /** where projects (<dataDir>/projects) and voice samples live; by default ~/.frametell, or FRAMETELL_HOME */
  dataDir?: string;
  /**
   * where settings come from; by default <dataDir>/config.json. A host serving several people from one process gives
   * each Studio its own. The proxy setting is the exception: it applies to the whole process.
   */
  config?: ConfigStore;
  /** where exports are drawn (a hosted service's render containers); this process when absent */
  renderer?: Renderer;
}

export class Studio {
  readonly dataDir: string;
  private config: ConfigStore;
  private store: Projects;

  constructor(o: StudioOptions = {}) {
    this.dataDir = o.dataDir ?? DATA_DIR;
    this.config = o.config ?? configFile(this.dataDir);
    this.store = new Projects(path.join(this.dataDir, 'projects'), this.config, o.renderer);
    applyProxy(this.config.load().proxy);
    // every project reaches the engine through links; point them at this install (it may have moved, or been renamed)
    try { for (const id of fs.readdirSync(this.store.root)) { try { linkProject(this.store.dir(id)); } catch {} } } catch {}
  }

  /** the directory holding this Studio's projects */
  get projectsDir() { return this.store.root; }

  // ── settings and environment ──
  settings(): PublicSettings { return publicConfig(this.config.load()); }
  updateSettings(patch: SettingsPatch): PublicSettings {
    const next = patchConfig(this.config.load(), patch);
    this.config.save(next);
    applyProxy(next.proxy);
    return publicConfig(next);
  }
  env(): EnvCheck[] { return checkEnv(); }
  styles(): StyleInfo[] { return STYLES; }

  /** the providers Studio offers, in the order it shows them (the user's own endpoints come from settings) */
  providers(): ProviderSpec[] { return PROVIDERS; }

  async models(): Promise<{ models: ModelInfo[]; default?: ModelInfo }> {
    const cfg = this.config.load();
    const catalog = await createCatalog({ keys: Object.entries(cfg.keys).map(([providerId, apiKey]) => ({ providerId, apiKey })), custom: cfg.custom, baseUrls: cfg.baseUrls, models: cfg.models });
    return { models: await catalog.available(), default: await catalog.defaultModel() };
  }

  async voices(): Promise<{ voices: Voice[]; configured: { volcengine: boolean; elevenlabs: boolean } }> {
    const cfg = this.config.load();
    // the built-in voices are listed without a key: their samples ship with Studio, so they can be heard before connecting
    const voices: Voice[] = [...VOLCENGINE_VOICES];
    if (cfg.tts.elevenlabs) { try { voices.push(...(await listElevenLabsVoices(cfg.tts.elevenlabs))); } catch {} }
    return { voices, configured: { volcengine: !!cfg.tts.volcengine, elevenlabs: !!cfg.tts.elevenlabs } };
  }

  /**
   * A short sample of a narrator: the one shipped with Studio for a built-in voice (free), else synthesized once with
   * the user's key and kept on this machine (the same sentence for every voice, so they compare fairly). Returns the
   * mp3 path; ElevenLabs voices also carry a hosted previewUrl.
   */
  async voicePreview(provider: 'volcengine' | 'elevenlabs', id: string): Promise<string> {
    if (!/^[\w.-]+$/.test(id)) throw new Error(tr('音色 id 不合法', 'Invalid voice id'));
    const shipped = provider === 'volcengine' ? bundledSample(id) : undefined;
    if (shipped) return shipped;
    const dir = path.join(this.dataDir, 'voice-previews');
    const file = path.join(dir, `${provider}-${id}.mp3`);
    if (fs.existsSync(file)) return file;
    const cfg = this.config.load();
    const key = provider === 'elevenlabs' ? cfg.tts.elevenlabs : cfg.tts.volcengine;
    if (!key) throw new Error(tr('先在设置里连接配音服务', 'Connect a voice service in Settings first'));
    const tts = provider === 'elevenlabs' ? elevenLabsTts(key) : volcengineTts(key);
    const text = provider === 'elevenlabs' ? 'Hi, I will narrate your video, one clear idea at a time.' : '你好，我来给你的视频配音。我们一句一句，把道理讲清楚。';
    const { audio } = await tts.synth(text, { voice: id, instruction: '像跟朋友分享一个实用的发现，语气轻松、真诚、自然' });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, audio);
    return file;
  }

  // ── projects ──
  projects(): ProjectSummary[] { return this.store.list(); }
  project(id: string): ProjectSummary { return { ...this.store.read(id), ...this.store.runner(id).summary() }; }

  /** create a project from materials and start it right away (it pauses at the storyboard for approval) */
  createProject(input: NewProjectInput, files: MaterialFile[]): ProjectMeta {
    const cfg = this.config.load(), d = cfg.defaults;
    const model = input.model || d.model;
    if (!model) throw new Error(tr('请先在设置里配置模型', 'Set up a model in Settings first'));
    const said = input.notes?.trim();
    if (!files.length && !said && !input.topic) throw new Error(tr('说一句想讲什么，或者附上资料', 'Say what the video is about, or attach some material'));
    // without materials, the sentence the user wrote is the topic; it also names the project
    const topic = input.topic || (files.length ? undefined : said);
    const fromText = (t?: string) => {
      const s = t?.replace(/^(讲讲|讲一讲|介绍一下|介绍|聊聊|说说|帮我做一条|做一条|(?:please )?(?:explain|tell me about|talk about|make a video about|a video about)\s+)/i, '').trim();
      if (!s) return undefined;
      if (/[㐀-鿿]/.test(s)) return s.replace(/[。！？!?，,].*$/, '').trim().slice(0, 24) || undefined;
      // English: the first clause, at most 40 characters, cut between words, capitalised
      let e = s.replace(/[.!?;:,].*$/, '').trim();
      if (e.length > 40) e = e.slice(0, 40).replace(/\s+\S*$/, '');
      return e ? e[0].toUpperCase() + e.slice(1) : undefined;
    };
    const meta = this.store.create({
      title: input.title?.trim() || fromText(topic) || fromText(said) || files[0]?.name.replace(/\.[^.]+$/, '') || tr('未命名视频', 'Untitled video'),
      style: input.style || d.style, durationSec: input.durationSec || d.durationSec, model,
      runtime: input.runtime || d.runtime, voice: input.voice === null ? undefined : input.voice ?? d.voice, subtitles: input.subtitles ?? d.subtitles,
      lang: input.lang ?? resolveLocale(cfg.locale), topic, notes: topic ? undefined : input.notes,
    }, files.map((f) => ({ name: f.name, data: Buffer.from(f.data) })));
    void this.store.runner(meta.id).start();
    return meta;
  }

  /**
   * Pages with their narration lines and times (from script.js + voice.js), for the page canvas; null until the script
   * exists. Cached on the two files' mtimes, since computing it loads the engine.
   */
  async timeline(id: string): Promise<Timeline | null> {
    const dir = this.store.dir(id);
    const film = (() => { try { return fs.readdirSync(path.join(dir, 'out')).find((f) => /-(无字幕|no-subtitles)\.mp4$/.test(f)); } catch { return undefined; } })();
    const stamp = ['script.js', 'voice.js', film ? `out/${film}` : ''].map((f) => { try { return f ? fs.statSync(path.join(dir, f)).mtimeMs : 0; } catch { return 0; } }).join('|');
    if (stamp.startsWith('0|')) return null;
    const hit = this.timelines.get(id);
    if (hit?.stamp === stamp) return hit.value;
    let value: Timeline | null = null;
    try {
      const project = new Project(dir);
      value = await project.timeline();
      if (film) value.posters = await project.posters(path.join(dir, 'out', film), value.pages);
    } catch { value = null; }
    this.timelines.set(id, { stamp, value });
    return value;
  }
  private timelines = new Map<string, { stamp: string; value: Timeline | null }>();

  /** full-resolution frames of the film at `times` (project-relative): from the mp4 when it is current, else live */
  async frames(id: string, times: number[]): Promise<string[]> {
    const dir = this.store.dir(id);
    const ts = times.filter((t) => Number.isFinite(t) && t >= 0).slice(0, 40);
    if (!ts.length) return [];
    let st: { video?: string; exported?: boolean } = {};
    try { st = JSON.parse(fs.readFileSync(path.join(dir, '.studio', 'state.json'), 'utf8')); } catch {}
    const cut = st.video && st.exported !== false ? st.video.replace(/-有字幕\.mp4$/, '-无字幕.mp4').replace(/-with-subtitles\.mp4$/, '-no-subtitles.mp4') : undefined;
    return new Project(dir).stills(ts, cut && fs.existsSync(cut) ? cut : undefined);
  }

  start(id: string) { return this.store.runner(id).start(); }
  /** render the finished film to mp4; false when something is running or the film isn't finished */
  export(id: string) { return this.store.runner(id).export(); }
  approve(id: string, feedback?: string) { return this.store.runner(id).approve(feedback); }
  stop(id: string) { this.store.runner(id).stop(); }
  /** talk to the director: storyboard feedback, a note mid-run, or a change to the finished film */
  say(id: string, text: string, refs?: unknown) { return this.store.runner(id).say(text, cleanRefs(refs)); }
  /** save a file the user attached to a message; returns the reference to send with it */
  attach(id: string, name: string, data: Uint8Array): Promise<UserRef> { const meta = this.store.read(id); return attach(this.store.dir(id), name, data, meta.lang ?? 'zh'); }

  /** replay events after `since`, then stream live ones; returns the unsubscribe function */
  subscribe(id: string, since: number, fn: (e: LoggedEvent) => void): () => void { return this.store.runner(id).subscribe(fn, since); }

  /** absolute path of a file inside a project (preview player, snapshots, audio, video), or null */
  projectFile(id: string, rel: string): string | null {
    if (!/^[\w-]+$/.test(id)) return null;
    const root = this.store.dir(id);
    const abs = path.resolve(root, rel || 'index.html');
    const r = path.relative(root, abs);
    if (r.startsWith('..') || path.isAbsolute(r)) return null;
    try { return fs.statSync(abs).isFile() ? abs : null; } catch { return null; }
  }
}
