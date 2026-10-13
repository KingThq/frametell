import { useEffect, useState } from 'react';
import { hosted } from '../lib/client';
import { isWorking, money, type RunView } from '../lib/run';
import { useT } from '../i18n';

/** a hosted service's credits, read on load, every half minute and whenever the tab comes back into view (a film spends
 * as it is made); null without billing or until the first read */
export function useCredits() {
  const credits = hosted?.credits;
  const [state, setState] = useState<{ available: number; held?: number; perMinute: number; plan?: string; styles?: string[] | null } | null>(null);
  useEffect(() => {
    if (!credits) return;
    let alive = true;
    const read = () => { if (!document.hidden) credits.read().then((s) => { if (alive) setState(s); }, () => {}); };
    read();
    const timer = setInterval(read, 30_000);
    document.addEventListener('visibilitychange', read);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', read); };
  }, [credits]);
  return state && credits ? { ...state, url: credits.url } : null;
}

/** what a film has spent on a hosted service, and what is still set aside for it while it is being made (read again
 * every ten seconds while it is being made); null elsewhere, and until the service has answered */
export function useFilmCredits(project: string, run: RunView) {
  const spent = hosted?.credits?.spent;
  const working = isWorking(run);
  const [v, setV] = useState<{ spent: number; held: number } | null>(null);
  useEffect(() => {
    if (!spent) return;
    let alive = true;
    const read = () => { if (!document.hidden) spent(project).then((r) => { if (alive) setV(r); }, () => {}); };
    read();
    // and once more as it stops: its last charges land, and what was set aside goes back, a moment after
    const timer = working ? setInterval(read, 10_000) : setTimeout(read, 3_000);
    return () => { alive = false; clearInterval(timer); };
  }, [spent, project, working]);
  return v;
}

/** what a film has spent, as a line of text: on a hosted service its credits, never money; elsewhere what it cost.
 * null until a hosted service has answered, or without billing */
export function useSpent(project: string, run: RunView) {
  const { t, locale } = useT();
  const v = useFilmCredits(project, run);
  if (!hosted) return money(run.cost);
  return v == null ? null : t('common.credits', { n: v.spent.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US') });
}

/** on a hosted service, what this film has spent and, while it is being made, what is set aside for it: the balance
 * the top bar shows has already let go of that, so it is said here rather than leaving the balance to look short */
export function FilmCredits({ project, run }: { project: string; run: RunView }) {
  const { t, locale } = useT();
  const v = useFilmCredits(project, run);
  if (!v) return null;
  const fmt = (n: number) => n.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US');
  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-[12.5px] tabular">
      <span className="text-ink-3" title={t('common.filmSpentTitle')}>{t('common.filmSpent', { n: fmt(v.spent) })}</span>
      {v.held > 0 && (
        <>
          <span className="h-3 w-px bg-line-2" aria-hidden />
          <span className="cursor-help text-accent-ink underline decoration-accent/40 decoration-dotted underline-offset-4" tabIndex={0}
            title={t('common.filmHeldTitle', { n: fmt(v.held) })} aria-label={`${t('common.filmHeld', { n: fmt(v.held) })}. ${t('common.filmHeldTitle', { n: fmt(v.held) })}`}>
            {t('common.filmHeld', { n: fmt(v.held) })}
          </span>
        </>
      )}
    </span>
  );
}

/** the balance, quiet in the top bar: what is left to spend, only to read (billing is in the account menu); below a
 * minute of film it says so. A div, not a span: the Cloud shell hides the header's titled spans (the email) */
export function Credits() {
  const { t, locale } = useT();
  const state = useCredits();
  const credits = hosted?.credits;
  if (!credits || !state) return null;
  const low = state.available < state.perMinute;
  const fmt = (n: number) => Math.max(0, n).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US');
  const held = state.held ?? 0;
  return (
    <div title={held > 0 ? t('common.creditsHeldTitle', { n: fmt(held) }) : t('common.creditsTitle')}
      className={`hidden h-8 shrink-0 cursor-default select-none items-center gap-2 rounded-lg border px-2.5 text-[12.5px] tabular-nums sm:inline-flex ${low ? 'border-seal/40 text-seal' : 'border-line text-ink-2'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${low ? 'bg-seal' : 'bg-accent'}`} aria-hidden />
      {t('common.creditsLeft', { n: fmt(state.available) })}
      {low && <span className="sr-only">{t('common.creditsLow')}</span>}
    </div>
  );
}
