// Types shared by the core and every client (the panel in a browser, the Electron renderer). Type-only: importing it
// never pulls Node code into a client bundle.
import type { StudioEvent, Storyboard } from '@frametell/agent';
import type { ModelInfo } from '@frametell/models';

export type { StudioEvent, Storyboard, ModelInfo };
export type { Timeline, PageTiming, UserRef } from '@frametell/agent';
export type RuntimeId = 'pi' | 'claude-agent-sdk' | 'codex';
export type RunStatus = 'idle' | 'running' | 'awaiting_approval' | 'done' | 'failed' | 'stopped';
export interface VoiceChoice { provider: 'volcengine' | 'elevenlabs'; id: string; name?: string }
export interface Voice { provider: 'volcengine' | 'elevenlabs'; id: string; name: string; gender?: 'female' | 'male'; lang?: string; previewUrl?: string }
export interface StyleInfo { id: string; name: string; summary: string }
export interface EnvCheck { id: 'chrome' | 'ffmpeg' | 'git' | 'node'; ok: boolean; detail: string; fix?: string }

export interface ProjectMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  style: string;
  durationSec: number;
  model: string;
  runtime: RuntimeId;
  voice?: VoiceChoice;
  subtitles: boolean;
  topic?: string;
  notes?: string;
  materials: string[];
}
export interface ProjectSummary extends ProjectMeta { status: RunStatus; stage?: string; video?: string }

export interface NewProjectInput {
  title?: string;
  style?: string;
  durationSec?: number;
  model?: string;
  runtime?: RuntimeId;
  voice?: VoiceChoice;
  subtitles?: boolean;
  topic?: string;
  notes?: string;
}

/** settings as clients see them: keys are masked hints, never the secrets */
export interface PublicSettings {
  keys: Record<string, string>;
  custom: unknown[];
  /** the user's relay per provider (not secret) */
  baseUrls: Record<string, string>;
  /** the proxy, password masked; '' when none */
  proxy: string;
  tts: { volcengine: string; elevenlabs: string };
  defaults: { model?: string; runtime: RuntimeId; style: string; durationSec: number; voice?: VoiceChoice; subtitles: boolean; concurrency: number };
}
export interface SettingsPatch {
  keys?: Record<string, string>;
  /** '' removes a relay */
  baseUrls?: Record<string, string>;
  /** '' removes the proxy */
  proxy?: string;
  tts?: { volcengine?: string; elevenlabs?: string };
  defaults?: Partial<PublicSettings['defaults']>;
}

/** an event as logged and streamed: the director's event plus its sequence number and time */
export type LoggedEvent = StudioEvent & { seq: number; at: number };
