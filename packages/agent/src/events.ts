// Everything the director reports while it works. The local server streams these to the panel over SSE, so each event
// is small, JSON-serializable and meaningful on its own.
import type { RuntimeEvent, TokenUsage } from './runtime/types.js';
import type { LintIssue, Storyboard } from './project.js';

export type Stage = 'storyboard' | 'script' | 'narrate' | 'pages' | 'review' | 'render';
export type PageStatus = 'queued' | 'drawing' | 'checking' | 'ok' | 'flagged' | 'failed';

/**
 * A piece of the film or of the user's machine the user handed the director with a message: a page, a narration line,
 * a frame of the film, or a file they attached (saved under refs/). `label` is how the panel shows it.
 */
export type UserRef =
  | { kind: 'page'; page: string; label: string }
  | { kind: 'line'; page: string; label: string; at: number; text: string }
  | { kind: 'frame'; page: string; label: string; at: number; path: string; text?: string }
  | { kind: 'file'; label: string; path: string; image: boolean };

export type StudioEvent =
  | { type: 'stage'; stage: Stage; status: 'start' | 'done' | 'failed' | 'skipped'; detail?: string }
  /** a session's own activity: text, thinking summaries, tool calls, per-turn usage */
  | { type: 'agent'; session: string; event: RuntimeEvent }
  | { type: 'storyboard_check'; round: number; issues: { level: string; page?: string; beat?: number; msg: string }[] }
  /** the storyboard passed its checks and waits for the user (in CLI runs it is approved automatically) */
  | { type: 'approval'; storyboard: Storyboard }
  | { type: 'page'; id: string; status: PageStatus; round?: number; issues?: string[]; sheet?: string; thumb?: string; note?: string }
  /** something the user said to the director (approval feedback, a note while it works, a change after the film) */
  | { type: 'user'; text: string; refs?: UserRef[] }
  /** a short line from the director that isn't a model message: how a user note will be handled, what a revision redraws */
  | { type: 'note'; text: string }
  /** the run stopped: the user paused, the app was closed mid-run, or an error; completed work is kept */
  | { type: 'paused'; reason: 'user' | 'interrupted' | 'error'; stage?: string; message?: string }
  | { type: 'narrate'; page: string; index: number; total: number; cached: boolean }
  | { type: 'render'; line: string }
  | { type: 'gate'; red: boolean; blank: { at: number; seconds: number }[]; report: { name: string; value: number; unit?: string }[] }
  | { type: 'cost'; usage: TokenUsage; amount: number; currency: 'CNY' | 'USD' }
  | { type: 'commit'; id: string; message: string }
  | { type: 'error'; message: string; stage?: Stage }
  /** the film is drawn and checked: it plays in the live preview. An mp4 is made only on export (then `done`) */
  | { type: 'ready'; duration: number }
  /** the film was exported to mp4 */
  | { type: 'done'; video: string; videoNoSubs: string; duration: number };

export type { LintIssue };
