// Folds the event stream into what the workbench shows. The director (storyboard, script, review) speaks in the
// conversation; page sessions run in parallel, so each page is summarized in one row instead of interleaving.
import type { LoggedEvent, UserRef } from './client';
import { t } from '../i18n';
import { actText, PAGE_ACTS, pageName, toolAct } from './describe';

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
  | { kind: 'user'; key: string; text: string; refs?: UserRef[]; at: number }
  | { kind: 'note'; key: string; text: string; at: number }
  | { kind: 'paused'; key: string; reason: 'user' | 'interrupted' | 'error'; message?: string; at: number }
  | { kind: 'check'; key: string; round: number; reds: number; yellows: number; messages: string[]; at: number }
  | { kind: 'approval'; key: string; storyboard: Storyboard; at: number }
  | { kind: 'pages'; key: string; at: number }
  | { kind: 'error'; key: string; message: string; at: number }
  /** the film is finished and plays in the preview (newer runs; older logs go straight to `done`) */
  | { kind: 'ready'; key: string; duration: number; at: number }
  /** an mp4 export: running, then done with the file, or failed */
  | { kind: 'export'; key: string; status: 'running' | 'done' | 'failed'; detail?: string; video?: string; noSubs?: string; at: number; endedAt?: number }
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
  /** what it is writing right now, while the model streams it: “212 lines written” */
  progress?: string;
  /** what this page's agent is doing right now (pages are drawn side by side, each says its own) */
  activity?: RunView['activity'];
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
  /** the film is finished: drawn, checked, playable in the live preview */
  ready?: { duration: number; at: number };
  /** the exported mp4 is older than the film (a revision changed it since) */
  stale?: boolean;
  /** an mp4 export in progress, since when */
  exporting?: number;
  error?: string;
  /** set while the run is stopped (paused by the user, interrupted, or failed); cleared when it continues */
  paused?: { reason: 'user' | 'interrupted' | 'error'; message?: string; at: number };
  /** the stage that is running now */
  current?: Stage;
  /** set from a change request on a finished film until the redraw starts: the director is deciding which pages to redo */
  revising?: number;
  /** what the director (or a page agent) is doing right now, in plain words, and since when */
  /** `updated`: the latest streamed progress (a long silence after thinking means the answer is being written);
   *  `page`: the page session doing it; `thinking` / `writing`: thinking, or writing an answer that shows only when whole;
   *  `base`: the text without its line count, so a growing count keeps the same start time */
  activity?: { text: string; at: number; detail?: string; updated?: number; page?: string; thinking?: boolean; writing?: boolean; base?: string };
  /** when the run (or its latest continuation) started, for elapsed time */
  startedAt?: number;
  /** the last moment anything happened (for "working…" indicators) */
  activeAt?: number;
}

export const STAGES: Stage[] = ['storyboard', 'script', 'narrate', 'pages', 'review', 'render'];
/** stage names in the interface language, read when used: STAGE_NAME[stage] */
export const STAGE_NAME = new Proxy({} as Record<Stage, string>, { get: (_, k) => t(`run.stage.${String(k) as Stage}`) });

export const emptyRun = (): RunView => ({
  seq: 0, feed: [], pages: {}, pageOrder: [], awaitingApproval: false,
  stages: Object.fromEntries(STAGES.map((s) => [s, { status: 'pending' }])) as RunView['stages'],
});

const isPage = (session: string) => session.startsWith('page-');

/** pure reducer: (view, event) → view; events arrive in seq order */
/** with several pages drawn at once, a page's moment belongs on that page: the shared line would hop between them */
export function reduce(v: RunView, e: LoggedEvent): RunView {
  const r = step(v, e);
  const a = r.activity;
  if (a?.page && a !== v.activity && r.pages[a.page]) r.pages = { ...r.pages, [a.page]: { ...r.pages[a.page], activity: a } };
  return r;
}

