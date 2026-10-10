// Folds the event stream into what the workbench shows. The director (storyboard, script, review) speaks in the
// conversation; page sessions run in parallel, so each page is summarized in one row instead of interleaving.
import type { LoggedEvent } from './client';

type Ev<T extends LoggedEvent['type']> = Extract<LoggedEvent, { type: T }>;
export type Stage = Ev<'stage'>['stage'];
export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'stopped';
export type Storyboard = Ev<'approval'>['storyboard'];
export type PageStatus = Ev<'page'>['status'];

export interface ToolCall { id: string; name: string; summary: string; ok?: boolean }
/** every item knows the stage it happened in, so the conversation reads as chapters */
type In = { stage?: Stage };
export type FeedItem = In & (
  | { kind: 'stage'; key: string; stage: Stage; status: StageStatus; detail?: string; at: number }
  | { kind: 'say'; key: string; session: string; text: string; at: number }
  | { kind: 'think'; key: string; session: string; text: string; at: number }
  | { kind: 'tools'; key: string; session: string; calls: ToolCall[]; at: number }
  | { kind: 'user'; key: string; text: string; at: number }
  | { kind: 'note'; key: string; text: string; at: number }
  | { kind: 'paused'; key: string; reason: 'user' | 'interrupted' | 'error'; message?: string; at: number }
  | { kind: 'check'; key: string; round: number; reds: number; yellows: number; messages: string[]; at: number }
  | { kind: 'approval'; key: string; storyboard: Storyboard; at: number }
  | { kind: 'pages'; key: string; at: number }
  | { kind: 'error'; key: string; message: string; at: number }
  | { kind: 'done'; key: string; video: string; duration: number; at: number });

export interface PageView {
  id: string;
  status: PageStatus;
  round: number;
  issues: string[];
  sheet?: string;
  thumb?: string;
  lastText?: string;
  tools: number;
  startedAt?: number;
  endedAt?: number;
}

export interface RunView {
  seq: number;
  stages: Record<Stage, { status: StageStatus; startedAt?: number; endedAt?: number; detail?: string }>;
  feed: FeedItem[];
  pages: Record<string, PageView>;
  pageOrder: string[];
  storyboard?: Storyboard;
  awaitingApproval: boolean;
  cost?: { amount: number; currency: 'CNY' | 'USD'; usage: Ev<'cost'>['usage'] };
  gate?: Ev<'gate'>;
  video?: { path: string; noSubs: string; duration: number };
  error?: string;
  /** set while the run is stopped (paused by the user, interrupted, or failed); cleared when it continues */
  paused?: { reason: 'user' | 'interrupted' | 'error'; message?: string; at: number };
  /** the stage that is running now */
  current?: Stage;
  /** when the run (or its latest continuation) started, for elapsed time */
  startedAt?: number;
  /** the last moment anything happened (for "working…" indicators) */
  activeAt?: number;
}

export const STAGES: Stage[] = ['storyboard', 'script', 'narrate', 'pages', 'review', 'render'];
export const STAGE_NAME: Record<Stage, string> = { storyboard: '分镜', script: '口播', narrate: '配音', pages: '画面', review: '全片检查', render: '渲染' };

export const emptyRun = (): RunView => ({
  seq: 0, feed: [], pages: {}, pageOrder: [], awaitingApproval: false,
  stages: Object.fromEntries(STAGES.map((s) => [s, { status: 'pending' }])) as RunView['stages'],
});

const isPage = (session: string) => session.startsWith('page-');

