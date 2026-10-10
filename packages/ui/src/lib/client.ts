// StudioClient: everything the panel can ask of the core. In a browser it speaks HTTP + SSE to the local server; inside
// the desktop app the preload script exposes the same methods as `window.studioBridge` over IPC.
import type {
  EnvCheck, LoggedEvent, ModelInfo, NewProjectInput, PageTiming, ProjectSummary, PublicSettings, SettingsPatch, StyleInfo, Timeline, UserRef, Voice,
} from '@frametell/core/types';

export type { EnvCheck, LoggedEvent, ModelInfo, NewProjectInput, PageTiming, ProjectSummary, PublicSettings, SettingsPatch, StyleInfo, Timeline, UserRef, Voice };
export type ProjectView = ProjectSummary & { previewBase: string };

export interface StudioClient {
  settings(): Promise<PublicSettings>;
  updateSettings(patch: SettingsPatch): Promise<PublicSettings>;
  env(): Promise<EnvCheck[]>;
  styles(): Promise<StyleInfo[]>;
  models(): Promise<{ models: ModelInfo[]; default?: ModelInfo }>;
  voices(): Promise<{ voices: Voice[]; configured: { volcengine: boolean; elevenlabs: boolean } }>;
  projects(): Promise<ProjectView[]>;
  project(id: string): Promise<ProjectView>;
  createProject(input: NewProjectInput, files: File[]): Promise<ProjectView>;
  start(id: string): Promise<void>;
  approve(id: string, feedback?: string): Promise<boolean>;
  stop(id: string): Promise<void>;
  /** talk to the director: storyboard feedback, a note mid-run, or a change to the finished film */
  say(id: string, text: string, refs?: UserRef[]): Promise<boolean>;
  /** save a file the user attached to a message into the project; returns the reference to send with it */
  attach(id: string, file: File): Promise<UserRef>;
  /** pages with their narration lines and times; null until the script exists */
  timeline(id: string): Promise<Timeline | null>;
  /** full-resolution frames of the film at `times`, as project-relative paths (from the mp4 when current, else live) */
  frames(id: string, times: number[]): Promise<string[]>;
  /** render the finished film to mp4 */
  export(id: string): Promise<boolean>;
  /** replay after `since`, then live; returns unsubscribe */
  subscribe(id: string, since: number, onEvent: (e: LoggedEvent) => void, onState?: (s: 'open' | 'reconnecting') => void): () => void;
  /** where a narrator's sample can be played */
  voicePreviewUrl(v: Voice): string;
  /** a URL for a file inside the project (preview player, snapshot, video) */
  fileUrl(p: ProjectView, rel: string): string;
}

class HttpError extends Error { constructor(msg: string, readonly status: number) { super(msg); } }

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as Record<string, string>)['content-type'] = 'application/json'; }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError((data as { error?: string }).error || `请求失败（${res.status}）`, res.status);
  return data as T;
}

export const httpClient: StudioClient = {
  settings: () => call('GET', '/api/settings'),
  updateSettings: (patch) => call('PUT', '/api/settings', patch),
  env: () => call('GET', '/api/env'),
  styles: () => call('GET', '/api/styles'),
  models: () => call('GET', '/api/models'),
  voices: () => call('GET', '/api/voices'),
  projects: () => call('GET', '/api/projects'),
  project: (id) => call('GET', `/api/projects/${id}`),
  createProject: (input, files) => {
    const form = new FormData();
    form.set('input', JSON.stringify(input));
    for (const f of files) form.append('materials', f, f.name);
    return call('POST', '/api/projects', form);
  },
  start: async (id) => { await call('POST', `/api/projects/${id}/start`); },
  approve: async (id, feedback) => (await call<{ ok: boolean }>('POST', `/api/projects/${id}/approve`, { feedback })).ok,
  stop: async (id) => { await call('POST', `/api/projects/${id}/stop`); },
  timeline: (id) => call<Timeline | null>('GET', `/api/projects/${id}/timeline`),
  export: async (id) => (await call<{ ok: boolean }>('POST', `/api/projects/${id}/export`)).ok,
  frames: async (id, times) => (await call<{ paths: string[] }>('GET', `/api/projects/${id}/frames?t=${times.map((t) => t.toFixed(1)).join(',')}`)).paths,
  say: async (id, text, refs) => (await call<{ ok: boolean }>('POST', `/api/projects/${id}/say`, { text, refs })).ok,
  attach: async (id, file) => { const f = new FormData(); f.append('file', file); return call<UserRef>('POST', `/api/projects/${id}/attach`, f); },
  subscribe(id, since, onEvent, onState) {
    let last = since;
    const es = new EventSource(`/api/projects/${id}/events?since=${since}`);
    es.addEventListener('studio', (m) => { const e = JSON.parse((m as MessageEvent).data) as LoggedEvent; if (e.seq > last) { last = e.seq; onEvent(e); } });
    es.onopen = () => onState?.('open');
    es.onerror = () => onState?.('reconnecting');   // EventSource reconnects with Last-Event-ID by itself
    return () => es.close();
  },
  voicePreviewUrl: (v) => v.previewUrl || `/api/voices/${v.provider}/${encodeURIComponent(v.id)}/preview`,
  fileUrl: (p, rel) => p.previewBase + rel.split('/').map(encodeURIComponent).join('/'),
};

declare global { interface Window { studioBridge?: StudioClient & { platform?: string } } }

/** the desktop app's bridge when present, else the local HTTP server */
export const client: StudioClient = (typeof window !== 'undefined' && window.studioBridge) || httpClient;
