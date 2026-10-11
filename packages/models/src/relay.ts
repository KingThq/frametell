// Relay (https://relay.example.com): the recommended provider. One key reaches Claude, Gemini and GPT; the catalog and
// prices come from the gateway's /v1/models. Claude and Gemini speak the Anthropic Messages protocol there, GPT the
// OpenAI Responses protocol, so this is a mixed-API provider.
import { createProvider, envApiKeyAuth, type Model } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';

export const RELAY_ID = 'relay';
export const RELAY_BASE_URL = 'https://relay.example.com';

interface GatewayModel {
  id: string;
  display_name?: string;
  provider?: string;
  category?: string;
  pricing?: { input_per_1m?: number; cached_per_1m?: number; cache_write_per_1m?: number; output_per_1m?: number };
}

type RelayApi = 'anthropic-messages' | 'openai-responses';

/** Known context windows; the gateway does not report them. */
function limits(id: string): { contextWindow: number; maxTokens: number } {
  if (id.startsWith('claude-')) return { contextWindow: 1_000_000, maxTokens: 64_000 };
  if (id.startsWith('gemini-')) return { contextWindow: 1_000_000, maxTokens: 65_536 };
  return { contextWindow: 272_000, maxTokens: 64_000 };
}

/** Claude 4.6 and later think adaptively (Opus 4.7 and the 5s accept nothing else); earlier ones take a token budget */
function adaptiveThinking(id: string): boolean {
  const v = /^claude-[a-z]+-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(id);
  return !!v && (+v[1] > 4 || (+v[1] === 4 && +(v[2] ?? 0) >= 6));
}

export function toModel(m: GatewayModel, baseUrl: string): Model<RelayApi> | null {
  if (m.category === 'image' || m.id.startsWith('gpt-image')) return null;   // chat and reasoning models only
  const gpt = m.id.startsWith('gpt-');
  const api: RelayApi = gpt ? 'openai-responses' : 'anthropic-messages';
  const p = m.pricing || {};
  const model: Model<RelayApi> = {
    id: m.id,
    name: m.display_name || m.id,
    api,
    provider: RELAY_ID,
    // the Anthropic client appends /v1/messages itself; the OpenAI client expects the /v1 root
    baseUrl: gpt ? `${baseUrl}/v1` : baseUrl,
    reasoning: true,
    input: ['text', 'image'],
    // prices are ¥ per million tokens (Relay bills in RMB); the catalog marks the currency
    cost: { input: p.input_per_1m ?? 0, output: p.output_per_1m ?? 0, cacheRead: p.cached_per_1m ?? 0, cacheWrite: p.cache_write_per_1m ?? (p.input_per_1m ?? 0) * 1.25 },
    ...limits(m.id),
    ...(adaptiveThinking(m.id) ? { compat: { forceAdaptiveThinking: true } } : {}),
  };
  return model;
}

/** The Relay provider; `fetchModels` keeps the catalog in sync with the gateway. */
export function relayProvider(baseUrl = RELAY_BASE_URL) {
  return createProvider<RelayApi>({
    id: RELAY_ID,
    name: 'Relay',
    baseUrl,
    auth: { apiKey: envApiKeyAuth('Relay API key', ['RELAY_API_KEY']) },
    models: [],
    fetchModels: async ({ signal, credential }) => {
      const key = credential && credential.type === 'api_key' ? credential.key : undefined;
      const res = await fetch(`${baseUrl}/v1/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal });
      if (!res.ok) throw new Error(`Relay /v1/models: HTTP ${res.status}`);
      const body = (await res.json()) as { data?: GatewayModel[] };
      return (body.data || []).map((m) => toModel(m, baseUrl)).filter((m): m is Model<RelayApi> => !!m);
    },
    api: { 'anthropic-messages': anthropicMessagesApi(), 'openai-responses': openAIResponsesApi() },
  });
}
