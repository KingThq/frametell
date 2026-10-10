// One stage run = one agent session working in the project directory with file and shell tools. The orchestrator drives
// every stage through this interface, so Pi (any provider), the Claude Agent SDK and the Codex SDK are interchangeable.

export interface TokenUsage { input: number; output: number; cacheRead: number; cacheWrite: number }

export type RuntimeEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; id: string; name: string; summary: string }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; summary?: string }
  | { type: 'turn'; usage: TokenUsage }
  | { type: 'retry'; message: string };

/** A message the orchestrator sends into a session: text plus optional images (lint report + contact sheet). */
export interface StageInput { text: string; images?: string[] }

export interface SessionOptions {
  /** stable id, also used for provider prompt caching */
  name: string;
  system: string;
  cwd: string;
  /** hard cap on model turns for this session (each tool round trip is a turn) */
  maxTurns: number;
  signal?: AbortSignal;
  onEvent?: (e: RuntimeEvent) => void;
}

export interface TurnResult {
  ok: boolean;
  /** the model's final text for this exchange */
  text: string;
  turns: number;
  usage: TokenUsage;
  error?: string;
  stopReason?: 'done' | 'max_turns' | 'error' | 'aborted';
}

/** A live session: send() appends a user message and runs the agent until it stops (or hits maxTurns). */
export interface AgentSession {
  send(input: StageInput): Promise<TurnResult>;
  /** opaque, serializable: lets a later process resume the same conversation */
  readonly ref: string | undefined;
  close(): Promise<void>;
}

export interface AgentRuntime {
  readonly id: 'pi' | 'claude-agent-sdk' | 'codex';
  /** the model the session runs on, for display and cost accounting */
  readonly model: { provider: string; id: string };
  open(opts: SessionOptions, resume?: string): Promise<AgentSession>;
}

export const emptyUsage = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
export const addUsage = (a: TokenUsage, b: Partial<TokenUsage>): TokenUsage => ({
  input: a.input + (b.input || 0), output: a.output + (b.output || 0),
  cacheRead: a.cacheRead + (b.cacheRead || 0), cacheWrite: a.cacheWrite + (b.cacheWrite || 0),
});

/** the proxy settings a spawned agent CLI inherits (Studio sets them on its own process when the user configures one) */
export const proxyEnv = (): Record<string, string> =>
  Object.fromEntries(['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'].filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));
