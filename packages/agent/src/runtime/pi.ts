// Pi runtime: any provider in the catalog (Relay, Anthropic, OpenAI, Google, OpenRouter, Ark, custom...). The session
// keeps its transcript in memory and on disk (ref = transcript file), so a later process can resume it.
import fs from 'node:fs';
import path from 'node:path';
import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, Model, MutableModels } from '@earendil-works/pi-ai';
import { fileTools } from '../tools/files.js';
import { addUsage, emptyUsage, type AgentRuntime, type AgentSession, type SessionOptions, type StageInput, type TurnResult } from './types.js';

const mimeOf = (f: string) => (/\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg');
const short = (v: unknown) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > 160 ? s.slice(0, 160) + '…' : s; };

export function piRuntime(models: MutableModels, model: Model<Api>, opts: { thinking?: 'off' | 'low' | 'medium' | 'high' } = {}): AgentRuntime {
  return {
    id: 'pi',
    model: { provider: model.provider, id: model.id },
    async open(o: SessionOptions, resume?: string): Promise<AgentSession> {
      const transcript = resume && fs.existsSync(resume) ? (JSON.parse(fs.readFileSync(resume, 'utf8')) as AgentMessage[]) : [];
      const agent = new Agent({
        initialState: { systemPrompt: o.system, model, thinkingLevel: opts.thinking ?? 'medium', tools: fileTools(o.cwd), messages: transcript },
        streamFn: models.streamSimple.bind(models),
        sessionId: o.name,
        toolExecution: 'sequential',
      });
      const ref = resume || path.join(o.cwd, '.studio', 'sessions', `${o.name}.json`);
      let turns = 0, usage = emptyUsage(), lastText = '', stop: TurnResult['stopReason'] = 'done';
      agent.subscribe((e) => {
        if (e.type === 'turn_end') {
          turns++;
          const u = (e.message as any)?.usage;
          if (u) { usage = addUsage(usage, u); o.onEvent?.({ type: 'turn', usage: { input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite } }); }
          if (turns >= o.maxTurns) { stop = 'max_turns'; agent.abort(); }
        } else if (e.type === 'message_end' && (e.message as any).role === 'assistant') {
          const blocks = ((e.message as any).content || []) as any[];
          const t = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
          if (t) { lastText = t; o.onEvent?.({ type: 'text', text: t }); }
          const th = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking).join('').trim();
          if (th) o.onEvent?.({ type: 'thinking', text: th });
        } else if (e.type === 'tool_execution_start') {
          o.onEvent?.({ type: 'tool_start', id: e.toolCallId, name: e.toolName, summary: short(e.args) });
        } else if (e.type === 'tool_execution_end') {
          o.onEvent?.({ type: 'tool_end', id: e.toolCallId, name: e.toolName, ok: !(e as any).isError });
        }
      });
      if (o.signal) o.signal.addEventListener('abort', () => { stop = 'aborted'; agent.abort(); }, { once: true });
      const save = () => { fs.mkdirSync(path.dirname(ref), { recursive: true }); fs.writeFileSync(ref, JSON.stringify(agent.state.messages)); };
      return {
        ref,
        async send(input: StageInput): Promise<TurnResult> {
          turns = 0; usage = emptyUsage(); lastText = ''; stop = 'done';
          const images = (input.images || []).map((f) => ({ type: 'image' as const, data: fs.readFileSync(f).toString('base64'), mimeType: mimeOf(f) }));
          let error: string | undefined;
          try { await agent.prompt(input.text, images); } catch (e) { error = (e as Error).message; stop = stop === 'done' ? 'error' : stop; }
          const err = agent.state.errorMessage;
          if (err && stop === 'done') { error = err; stop = 'error'; }
          save();
          return { ok: stop === 'done', text: lastText, turns, usage, error, stopReason: stop };
        },
        async close() { save(); },
      };
    },
  };
}
