// The web as the research session sees it: a search engine (the one the user configured: Tavily, Serper, SerpAPI or
// Jina) and a page reader. Reading works with no key at all (Jina Reader's free tier, then the page itself); a key for
// Tavily or Jina makes it sturdier. A setting may hold several keys separated by commas: they take turns, and one
// that is refused (spent, revoked) is skipped for the rest of the run.

export type SearchProviderId = 'tavily' | 'serper' | 'serpapi' | 'jina';
export const SEARCH_PROVIDERS: SearchProviderId[] = ['tavily', 'serper', 'serpapi', 'jina'];

export interface SearchSettings {
  /** the search engine to use; absent: the first one with a key, in SEARCH_PROVIDERS order */
  provider?: SearchProviderId;
  tavily?: string;
  serper?: string;
  serpapi?: string;
  jina?: string;
}

export interface SearchHit { title: string; url: string; snippet: string }
export interface Page { url: string; title?: string; text: string }

export interface Web {
  /** the engine in use; absent when no search key is set (pages can still be read) */
  readonly provider?: SearchProviderId;
  search(query: string, max: number, signal?: AbortSignal): Promise<SearchHit[]>;
  read(url: string, signal?: AbortSignal): Promise<Page>;
}

const TIMEOUT = { search: 20_000, read: 30_000 };
const MAX_PAGE = 400_000;

/** the configured engine, or none */
export function searchProvider(s: SearchSettings = {}): SearchProviderId | undefined {
  if (s.provider && s[s.provider]?.trim()) return s.provider;
  return SEARCH_PROVIDERS.find((p) => s[p]?.trim());
}

/** a list of keys taken in turn; a refused one is dropped */
function pool(raw?: string) {
  const keys = (raw ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  let next = 0;
  return {
    get size() { return keys.length; },
    async use<T>(fn: (key: string) => Promise<T>): Promise<T> {
      let last: unknown = new Error('no key');
      for (let tries = keys.length; tries > 0 && keys.length; tries--) {
        const i = next++ % keys.length, key = keys[i];
        try { return await fn(key); } catch (e) {
          last = e;
          if (!(e as HttpError).refused) throw e;
          keys.splice(i, 1);
        }
      }
      throw last;
    },
  };
}

class HttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  /** the key itself was refused: try another */
  get refused() { return [401, 402, 403, 429, 432, 433].includes(this.status); }
}

async function call(url: string, init: RequestInit & { timeout: number; signal?: AbortSignal }): Promise<Response> {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(init.timeout)]) : AbortSignal.timeout(init.timeout);
  const res = await fetch(url, { ...init, signal });
  if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => ''));
  return res;
}
const json = async (url: string, init: RequestInit & { timeout: number; signal?: AbortSignal }) => (await call(url, init)).json() as Promise<any>;

