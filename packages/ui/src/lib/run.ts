// Folds the event stream into what the workbench shows. The director (storyboard, script, review) speaks in the
// conversation; page sessions run in parallel, so each page is summarized in one row instead of interleaving.
import type { LoggedEvent } from './client';

type Ev<T extends LoggedEvent['type']> = Extract<LoggedEvent, { type: T }>;
export type Stage = Ev<'stage'>['stage'];
export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export type Storyboard = Ev<'approval'>['storyboard'];
export type PageStatus = Ev<'page'>['status'];

export interface ToolCall { id: string; name: string; summary: string; ok?: boolean }
export type FeedItem =
  | { kind: 'stage'; key: string; stage: Stage; status: StageStatus; detail?: string; at: number }
  | { kind: 'say'; key: string; session: string; text: string; at: number }
  | { kind: 'think'; key: string; session: string; text: string; at: number }
  | { kind: 'tools'; key: string; session: string; calls: ToolCall[]; at: number }
  | { kind: 'check'; key: string; round: number; reds: number; yellows: number; messages: string[]; at: number }
  | { kind: 'approval'; key: string; storyboard: Storyboard; at: number }
  | { kind: 'pages'; key: string; at: number }
  | { kind: 'error'; key: string; message: string; at: number }
  | { kind: 'done'; key: string; video: string; duration: number; at: number };

export interface PageView {
  id: string;
  status: PageStatus;
  round: number;
  issues: string[];
  sheet?: string;
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
  switch (e.type) {
    case 'stage': {
      const s = { ...r.stages[e.stage] };
      if (e.status === 'start') { s.status = 'running'; s.startedAt = at; s.endedAt = undefined; }
      else { s.status = e.status; s.endedAt = at; s.detail = e.detail; }
      r.stages = { ...r.stages, [e.stage]: s };
      if (e.stage === 'pages' && e.status === 'start' && !r.feed.some((f) => f.kind === 'pages')) r.feed = [...r.feed, { kind: 'pages', key, at }];
      else if (e.stage !== 'pages' || e.status !== 'start') r.feed = [...r.feed, { kind: 'stage', key, stage: e.stage, status: s.status, detail: e.detail, at }];
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
      if (ev.type === 'text') r.feed = [...r.feed, { kind: 'say', key, session: e.session, text: ev.text, at }];
      else if (ev.type === 'thinking') r.feed = [...r.feed, { kind: 'think', key, session: e.session, text: ev.text, at }];
      else if (ev.type === 'tool_start' || ev.type === 'tool_end') {
        const last = r.feed[r.feed.length - 1];
        if (ev.type === 'tool_start') {
          const call: ToolCall = { id: ev.id, name: ev.name, summary: ev.summary };
          r.feed = last?.kind === 'tools' && last.session === e.session
            ? [...r.feed.slice(0, -1), { ...last, calls: [...last.calls, call] }]
            : [...r.feed, { kind: 'tools', key, session: e.session, calls: [call], at }];
        } else {
          r.feed = r.feed.map((f) => (f.kind === 'tools' && f.session === e.session ? { ...f, calls: f.calls.map((c) => (c.id === ev.id ? { ...c, ok: ev.ok } : c)) } : f));
        }
      }
      return r;
    }
    case 'storyboard_check': {
      const reds = e.issues.filter((i) => i.level === 'red').length;
      r.feed = [...r.feed, { kind: 'check', key, round: e.round, reds, yellows: e.issues.length - reds, messages: e.issues.map((i) => `${i.page ?? '全片'}：${i.msg}`), at }];
      return r;
    }
    case 'approval':
      r.storyboard = e.storyboard; r.awaitingApproval = true;
      r.feed = [...r.feed, { kind: 'approval', key, storyboard: e.storyboard, at }];
      return r;
    case 'page': {
      const p = r.pages[e.id] ? { ...r.pages[e.id] } : newPage(e.id, r);
      p.status = e.status; p.round = e.round ?? p.round; p.issues = e.issues ?? p.issues;
      if (e.sheet) p.sheet = e.sheet;
      if (e.status === 'drawing' && !p.startedAt) p.startedAt = at;
      if (['ok', 'flagged', 'failed'].includes(e.status)) p.endedAt = at;
      r.pages = { ...r.pages, [e.id]: p };
      if (!r.pageOrder.includes(e.id)) r.pageOrder = [...r.pageOrder, e.id].sort();
      return r;
    }
    case 'cost': r.cost = { amount: e.amount, currency: e.currency, usage: e.usage }; return r;
    case 'gate': r.gate = e; return r;
    case 'error': r.error = e.message; r.feed = [...r.feed, { kind: 'error', key, message: e.message, at }]; return r;
    case 'done':
      r.video = { path: e.video, noSubs: e.videoNoSubs, duration: e.duration };
      r.feed = [...r.feed, { kind: 'done', key, video: e.video, duration: e.duration, at }];
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
