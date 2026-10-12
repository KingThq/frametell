import { useEffect, useState } from 'react';
import { hosted } from '../lib/client';
import { isWorking, money, type RunView } from '../lib/run';
import { useT } from '../i18n';

/** a hosted service's credits, read on load, every half minute and whenever the tab comes back into view (a film spends
 * as it is made); null without billing or until the first read */
export function useCredits() {
  const credits = hosted?.credits;
  const [state, setState] = useState<{ available: number; perMinute: number; plan?: string; styles?: string[] | null } | null>(null);
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

/** what a film has spent, as the panel shows it: on a hosted service its credits (read again every ten seconds while
 * it is being made), never money; elsewhere what it cost. null until a hosted service has answered, or without billing */
export function useSpent(project: string, run: RunView) {
  const { t, locale } = useT();
  const spent = hosted?.credits?.spent;
  const working = isWorking(run);
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!spent) return;
    let alive = true;
    const read = () => { if (!document.hidden) spent(project).then((v) => { if (alive) setN(v); }, () => {}); };
    read();
    // and once more as it stops: its last charges land a moment after
    const timer = working ? setInterval(read, 10_000) : setTimeout(read, 3_000);
    return () => { alive = false; clearInterval(timer); };
  }, [spent, project, working]);
  if (!hosted) return money(run.cost);
  return n == null ? null : t('common.credits', { n: n.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US') });
}

/** the balance, quiet in the top bar, linking to billing; below a minute of film it says so */
export function Credits() {
  const { t, locale } = useT();
  const state = useCredits();
  const credits = hosted?.credits;
  if (!credits || !state) return null;
  const low = state.available < state.perMinute;
  const n = Math.max(0, state.available).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US');
  return (
    <a href={credits.url} target="_top" title={t('common.creditsTitle')}
      className={`hidden h-8 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-[12.5px] tabular-nums transition-colors duration-150 sm:inline-flex ${low ? 'border-seal/40 text-seal hover:border-seal/70' : 'border-line text-ink-2 hover:border-line-2 hover:text-ink'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${low ? 'bg-seal' : 'bg-accent'}`} aria-hidden />
      {t('common.credits', { n })}
      {low && <span className="sr-only">{t('common.creditsLow')}</span>}
    </a>
  );
}
