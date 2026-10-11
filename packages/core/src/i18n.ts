// The core's own messages (errors, checks, progress notes) in the user's language. The panel has its own dictionaries;
// the core has few enough strings to keep each one as a zh / en pair where it is used.
import { spawnSync } from 'node:child_process';
import { loadConfig } from './config.js';
import type { Locale, LocalePref } from './types.js';

/** macOS's preferred languages (what the user sees the system in; a terminal's LANG is often en_US regardless) */
let appleLanguage: string | undefined;
function macLanguage(): string {
  if (appleLanguage === undefined) {
    appleLanguage = '';
    if (process.platform === 'darwin') {
      const r = spawnSync('defaults', ['read', '-g', 'AppleLanguages'], { encoding: 'utf8', timeout: 2000 });
      appleLanguage = /"?([a-zA-Z]{2,3}(?:-[\w-]+)?)"?/.exec(r.stdout || '')?.[1] ?? '';
    }
  }
  return appleLanguage;
}

/** the system's language: zh for any Chinese locale, else en — on a Mac its own setting, the same one the panel sees */
export function systemLocale(): Locale {
  const mac = macLanguage();
  if (mac) return /^zh/i.test(mac) ? 'zh' : 'en';
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  const tag = env && env !== 'C' && env !== 'POSIX' ? env : Intl.DateTimeFormat().resolvedOptions().locale;
  return /^zh/i.test(tag) ? 'zh' : 'en';
}

export const resolveLocale = (pref?: LocalePref): Locale => (!pref || pref === 'auto' ? systemLocale() : pref);

/** the language the user chose in settings (or the system's), read fresh so a change applies at once */
export const locale = (): Locale => resolveLocale(loadConfig().locale);

/** pick the message for the current language */
export const tr = (zh: string, en: string): string => (locale() === 'zh' ? zh : en);
