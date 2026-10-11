// Where requests go: all outbound traffic through the user's HTTP proxy, when they set one (their own base URL per
// provider is the model catalog's). The proxy covers this process (global fetch: Pi, voices, model lists) and the
// agent CLIs it spawns (Claude Code and Codex read HTTPS_PROXY); local addresses never go through it.
import { Agent, Dispatcher, ProxyAgent, setGlobalDispatcher } from 'undici';

const LOCAL = 'localhost,127.0.0.1,::1';
/** the proxy Studio last set; a proxy the user's own environment already had is left alone until they set one here */
let applied: string | undefined;

/** the proxy for everything but local origins (the Studio server, the render page), which always go direct */
class Split extends Dispatcher {
  constructor(private proxied: Dispatcher, private direct: Dispatcher) { super(); }
  dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler) {
    const host = new URL(String(opts.origin)).hostname;
    return (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) ? this.direct : this.proxied).dispatch(opts, handler);
  }
  async close() { await Promise.all([this.proxied.close(), this.direct.close()]); }
  async destroy() { await Promise.all([this.proxied.destroy(), this.direct.destroy()]); }
}

/** route this process and its children through `proxy` (http://host:port, optionally with user:pass@), or directly */
export function applyProxy(proxy?: string) {
  const p = proxy?.trim() || undefined;
  if (p === applied) return;
  applied = p;
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) { if (p) process.env[k] = p; else delete process.env[k]; }
  if (p) { process.env.NO_PROXY = process.env.no_proxy = LOCAL; } else { delete process.env.NO_PROXY; delete process.env.no_proxy; }
  setGlobalDispatcher(p ? new Split(new ProxyAgent(p), new Agent()) : new Agent());
}

/** "http://user:secret@host:7890" → "http://user:••••@host:7890" */
export function maskProxy(p?: string): string {
  if (!p) return '';
  try { const u = new URL(p); if (u.password) u.password = '••••'; return decodeURIComponent(u.toString()).replace(/\/$/, ''); } catch { return p; }
}
