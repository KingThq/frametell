// Text-to-speech providers. Each returns the audio (mp3) and per-word timestamps (Chinese: one entry per character),
// which narrate() uses to cut a page-long utterance back into cues and to place words on the timeline.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export interface WordTime { word: string; startTime: number; endTime: number }
export interface SynthResult { audio: Buffer; words: WordTime[] }

export interface SynthOptions {
  voice: string;
  /** -50..100 (Volcengine speech_rate); ElevenLabs maps it onto speed */
  rate?: number;
  /** a tone instruction in the voice's language, e.g. relaxed and sincere, like sharing a find with a friend (Volcengine only) */
  instruction?: string;
  pitch?: number;
  signal?: AbortSignal;
}

export interface TtsProvider {
  readonly id: 'volcengine' | 'elevenlabs';
  synth(text: string, opts: SynthOptions): Promise<SynthResult>;
}

async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if ((e as Error).name === 'AbortError' || e instanceof Mismatch) break; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
}

/** The voice is not one this resource serves (or not one the account has): the next resource may serve it. */
class Mismatch extends Error {}

/**
 * The resources a Volcengine voice may belong to, the likeliest first: TTS 2.0 presets (…_uranus_bigtts), TTS 1.0
 * presets (…_moon_bigtts, …_mars_bigtts and the rest of the 1.0 library), cloned voices (S_…). A voice sent to the
 * wrong one fails with a mismatch, which is also all an unknown id gets.
 */
export function volcengineResources(voice: string): string[] {
  if (voice.startsWith('S_')) return ['seed-icl-2.0', 'seed-icl-1.0'];
  if (/_uranus_/.test(voice)) return ['seed-tts-2.0', 'seed-tts-1.0'];
  if (/_(moon|mars|saturn)_|_bigtts$/.test(voice)) return ['seed-tts-1.0', 'seed-tts-2.0'];
  return ['seed-tts-2.0', 'seed-tts-1.0', 'seed-icl-2.0', 'seed-icl-1.0'];
}
/** voice → the resource that served it, so a whole film asks once */
const resolved = new Map<string, string>();

/**
 * Volcengine TTS (v3 unidirectional HTTP): preset voices of TTS 2.0 and 1.0, and cloned voices (S_…). The key is the
 * new console's API key, or an older app's credentials written "AppID:Access Token".
 */
export function volcengineTts(apiKey: string): TtsProvider {
  const app = /^(\d+):(\S+)$/.exec(apiKey.trim());
  const auth: Record<string, string> = app ? { 'X-Api-App-Id': app[1], 'X-Api-Access-Key': app[2] } : { 'X-Api-Key': apiKey };
  const once = async (text: string, o: SynthOptions, resource: string): Promise<SynthResult> => {
    const req: Record<string, unknown> = { text, speaker: o.voice, audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: o.rate ?? 0, enable_subtitle: true, enable_timestamp: true } };   // timestamps: 2.0 reads the first, 1.0 the second
    if (o.pitch != null) req.additions = JSON.stringify({ post_process: { pitch: o.pitch } });   // semitones; only honoured inside additions
    if (o.instruction) req.context_texts = [o.instruction];                                        // must be top-level
    const res = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth, 'X-Api-Resource-Id': resource, 'X-Api-Request-Id': crypto.randomUUID() },
      body: JSON.stringify({ req_params: req }),
      signal: o.signal ?? AbortSignal.timeout(90_000),
    });
    const raw = await res.text(), chunks: Buffer[] = [], words: WordTime[] = [];
    let err: string | null = null;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let f;
      try { f = JSON.parse(line); } catch { err = line.slice(0, 200); continue; }
      if (f.data) chunks.push(Buffer.from(f.data, 'base64'));
      if (f.sentence?.words) words.push(...f.sentence.words);
      if (f.code && f.code !== 20000000) err = `code=${f.code} ${f.message ?? ''}`;
    }
    if (err && /mismatch/i.test(err)) throw new Mismatch(err);
    if (res.status !== 200 || err || !chunks.length || !words.length) throw new Error(`Volcengine TTS ${res.status} ${err ?? 'returned no audio'}`);
    return { audio: Buffer.concat(chunks), words };
  };
  return {
    id: 'volcengine',
    async synth(text, o) {
      const known = resolved.get(o.voice);
      if (known) return retry(() => once(text, o, known));
      let last: unknown;
      for (const r of volcengineResources(o.voice)) {
        try { const out = await retry(() => once(text, o, r)); resolved.set(o.voice, r); return out; }
        catch (e) { last = e; if (!(e instanceof Mismatch)) throw e; }
      }
      throw new VoiceNotFound(o.voice, (last as Error).message);
    },
  };
}