export function createWeb(s: SearchSettings = {}): Web {
  const provider = searchProvider(s);
  const keys = { tavily: pool(s.tavily), serper: pool(s.serper), serpapi: pool(s.serpapi), jina: pool(s.jina) };

  const engines: Record<SearchProviderId, (q: string, max: number, signal?: AbortSignal) => Promise<SearchHit[]>> = {
    tavily: (q, max, signal) => keys.tavily.use(async (key) => {
      const j = await json('https://api.tavily.com/search', { method: 'POST', timeout: TIMEOUT.search, signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ query: q, max_results: max, search_depth: 'advanced' }) });
      return (j.results ?? []).map((r: any) => ({ title: r.title ?? '', url: r.url, snippet: r.content ?? '' }));
    }),
    serper: (q, max, signal) => keys.serper.use(async (key) => {
      const j = await json('https://google.serper.dev/search', { method: 'POST', timeout: TIMEOUT.search, signal, headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify({ q, num: max }) });
      return (j.organic ?? []).map((r: any) => ({ title: r.title ?? '', url: r.link, snippet: r.snippet ?? '' }));
    }),
    serpapi: (q, max, signal) => keys.serpapi.use(async (key) => {
      const j = await json(`https://serpapi.com/search.json?${new URLSearchParams({ engine: 'google', q, num: String(max), api_key: key })}`, { timeout: TIMEOUT.search, signal });
      return (j.organic_results ?? []).map((r: any) => ({ title: r.title ?? '', url: r.link, snippet: r.snippet ?? '' }));
    }),
    jina: (q, max, signal) => keys.jina.use(async (key) => {
      const j = await json(`https://s.jina.ai/?${new URLSearchParams({ q })}`, { timeout: TIMEOUT.search, signal, headers: { accept: 'application/json', authorization: `Bearer ${key}`, 'x-respond-with': 'no-content' } });
      return (j.data ?? []).slice(0, max).map((r: any) => ({ title: r.title ?? '', url: r.url, snippet: r.description ?? r.content ?? '' }));
    }),
  };

  /** Jina Reader: a page as Markdown, scripts run (works without a key, rate-limited) */
  const jina = async (url: string, signal?: AbortSignal): Promise<Page> => {
    const go = (key?: string) => call(`https://r.jina.ai/${url}`, { timeout: TIMEOUT.read, signal, headers: { accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) } }).then((r) => r.json() as Promise<any>);
    const j = keys.jina.size ? await keys.jina.use(go) : await go();
    const d = j.data ?? j;
    return { url, title: d.title, text: String(d.content ?? '') };
  };
  const tavily = (url: string, signal?: AbortSignal): Promise<Page> => keys.tavily.use(async (key) => {
    const j = await json('https://api.tavily.com/extract', { method: 'POST', timeout: TIMEOUT.read, signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ urls: [url] }) });
    const r = j.results?.[0];
    if (!r?.raw_content) throw new Error(j.failed_results?.[0]?.error || 'nothing extracted');
    return { url, text: String(r.raw_content) };
  });
  /** the page itself: plain text as it is, HTML reduced to its text */
  const direct = async (url: string, signal?: AbortSignal): Promise<Page> => {
    const res = await call(url, { timeout: TIMEOUT.read, signal, headers: { 'user-agent': 'Mozilla/5.0 (Frametell research)', accept: 'text/html,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.5' } });
    const type = res.headers.get('content-type') ?? '';
    if (!/text|json|xml|markdown/.test(type)) throw new Error(`not a text page (${type || 'unknown type'})`);
    const body = await res.text();
    return /html/.test(type) ? { url, title: /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim(), text: htmlText(body) } : { url, text: body };
  };

  return {
    provider,
    async search(q, max, signal) {
      if (!provider) throw new Error('no search engine is configured');
      return (await engines[provider](q, Math.min(Math.max(max, 1), 20), signal)).filter((h) => h.url);
    },
    async read(url, signal) {
      if (!/^https?:\/\//i.test(url)) throw new Error('only http(s) addresses can be read');
      // raw files are read as they are; a page goes through a reader that runs its scripts and returns Markdown
      const raw = /^https:\/\/(raw\.githubusercontent\.com|gist\.githubusercontent\.com)\//.test(url) || /\.(md|markdown|txt|json|ya?ml|csv)(\?|$)/i.test(url);
      const order = raw ? [direct, jina] : [jina, ...(keys.tavily.size ? [tavily] : []), direct];
      const errors: string[] = [];
      for (const way of order) {
        try {
          const p = await way(url, signal);
          if (p.text.trim().length > 80) return { ...p, text: p.text.slice(0, MAX_PAGE) };
          errors.push('empty page');
        } catch (e) {
          if (signal?.aborted) throw e;
          errors.push((e as Error).message);
        }
      }
      throw new Error(`could not read ${url}: ${[...new Set(errors)].join('; ')}`);
    },
  };
}

/** the readable text of an HTML page: scripts, styles and navigation dropped, block elements on their own lines */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<h(\d)[^>]*>/gi, (_, n) => '\n' + '#'.repeat(+n) + ' ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
}
