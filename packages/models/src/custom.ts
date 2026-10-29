// Providers the user configures: Volcengine Ark (OpenAI-compatible) and any OpenAI- or Anthropic-compatible endpoint.
import { createProvider, envApiKeyAuth, type ApiKeyAuth, type Model } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';

export type CustomProtocol = 'openai' | 'anthropic';

export interface CustomProviderConfig {
  id: string;                 // e.g. 'my-proxy'
  name: string;
  protocol: CustomProtocol;
  baseUrl: string;            // OpenAI: the /v1 root; Anthropic: the root that /v1/messages hangs off
  models: { id: string; name?: string; vision?: boolean; reasoning?: boolean; contextWindow?: number }[];
  /** list models from GET {baseUrl}/models when the endpoint supports it */
  discover?: boolean;
  /** how the key travels: 'key' (default) is x-api-key for Anthropic, Bearer for OpenAI; 'bearer' is Authorization: Bearer for both */
  auth?: 'key' | 'bearer';
}

/**
 * Bearer auth for gateways that only read `Authorization` (the Anthropic SDK sends `x-api-key`, which they ignore).
 * The key is resolved exactly like a normal API key and then travels as a header instead.
 */
function bearerAuth(name: string, envVar: string): ApiKeyAuth {
  const base = envApiKeyAuth(name, [envVar]);
  return {
    name: base.name,
    login: base.login,
    resolve: async (input) => {
      const r = await base.resolve(input);
      const key = r?.auth.apiKey;
      if (!r || !key) return r;   // no key stays "not configured" so the panel shows the endpoint as unconnected
      return { auth: { headers: { authorization: `Bearer ${key}` } }, env: r.env, source: r.source };
    },
  };
}

function model(cfg: CustomProviderConfig, m: CustomProviderConfig['models'][number]): Model<'openai-completions' | 'anthropic-messages'> {
  const api = cfg.protocol === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
  const out: Model<typeof api> = {
    id: m.id, name: m.name || m.id, api, provider: cfg.id, baseUrl: cfg.baseUrl,
    reasoning: m.reasoning ?? false, input: m.vision === false ? ['text'] : ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: m.contextWindow ?? 128_000, maxTokens: 32_000,
  };
  return out;
}

export function customProvider(cfg: CustomProviderConfig) {
  const envName = cfg.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY';
  return createProvider({
    id: cfg.id,
    name: cfg.name,
    baseUrl: cfg.baseUrl,
    auth: { apiKey: cfg.auth === 'bearer' ? bearerAuth(`${cfg.name} API key`, envName) : envApiKeyAuth(`${cfg.name} API key`, [envName]) },
    models: cfg.models.map((m) => model(cfg, m)),
    fetchModels: cfg.discover && cfg.protocol === 'openai'
      ? async ({ signal, credential }) => {
          const key = credential?.type === 'api_key' ? credential.key : undefined;
          const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal });
          if (!res.ok) throw new Error(`${cfg.name} /models: HTTP ${res.status}`);
          const body = (await res.json()) as { data?: { id: string }[] };
          const listed = (body.data || []).map((d) => ({ id: d.id }));
          const known = new Map(cfg.models.map((m) => [m.id, m]));
          return listed.map((m) => model(cfg, known.get(m.id) || m));
        }
      : undefined,
    api: cfg.protocol === 'anthropic' ? anthropicMessagesApi() : openAICompletionsApi(),
  });
}

/** Volcengine Ark: OpenAI-compatible; model ids are Ark model names or inference endpoint ids (ep-…). */
export const VOLCENGINE_ARK: CustomProviderConfig = {
  id: 'volcengine-ark',
  name: 'Volcengine Ark',
  protocol: 'openai',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  models: [],
  discover: true,
};
