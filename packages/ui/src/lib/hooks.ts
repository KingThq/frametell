import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { client, type LoggedEvent, type ProjectView, type VoicesView } from './client';
import { emptyRun, reduce, type RunView } from './run';
import { useT } from '../i18n';

/** fetch once (and on demand); keeps the last good value while reloading */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const reload = useCallback(() => {
    set((s) => ({ ...s, loading: true }));
    fn().then((data) => set({ data, loading: false })).catch((e: Error) => set((s) => ({ ...s, error: e.message, loading: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { ...state, reload };
}

/**
 * The voice list, one copy for the whole panel: opening a voice picker shows it at once instead of 「正在载入音色…」
 * each time. A copy older than VOICES_FRESH is still shown, and fetched again behind it; `reload` (a voice added) and
 * `forgetVoices` (keys or 「我的音色」 changed in Settings) fetch it anew.
 */
const VOICES_FRESH = 60_000;
let voicesCache: { at: number; data?: VoicesView; pending?: Promise<VoicesView> } = { at: 0 };
const voicesSubs = new Set<() => void>();
function fetchVoices(force = false): Promise<VoicesView> | undefined {
  if (voicesCache.pending) return voicesCache.pending;
  if (!force && voicesCache.data && Date.now() - voicesCache.at < VOICES_FRESH) return undefined;
  const pending = client.voices();
  voicesCache = { ...voicesCache, pending };
  pending.then((data) => { voicesCache = { at: Date.now(), data }; }, () => { voicesCache = { ...voicesCache, at: Date.now(), pending: undefined }; })
    .finally(() => voicesSubs.forEach((f) => f()));
  return pending;
}
export function forgetVoices() { voicesCache = { at: 0, data: voicesCache.data }; voicesSubs.forEach((f) => f()); }

export function useVoices() {
  const [state, set] = useState<{ data?: VoicesView; error?: string; loading: boolean }>(() => ({ data: voicesCache.data, loading: !voicesCache.data }));
  const load = useCallback((force = false) => {
    const p = fetchVoices(force);
    if (!p) return;
    set((s) => ({ ...s, loading: true }));
    p.then((data) => set({ data, loading: false }), (e: Error) => set((s) => ({ ...s, error: e.message, loading: false })));
  }, []);
  useEffect(() => {
    // another picker fetched it, or Settings made it stale: follow along
    const on = () => { if (voicesCache.data) set({ data: voicesCache.data, loading: !!voicesCache.pending }); if (!voicesCache.at && !voicesCache.pending) load(); };
    voicesSubs.add(on);
    load();
    return () => { voicesSubs.delete(on); };
  }, [load]);
  return { ...state, reload: useCallback(() => load(true), [load]) };
}

/** a project's live run: replays the event log, then follows it */
export function useRun(project?: ProjectView) {
  // some of the run's text is worded as events arrive, so a language change replays the log from the start
  const { locale } = useT();
  const [run, dispatch] = useReducer((v: RunView, batch: LoggedEvent[] | 'reset') => (batch === 'reset' ? emptyRun() : batch.reduce(reduce, v)), undefined, emptyRun);
  const [conn, setConn] = useState<'open' | 'reconnecting'>('open');
  const buf = useRef<LoggedEvent[]>([]);
  useEffect(() => {
    if (!project) return;
    let raf = 0;
    // batch bursts (a replay can be thousands of events) into one render per frame
    const flush = () => { raf = 0; const b = buf.current; buf.current = []; if (b.length) dispatch(b); };
    buf.current = [];
    dispatch('reset');
    const off = client.subscribe(project.id, 0, (e) => { buf.current.push(e); if (!raf) raf = requestAnimationFrame(flush); }, setConn);
    return () => { off(); cancelAnimationFrame(raf); };
  }, [project?.id, locale]);
  return { run, conn };
}

/** "#/p/<id>" routing */
export function useRoute() {
  const parse = () => { const m = /^#\/p\/([\w-]+)/.exec(location.hash); return m ? { name: 'project' as const, id: m[1] } : { name: 'home' as const }; };
  const [route, setRoute] = useState(parse);
  useEffect(() => { const on = () => setRoute(parse()); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  return route;
}
export const go = (hash: string) => { location.hash = hash; };

/** live clock for elapsed times */
export function useNow(active: boolean, ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [active, ms]);
  return now;
}

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('fs-theme', next ? 'dark' : 'light'); } catch {}
    setDark(next);
  };
  return { dark, toggle };
}
