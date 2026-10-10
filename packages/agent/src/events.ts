// Everything the director reports while it works. The local server streams these to the panel over SSE, so each event
// is small, JSON-serializable and meaningful on its own.
import type { RuntimeEvent, TokenUsage } from './runtime/types.js';
import type { LintIssue, Storyboard } from './project.js';

export type Stage = 'storyboard' | 'script' | 'narrate' | 'pages' | 'review' | 'render';
export type PageStatus = 'queued' | 'drawing' | 'checking' | 'ok' | 'flagged' | 'failed';

export type StudioEvent =
  | { type: 'stage'; stage: Stage; status: 'start' | 'done' | 'failed' | 'skipped'; detail?: string }
  /** a session's own activity: text, thinking summaries, tool calls, per-turn usage */
  | { type: 'agent'; session: string; event: RuntimeEvent }
  | { type: 'storyboard_check'; round: number; issues: { level: string; page?: string; beat?: number; msg: string }[] }
  /** the storyboard passed its checks and waits for the user (in CLI runs it is approved automatically) */
  | { type: 'approval'; storyboard: Storyboard }
  | { type: 'page'; id: string; status: PageStatus; round?: number; issues?: string[]; sheet?: string; note?: string }
  | { type: 'narrate'; page: string; index: number; total: number; cached: boolean }
  | { type: 'render'; line: string }
  | { type: 'gate'; red: boolean; blank: { at: number; seconds: number }[]; report: { name: string; value: number; unit?: string }[] }
  | { type: 'cost'; usage: TokenUsage; amount: number; currency: 'CNY' | 'USD' }
  | { type: 'commit'; id: string; message: string }
  | { type: 'error'; message: string; stage?: Stage }
  | { type: 'done'; video: string; videoNoSubs: string; duration: number };

export type { LintIssue };
