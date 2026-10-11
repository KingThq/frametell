// Interface language. Dictionaries live in i18n/<locale>/<namespace>.ts; Chinese is the source and every other locale
// is typed against it. Components call useT(); plain helpers (run.ts, describe.ts) call t() directly, which reads the
// same current locale, so they follow along when a component re-renders.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Locale, LocalePref } from '@frametell/core/types';
import zh from './zh';
import en from './en';

export type { Locale, LocalePref };
type Dict = typeof zh;
type Msg = string | ((v: never) => string);
/** "home.title", "stage.status.drawing", … */
type Key<T, P extends string = ''> = { [K in keyof T & string]: T[K] extends Msg ? `${P}${K}` : Key<T[K], `${P}${K}.`> }[keyof T & string];
export type MessageKey = Key<Dict>;
type At<T, K extends string> = K extends `${infer H}.${infer R}` ? (H extends keyof T ? At<T[H], R> : never) : K extends keyof T ? T[K] : never;
type Vars<K extends MessageKey> = At<Dict, K> extends (v: infer V) => string ? [vars: V] : [vars?: Record<string, string | number>];

const DICTS: Record<Locale, Dict> = { zh, en };
const STORE = 'fs-locale';

export const systemLocale = (): Locale => (/^zh/i.test(typeof navigator !== 'undefined' ? navigator.language : '') ? 'zh' : 'en');
export const resolve = (pref: LocalePref): Locale => (pref === 'auto' ? systemLocale() : pref);

function stored(): LocalePref {
  try { const v = localStorage.getItem(STORE); if (v === 'zh' || v === 'en') return v; } catch {}
  return 'auto';
}

let current: Locale = resolve(stored());
const apply = (l: Locale) => { current = l; if (typeof document !== 'undefined') document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'; };
apply(current);

export const getLocale = () => current;
/** BCP 47 tag for Intl (dates, numbers) */
export const intlTag = () => (current === 'zh' ? 'zh-CN' : 'en-US');

/** a message in the current language; "{name}" in a string is filled from vars, a function message is called with them */
export function t<K extends MessageKey>(key: K, ...[vars]: Vars<K>): string {
  let m: unknown = DICTS[current];
  for (const part of (key as string).split('.')) m = (m as Record<string, unknown> | undefined)?.[part];
  if (m === undefined) { m = DICTS.zh; for (const part of (key as string).split('.')) m = (m as Record<string, unknown> | undefined)?.[part]; }
  if (typeof m === 'function') return (m as (v: unknown) => string)(vars);
  if (typeof m !== 'string') return key;
  return vars ? m.replace(/\{(\w+)\}/g, (s, k: string) => (k in (vars as object) ? String((vars as Record<string, unknown>)[k]) : s)) : m;
}

const Ctx = createContext<{ locale: Locale; pref: LocalePref; setPref: (p: LocalePref) => void }>({ locale: current, pref: 'auto', setPref: () => {} });

export function LocaleProvider({ children, initial }: { children: React.ReactNode; initial?: Promise<LocalePref | undefined> }) {
  const [pref, setPrefState] = useState<LocalePref>(stored);
  const [locale, setLocale] = useState<Locale>(current);
  const setPref = useCallback((p: LocalePref) => {
    try { if (p === 'auto') localStorage.removeItem(STORE); else localStorage.setItem(STORE, p); } catch {}
    const l = resolve(p);
    apply(l);
    setPrefState(p);
    setLocale(l);
  }, []);
  // the saved setting wins over this browser's cache once it arrives
  useEffect(() => { initial?.then((p) => { if (p && p !== stored()) setPref(p); }).catch(() => {}); }, []);
  return <Ctx.Provider value={{ locale, pref, setPref }}>{children}</Ctx.Provider>;
}

/** t plus the current locale; using it makes the component re-render when the language changes */
export function useT() {
  const { locale, pref, setPref } = useContext(Ctx);
  return { t, locale, pref, setPref };
}
