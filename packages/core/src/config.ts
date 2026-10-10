// Local settings: providers and keys, narration, defaults. One JSON file in the data directory, readable only by the
// user (0600). Keys never leave this machine except in requests to the provider they belong to, and the API only
// ever returns them masked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CustomProviderConfig } from '@frametell/models';
import { maskProxy } from './net.js';
import type { PublicSettings, RuntimeId, SettingsPatch, VoiceChoice } from './types.js';

export const DATA_DIR = process.env.FRAMETELL_HOME || path.join(os.homedir(), '.frametell');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const FILE = path.join(DATA_DIR, 'config.json');


export interface Config {
  /** API keys by provider id: relay, anthropic, openai, google, openrouter, vercel-ai-gateway, volcengine-ark, … */
  keys: Record<string, string>;
  custom: CustomProviderConfig[];
  /** the user's own relay for a provider (anthropic, openai): an Anthropic- / OpenAI-compatible base URL */
  baseUrls: Record<string, string>;
  /** HTTP proxy for every outbound request, e.g. http://127.0.0.1:7890 */
  proxy?: string;
  tts: { volcengine?: string; elevenlabs?: string };
  defaults: {
    model?: string;          // "provider/model-id"
    runtime: RuntimeId;
    style: string;
    durationSec: number;
    voice?: VoiceChoice;
    subtitles: boolean;
    concurrency: number;
  };
}

const DEFAULTS: Config = {
  keys: {}, custom: [], baseUrls: {}, tts: {},
  defaults: { runtime: 'pi', style: 'warm-story', durationSec: 60, subtitles: true, concurrency: 3, voice: { provider: 'volcengine', id: 'zh_male_yuanboxiaoshu_uranus_bigtts', name: '渊博小叔' } },
};

export function loadConfig(): Config {
  try {
    const c = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<Config>;
    return { ...DEFAULTS, ...c, defaults: { ...DEFAULTS.defaults, ...(c.defaults || {}) }, tts: { ...(c.tts || {}) }, keys: { ...(c.keys || {}) }, baseUrls: { ...(c.baseUrls || {}) }, custom: c.custom || [] };
  } catch { return structuredClone(DEFAULTS); }
}

export function saveConfig(c: Config) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

/** sk-flash-5e45…8487 */
export const mask = (k?: string) => (!k ? '' : k.length <= 12 ? '••••' : `${k.slice(0, 8)}…${k.slice(-4)}`);

/** What the panel may see: keys reduced to masked hints. */
export function publicConfig(c: Config): PublicSettings {
  return {
    keys: Object.fromEntries(Object.entries(c.keys).filter(([, v]) => v).map(([k, v]) => [k, mask(v)])),
    custom: c.custom,
    baseUrls: c.baseUrls,
    proxy: maskProxy(c.proxy),
    tts: { volcengine: mask(c.tts.volcengine), elevenlabs: mask(c.tts.elevenlabs) },
    defaults: c.defaults,
  };
}

/** Apply a settings patch from the panel; empty-string keys remove a key, absent keys are left alone. */
export function patchConfig(c: Config, patch: SettingsPatch & { custom?: CustomProviderConfig[] }): Config {
  const next = structuredClone(c);
  for (const [k, v] of Object.entries(patch.keys || {})) { if (v) next.keys[k] = v.trim(); else delete next.keys[k]; }
  for (const [k, v] of Object.entries(patch.tts || {}) as [keyof Config['tts'], string][]) { if (v) next.tts[k] = v.trim(); else delete next.tts[k]; }
  for (const [k, v] of Object.entries(patch.baseUrls || {})) { if (v.trim()) next.baseUrls[k] = v.trim().replace(/\/+$/, ''); else delete next.baseUrls[k]; }
  if (patch.proxy !== undefined) {
    const p = patch.proxy.trim();
    if (p && !/^https?:\/\/[^/\s]+\/?$/.test(p)) throw new Error('代理地址要写成 http://主机:端口，例如 http://127.0.0.1:7890');
    // the panel only ever sees the password masked: an edit that kept the mask keeps the saved password
    const keep = (u: string) => { try { const n = new URL(u); if (n.password === encodeURIComponent('••••') && c.proxy) { n.password = new URL(c.proxy).password; return n.toString(); } } catch {} return u; };
    if (p) next.proxy = keep(p).replace(/\/$/, ''); else delete next.proxy;
  }
  for (const [k, v] of Object.entries(patch.baseUrls || {})) if (v.trim() && !/^https?:\/\//.test(v.trim())) throw new Error(`${k} 的请求地址要以 http:// 或 https:// 开头`);
  if (patch.custom) next.custom = patch.custom;
  if (patch.defaults) next.defaults = { ...next.defaults, ...patch.defaults };
  return next;
}
