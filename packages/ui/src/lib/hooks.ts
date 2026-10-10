import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { client, type LoggedEvent, type ProjectView } from './client';
import { emptyRun, reduce, type RunView } from './run';

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

/** a project's live run: replays the event log, then follows it */
export function useRun(project?: ProjectView) {
  const [run, dispatch] = useReducer((v: RunView, batch: LoggedEvent[]) => batch.reduce(reduce, v), undefined, emptyRun);
  const [conn, setConn] = useState<'open' | 'reconnecting'>('open');
  const buf = useRef<LoggedEvent[]>([]);
  useEffect(() => {
    if (!project) return;
    let raf = 0;
    // batch bursts (a replay can be thousands of events) into one render per frame
    const flush = () => { raf = 0; const b = buf.current; buf.current = []; if (b.length) dispatch(b); };
    const off = client.subscribe(project.id, 0, (e) => { buf.current.push(e); if (!raf) raf = requestAnimationFrame(flush); }, setConn);
    return () => { off(); cancelAnimationFrame(raf); };
  }, [project?.id]);
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
