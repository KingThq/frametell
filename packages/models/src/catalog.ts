// The model catalog Studio works from: every built-in Pi provider, Relay (recommended), Volcengine Ark, and the
// user's own endpoints. Keys come from Studio's settings and live only in memory here.
import { InMemoryCredentialStore, type Api, type Model, type MutableModels } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { RELAY_BASE_URL, RELAY_ID, relayProvider } from './relay.js';
import { customProvider, VOLCENGINE_ARK, type CustomProviderConfig } from './custom.js';

export interface ProviderKey {
  providerId: string;
  apiKey: string;
  /** provider-scoped extras some providers need (e.g. CLOUDFLARE_ACCOUNT_ID) */
  env?: Record<string, string>;
}

export interface CatalogOptions {
  keys: ProviderKey[];
  custom?: CustomProviderConfig[];
  relayBaseUrl?: string;
}

export interface ModelInfo {
  provider: string;
  providerName: string;
  id: string;
  name: string;
  /** can look at images: required for the page agents to check their own frames */
  vision: boolean;
  reasoning: boolean;
  contextWindow: number;
  /** price per million tokens in `currency` */
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  currency: 'CNY' | 'USD';
  recommended: boolean;
}

/** What Studio suggests, in order: the first one the user has a key for becomes the default. */
export const RECOMMENDED: { provider: string; id: string }[] = [
  { provider: RELAY_ID, id: 'claude-opus-5-5' },
  { provider: RELAY_ID, id: 'gemini-3.7-flash-high' },
  { provider: 'anthropic', id: 'claude-opus-5-5' },
  { provider: 'openai', id: 'gpt-5.5' },
  { provider: 'google', id: 'gemini-3.7-flash' },
];

export class Catalog {
  constructor(readonly models: MutableModels) {}

  /** Chat models whose provider has a working key. */
  async available(): Promise<ModelInfo[]> {
    const list = await this.models.getAvailable();
    return list.map((m) => this.info(m));
  }

  get(provider: string, id: string): Model<Api> | undefined {
    return this.models.getModel(provider, id);
  }

  /** The recommended model the user can actually run, else the first available vision model. */
  async defaultModel(): Promise<ModelInfo | undefined> {
    const avail = await this.available();
    for (const r of RECOMMENDED) { const m = avail.find((a) => a.provider === r.provider && a.id === r.id); if (m) return m; }
    return avail.find((m) => m.vision) ?? avail[0];
  }

  info(m: Model<Api>): ModelInfo {
    const p = this.models.getProvider(m.provider);
    return {
      provider: m.provider, providerName: p?.name || m.provider, id: m.id, name: m.name,
      vision: m.input.includes('image'), reasoning: m.reasoning, contextWindow: m.contextWindow,
      cost: m.cost, currency: m.provider === RELAY_ID ? 'CNY' : 'USD',
      recommended: RECOMMENDED.some((r) => r.provider === m.provider && r.id === m.id),
    };
  }
}

export async function createCatalog(opts: CatalogOptions): Promise<Catalog> {
  const credentials = new InMemoryCredentialStore();
  for (const k of opts.keys) await credentials.modify(k.providerId, async () => ({ type: 'api_key', key: k.apiKey, env: k.env }));
  const models = builtinModels({ credentials });
  models.setProvider(relayProvider(opts.relayBaseUrl || RELAY_BASE_URL));
  models.setProvider(customProvider(VOLCENGINE_ARK));
  for (const c of opts.custom || []) models.setProvider(customProvider(c));
  // dynamic catalogs (Relay, Ark, custom endpoints) are fetched only for providers the user has a key for
  const keyed = new Set(opts.keys.map((k) => k.providerId));
  const dynamic = [RELAY_ID, VOLCENGINE_ARK.id, ...(opts.custom || []).map((c) => c.id)].filter((id) => keyed.has(id));
  if (dynamic.length) {
    const res = await models.refresh({ providers: dynamic });
    for (const [provider, error] of res.errors) console.warn(`[models] ${provider}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return new Catalog(models);
}
