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
    try { return await fn(); } catch (e) { last = e; if ((e as Error).name === 'AbortError') break; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
}

/** Volcengine TTS 2.0 (v3 unidirectional HTTP). Preset voices use seed-tts-2.0; cloned voices (S_…) seed-icl-2.0. */
export function volcengineTts(apiKey: string): TtsProvider {
  return {
    id: 'volcengine',
    synth: (text, o) => retry(async () => {
      const req: Record<string, unknown> = { text, speaker: o.voice, audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: o.rate ?? 0, enable_subtitle: true } };
      if (o.pitch != null) req.additions = JSON.stringify({ post_process: { pitch: o.pitch } });   // semitones; only honoured inside additions
      if (o.instruction) req.context_texts = [o.instruction];                                        // must be top-level
      const res = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'X-Api-Key': apiKey,
          'X-Api-Resource-Id': o.voice.startsWith('S_') ? 'seed-icl-2.0' : 'seed-tts-2.0', 'X-Api-Request-Id': crypto.randomUUID(),
        },
        body: JSON.stringify({ req_params: req }),
        signal: o.signal ?? AbortSignal.timeout(90_000),
      });
      const raw = await res.text(), chunks: Buffer[] = [], words: WordTime[] = [];
      let err: string | null = null;
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        const f = JSON.parse(line);
        if (f.data) chunks.push(Buffer.from(f.data, 'base64'));
        if (f.sentence?.words) words.push(...f.sentence.words);
        if (f.code && f.code !== 20000000) err = `code=${f.code} ${f.message ?? ''}`;
      }
      if (res.status !== 200 || err || !chunks.length || !words.length) throw new Error(`Volcengine TTS ${res.status} ${err ?? 'returned no audio'}`);
      return { audio: Buffer.concat(chunks), words };
    }),
  };
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

export interface Voice { provider: TtsProvider['id']; id: string; name: string; gender?: 'female' | 'male'; lang?: string; /** a hosted sample (ElevenLabs) */ previewUrl?: string }

/** Volcengine preset narrators (seed-tts-2.0). */
export const VOLCENGINE_VOICES: Voice[] = [
  { provider: 'volcengine', id: 'zh_male_yuanboxiaoshu_uranus_bigtts', name: '渊博小叔', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_cancan_uranus_bigtts', name: '灿灿', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_tianmeixiaoyuan_uranus_bigtts', name: '甜美小源', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_wenroushunv_uranus_bigtts', name: '温柔淑女', gender: 'female', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_yangguangqingnian_uranus_bigtts', name: '阳光青年', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_male_wennuanahu_uranus_bigtts', name: '温暖阿虎', gender: 'male', lang: 'zh' },
  { provider: 'volcengine', id: 'zh_female_shuangkuaisisi_uranus_bigtts', name: '爽快思思', gender: 'female', lang: 'zh' },
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