function step(v: RunView, e: LoggedEvent): RunView {
  const at = e.at, key = String(e.seq);
  const r: RunView = { ...v, seq: e.seq, activeAt: at };
  const stage = v.current;
  const push = (item: FeedItem) => { r.feed = [...r.feed, { ...item, stage: item.stage ?? stage } as FeedItem]; };
  switch (e.type) {
    case 'stage': {
      // after the film is finished, rendering is an export, not a step of making it: one line in the conversation
      if (e.stage === 'render' && r.ready) {
        if (e.status === 'start') { r.exporting = at; r.error = undefined; push({ kind: 'export', key, status: 'running', at }); }
        else {
          r.exporting = undefined;
          const i = r.feed.map((f) => f.kind === 'export' && f.status === 'running').lastIndexOf(true);
          if (i >= 0 && e.status === 'failed') r.feed = r.feed.map((f, j) => (j === i ? { ...f, status: 'failed', detail: e.detail, endedAt: at } as FeedItem : f));
        }
        return r;
      }
      const s = { ...r.stages[e.stage] };
      if (e.status === 'start') { s.status = 'running'; s.startedAt = at; s.endedAt = undefined; r.current = e.stage; r.paused = undefined; r.revising = undefined; r.startedAt ??= at; }
      else { s.status = e.status; s.endedAt = at; s.detail = e.detail; if (r.current === e.stage) r.current = undefined; r.activity = undefined; }
      r.stages = { ...r.stages, [e.stage]: s };
      // one page list per round of drawing: a revision after the film gets its own
      const lastDone = r.feed.map((f) => f.kind === 'done' || f.kind === 'ready').lastIndexOf(true);
      if (e.stage === 'pages' && e.status === 'start' && !r.feed.slice(lastDone + 1).some((f) => f.kind === 'pages')) push({ kind: 'pages', key, at, stage: 'pages' });
      else if (e.stage !== 'pages' || e.status !== 'start') push({ kind: 'stage', key, stage: e.stage, status: s.status, detail: e.detail, at });
      if (e.stage === 'script' && e.status === 'start') r.awaitingApproval = false;
      if (e.status === 'start') r.error = undefined;
      return r;
    }
    case 'agent': {
      const ev = e.event;
      const page = isPage(e.session) ? e.session.slice(5) : undefined;
      const who = (doing: string) => (page ? t('run.now.who', { page: pageName(page), doing }) : doing);
      if (ev.type === 'progress') {
        // a response still being written: say what, how far it has got, and show the line it is on
        const act = ev.what === 'tool' ? toolAct(ev.name ?? '', JSON.stringify({ path: ev.path ?? '' })) : undefined;
        const doing = ev.what === 'thinking' ? t('run.now.thinking')
          : ev.what === 'writing' ? t(page ? 'run.now.writingPicture' : 'run.now.writing')
          : ev.what === 'text' ? t('run.now.writingReply')
          : page && act && PAGE_ACTS.includes(act.id) ? t(ev.name === 'edit' ? 'run.now.editingPicture' : 'run.now.writingPicture')
          : act ? actText(act, 'doing') : ev.name ?? '';
        const base = who(doing);
        const text = ev.what === 'tool' && ev.lines ? who(t('run.now.withLines', { doing, n: ev.lines })) : base;
        r.activity = {
          text, base, page, at: r.activity?.base === base ? r.activity!.at : at, detail: ev.what === 'tool' ? ev.tail : undefined, updated: at,
          thinking: ev.what === 'thinking', writing: ev.what === 'writing' || (!!page && ev.what === 'tool' && !ev.lines && ev.name !== 'edit' && !!act && PAGE_ACTS.includes(act.id)),
        };
        if (page && ev.what === 'tool' && ev.lines) {
          if (r.pages[page]) r.pages = { ...r.pages, [page]: { ...r.pages[page], progress: t('run.now.lines', { n: ev.lines }) } };
        }
        return r;
      }
      if (ev.type === 'tool_start') {
        const act = toolAct(ev.name, ev.summary);
        // inside a page session, writing code is drawing the page whatever the path summary kept
        const drawing = page && act && PAGE_ACTS.includes(act.id) && act.id !== 'readFile' && act.id !== 'readPage';
        r.activity = { text: who(drawing ? t(act!.id === 'editFile' || act!.id === 'editPage' ? 'run.now.editingPicture' : 'run.now.drawingPicture') : act ? actText(act, 'start') : ev.name), at, page };
      }
      else if (ev.type === 'thinking') r.activity = { text: who(t('run.now.thinking')), at, page, thinking: true };
      else if (ev.type === 'text' && !page) r.activity = { text: t('run.now.writing'), at, writing: true };
      if (page) {
        const id = page;
        const p = r.pages[id] ? { ...r.pages[id] } : newPage(id, r);
        if (ev.type === 'text' && !/^(DONE|FLAGGED)\b/i.test(ev.text.trim())) p.lastText = ev.text;   // keep the description, not the check-loop reply
        if (ev.type === 'tool_start') { p.tools += 1; p.progress = undefined; }
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
      push({ kind: 'check', key, round: e.round, reds, yellows: e.issues.length - reds, messages: e.issues.map((i) => t('run.issue', { where: i.page ?? t('run.wholeFilm'), msg: i.msg })), at });
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
      // the check round: first the pictures are taken, then the page agent looks at them
      if (e.status === 'checking') r.activity = { text: t('run.now.checking', { page: pageName(e.id), snaps: !!e.sheet, round: p.round }), at, page: e.id };
      p.progress = undefined;
      r.pages = { ...r.pages, [e.id]: p };
      if (!r.pageOrder.includes(e.id)) r.pageOrder = [...r.pageOrder, e.id].sort();
      return r;
    }
    case 'cost': r.cost = { amount: e.amount, currency: e.currency, usage: e.usage }; return r;
    case 'gate': r.gate = e; return r;
    case 'error': r.error = e.message; push({ kind: 'error', key, message: e.message, at }); return r;
    case 'user':
      if (r.awaitingApproval) r.awaitingApproval = false;   // at the storyboard, saying something is the change request
      else if ((r.ready || r.video) && !r.current && !r.exporting) { r.revising = at; r.startedAt = at; }   // after the film, a change request: its own round
      push({ kind: 'user', key, text: e.text, refs: e.refs, at }); return r;
    case 'note': push({ kind: 'note', key, text: e.text, at }); return r;
    case 'paused': {
      // close whatever was running: its timer stops, and the chapter reads as stopped rather than in progress
      r.stages = Object.fromEntries(Object.entries(r.stages).map(([k, s]) => [k, s.status === 'running' ? { ...s, status: 'stopped' as StageStatus, endedAt: at } : s])) as RunView['stages'];
      r.current = undefined;
      r.activity = undefined;
      r.revising = undefined;
      r.paused = { reason: e.reason, message: e.message, at };
      r.pages = Object.fromEntries(Object.entries(r.pages).map(([k, p]) => [k, p.status === 'drawing' || p.status === 'checking' ? { ...p, status: 'queued' as PageStatus } : p]));
      if (e.reason === 'error' && r.feed.at(-1)?.kind === 'error') r.feed = r.feed.slice(0, -1);   // the paused card carries the message
      push({ kind: 'paused', key, reason: e.reason, message: e.message, at });
      return r;
    }
    case 'ready':
      r.ready = { duration: e.duration, at };
      r.stale = !!r.video;
      r.paused = undefined;
      r.activity = undefined;
      r.revising = undefined;
      r.current = undefined;
      push({ kind: 'ready', key, duration: e.duration, at });
      return r;
    case 'done': {
      r.video = { path: e.video, noSubs: e.videoNoSubs, duration: e.duration };
      r.stale = false;
      r.exporting = undefined;
      r.paused = undefined;
      r.activity = undefined;
      r.revising = undefined;
      const i = r.feed.map((f) => f.kind === 'export' && f.status === 'running').lastIndexOf(true);
      if (i >= 0) r.feed = r.feed.map((f, j) => (j === i ? { ...f, status: 'done', video: e.video, noSubs: e.videoNoSubs, endedAt: at } as FeedItem : f));
      else push({ kind: 'done', key, video: e.video, duration: e.duration, at });   // a run from before exports were separate
      return r;
    }
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
export const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? t('run.sec', { s }) : t('run.minSec', { m: Math.floor(s / 60), s: String(s % 60).padStart(2, '0') }); };

/** something is being made right now (a stage, or the director planning a change to the finished film) */
export const isWorking = (r: RunView) => (!!r.current && !r.awaitingApproval) || !!r.revising || !!r.exporting;
/** the film is finished (whether or not an mp4 of it exists) */
export const finished = (r: RunView) => !!r.ready || !!r.video;
/** the exported mp4, when it shows the film as it is now */
export const film = (r: RunView) => (r.video && !r.stale ? r.video : undefined);
