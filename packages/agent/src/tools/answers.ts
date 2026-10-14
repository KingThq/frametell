// Answer tools for the Pi runtime (runtime/types.ts AnswerTool): calling one records its arguments for the orchestrator
// and ends the turn. Pi validates the arguments against the tool's schema, so what comes back has the fields it names.
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Answer, AnswerTool } from '../runtime/types.js';

export function answerTools(tools: AnswerTool[], record: (a: Answer) => void): AgentTool<any>[] {
  return tools.map((t): AgentTool<any> => ({
    name: t.name, label: t.name, description: t.description, parameters: t.parameters,
    execute: async (_id, args) => {
      record({ name: t.name, args: args as Record<string, unknown> });
      return { content: [{ type: 'text' as const, text: 'noted' }], details: undefined, terminate: true };
    },
  }));
}