/** pure reducer: (view, event) → view; events arrive in seq order */
export function reduce(v: RunView, e: LoggedEvent): RunView {
  const at = e.at, key = String(e.seq);
  const r: RunView = { ...v, seq: e.seq, activeAt: at };
  const stage = v.current;
  const push = (item: FeedItem) => { r.feed = [...r.feed, { ...item, stage: item.stage ?? stage } as FeedItem]; };
  switch (e.type) {
    case 'stage': {
      const s = { ...r.stages[e.stage] };
      if (e.status === 'start') { s.status = 'running'; s.startedAt = at; s.endedAt = undefined; r.current = e.stage; r.paused = undefined; r.startedAt ??= at; }
      else { s.status = e.status; s.endedAt = at; s.detail = e.detail; if (r.current === e.stage) r.current = undefined; }
      r.stages = { ...r.stages, [e.stage]: s };
      if (e.stage === 'pages' && e.status === 'start' && !r.feed.some((f) => f.kind === 'pages')) push({ kind: 'pages', key, at, stage: 'pages' });
      else if (e.stage !== 'pages' || e.status !== 'start') push({ kind: 'stage', key, stage: e.stage, status: s.status, detail: e.detail, at });
      if (e.stage === 'script' && e.status === 'start') r.awaitingApproval = false;
      if (e.status === 'start') r.error = undefined;
      return r;
    }
    case 'agent': {
      const ev = e.event;
      if (isPage(e.session)) {
        const id = e.session.slice(5);
        const p = r.pages[id] ? { ...r.pages[id] } : newPage(id, r);
        if (ev.type === 'text' && !/^(DONE|FLAGGED)\b/i.test(ev.text.trim())) p.lastText = ev.text;   // keep the description, not the check-loop reply
        if (ev.type === 'tool_start') p.tools += 1;
        r.pages = { ...r.pages, [id]: p };
        return r;
      }
      if (ev.type === 'text') {
        // DONE / FLAGGED end the agent's check loop; they are protocol, not something to show people
        const text = ev.text.replace(/(^|\n)\s*(DONE|FLAGGED)\b[^\n]*\s*$/i, '').trim();
        if (text) push({ kind: 'say', key, session: e.session, text, at });
      }
      else if (ev.type === 'thinking') push({ kind: 'think', key, session: e.session, text: ev.text, at });
      else if (ev.type === 'tool_start' || ev.type === 'tool_end') {
        const last = r.feed[r.feed.length - 1];
        if (ev.type === 'tool_start') {
          const call: ToolCall = { id: ev.id, name: ev.name, summary: ev.summary };
          r.feed = last?.kind === 'tools' && last.session === e.session
            ? [...r.feed.slice(0, -1), { ...last, calls: [...last.calls, call] }]
            : [...r.feed, { kind: 'tools', key, session: e.session, calls: [call], at, stage }];
        } else {
          r.feed = r.feed.map((f) => (f.kind === 'tools' && f.session === e.session ? { ...f, calls: f.calls.map((c) => (c.id === ev.id ? { ...c, ok: ev.ok } : c)) } : f));
        }
      }
      return r;
    }
    case 'storyboard_check': {
      const reds = e.issues.filter((i) => i.level === 'red').length;
      push({ kind: 'check', key, round: e.round, reds, yellows: e.issues.length - reds, messages: e.issues.map((i) => `${i.page ?? '全片'}：${i.msg}`), at });
      return r;
    }
    case 'approval':
      r.storyboard = e.storyboard; r.awaitingApproval = true;
      push({ kind: 'approval', key, storyboard: e.storyboard, at, stage: 'storyboard' });
      return r;
    case 'page': {
      const p = r.pages[e.id] ? { ...r.pages[e.id] } : newPage(e.id, r);
      p.status = e.status; p.round = e.round ?? p.round; p.issues = e.issues ?? p.issues;
      if (e.sheet) p.sheet = e.sheet;
      if (e.thumb) p.thumb = e.thumb;
      if (e.status === 'drawing' && !p.startedAt) p.startedAt = at;
      if (['ok', 'flagged', 'failed'].includes(e.status)) p.endedAt = at;
      r.pages = { ...r.pages, [e.id]: p };
      if (!r.pageOrder.includes(e.id)) r.pageOrder = [...r.pageOrder, e.id].sort();
      return r;
    }
    case 'cost': r.cost = { amount: e.amount, currency: e.currency, usage: e.usage }; return r;
    case 'gate': r.gate = e; return r;
    case 'error': r.error = e.message; push({ kind: 'error', key, message: e.message, at }); return r;
    case 'user':
      if (r.awaitingApproval) r.awaitingApproval = false;   // at the storyboard, saying something is the change request
      push({ kind: 'user', key, text: e.text, at }); return r;
    case 'note': push({ kind: 'note', key, text: e.text, at }); return r;
    case 'paused': {
      // close whatever was running: its timer stops, and the chapter reads as stopped rather than in progress
      r.stages = Object.fromEntries(Object.entries(r.stages).map(([k, s]) => [k, s.status === 'running' ? { ...s, status: 'stopped' as StageStatus, endedAt: at } : s])) as RunView['stages'];
      r.current = undefined;
      r.paused = { reason: e.reason, message: e.message, at };
      r.pages = Object.fromEntries(Object.entries(r.pages).map(([k, p]) => [k, p.status === 'drawing' || p.status === 'checking' ? { ...p, status: 'queued' as PageStatus } : p]));
      if (e.reason === 'error' && r.feed.at(-1)?.kind === 'error') r.feed = r.feed.slice(0, -1);   // the paused card carries the message
      push({ kind: 'paused', key, reason: e.reason, message: e.message, at });
      return r;
    }
    case 'done':
      r.video = { path: e.video, noSubs: e.videoNoSubs, duration: e.duration };
      r.paused = undefined;
      push({ kind: 'done', key, video: e.video, duration: e.duration, at });
      return r;
    default: return r;
  }
}

function newPage(id: string, r: RunView): PageView {
  if (!r.pageOrder.includes(id)) r.pageOrder = [...r.pageOrder, id].sort();
  return { id, status: 'queued', round: 0, issues: [], tools: 0 };
}

/** a project-relative path from an absolute one the core reported (snapshots, video) */
export const relPath = (abs: string, projectId: string) => { const i = abs.indexOf(projectId + '/'); return i >= 0 ? abs.slice(i + projectId.length + 1) : abs.split('/').slice(-2).join('/'); };

export const money = (c?: { amount: number; currency: 'CNY' | 'USD' }, currency: 'CNY' | 'USD' = 'CNY') => { const cur = c?.currency ?? currency, a = c?.amount ?? 0; return `${cur === 'CNY' ? '¥' : '$'}${a < 10 ? a.toFixed(2) : a.toFixed(1)}`; };
export const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒`; };