/** no Volcengine resource serves this voice for this key: a wrong id, or a voice the account has not enabled */
export class VoiceNotFound extends Error {
  constructor(readonly voice: string, detail: string) { super(`Volcengine voice ${voice} not found for this key (${detail})`); this.name = 'VoiceNotFound'; }
}

/** ElevenLabs text-to-speech with character-level timestamps. */
export function elevenLabsTts(apiKey: string, model = 'eleven_multilingual_v2'): TtsProvider {
  return {
    id: 'elevenlabs',
    synth: (text, o) => retry(async () => {
      const speed = Math.min(1.2, Math.max(0.7, 1 + (o.rate ?? 0) / 100));
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(o.voice)}/with-timestamps?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
        body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed } }),
        signal: o.signal ?? AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status} ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as { audio_base64: string; alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } };
      const a = j.alignment;
      if (!a) throw new Error('ElevenLabs returned no timestamps');
      const words = a.characters.map((ch, i) => ({ word: ch, startTime: a.character_start_times_seconds[i], endTime: a.character_end_times_seconds[i] }));
      return { audio: Buffer.from(j.audio_base64, 'base64'), words };
    }),
  };
}

export interface Voice { provider: TtsProvider['id']; id: string; name: string; gender?: 'female' | 'male'; lang?: string; /** a hosted sample (ElevenLabs) */ previewUrl?: string; /** added by the user by its id (「我的音色」) */ mine?: boolean }

/**
 * Volcengine preset narrators (TTS 2.0), chosen for explainers: the four flagship voices, then narrators and
 * presenters. Earlier presets that left the list (甜美小源, 温暖阿虎, 爽快思思) still speak, and still have samples, for
 * the films that use them.
 */
export const VOLCENGINE_VOICES: Voice[] = [
  { provider: 'volcengine', id: 'zh_male_yuanboxiaoshu_uranus_bigtts', name: '渊博小叔', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_vv_uranus_bigtts', name: 'Vivi', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_m191_uranus_bigtts', name: '云舟', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_xiaohe_uranus_bigtts', name: '小何', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_taocheng_uranus_bigtts', name: '小天', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_cancan_uranus_bigtts', name: '知性灿灿', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_cixingjieshuonan_uranus_bigtts', name: '磁性解说男声', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_zhixingnv_uranus_bigtts', name: '知性女声', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_jieshuoxiaoming_uranus_bigtts', name: '解说小明', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_liuchangnv_uranus_bigtts', name: '流畅女声', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_ruyayichen_uranus_bigtts', name: '儒雅逸辰', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_qinqienv_uranus_bigtts', name: '亲切女声', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_dongfanghaoran_uranus_bigtts', name: '东方浩然', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_yingyujiaoxue_uranus_bigtts', name: 'Tina 老师', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_shenyeboke_uranus_bigtts', name: '深夜播客', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_wenroushunv_uranus_bigtts', name: '温柔淑女', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_xuanyijieshuo_uranus_bigtts', name: '悬疑解说', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_yangguangqingnian_uranus_bigtts', name: '阳光青年', gender: 'male', lang: 'zh' },
];

/**
 * The preview of a built-in Volcengine voice, generated once and shipped with Studio (samples/<id>.mp3), so listening
 * to a voice never spends the user's TTS credit. ElevenLabs voices carry their own hosted previewUrl.
 */
export function bundledSample(id: string): string | undefined {
  if (!/^[\w.-]+$/.test(id)) return undefined;
  // found through the package itself, so it still resolves when the code is bundled (the desktop app)
  const f = path.join(path.dirname(createRequire(import.meta.url).resolve('@frametell/voice/package.json')), 'samples', `${id}.mp3`);
  return fs.existsSync(f) ? f : undefined;
}

/** The user's ElevenLabs voices (their library includes the premade ones). */
export async function listElevenLabsVoices(apiKey: string): Promise<Voice[]> {
  const res = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100', { headers: { 'xi-api-key': apiKey } });
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}`);
  const j = (await res.json()) as { voices: { voice_id: string; name: string; labels?: { gender?: string }; preview_url?: string }[] };
  return j.voices.map((v) => ({ provider: 'elevenlabs', id: v.voice_id, name: v.name, previewUrl: v.preview_url, gender: v.labels?.gender === 'female' ? 'female' : v.labels?.gender === 'male' ? 'male' : undefined }));
}
