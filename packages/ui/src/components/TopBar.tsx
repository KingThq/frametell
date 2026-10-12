import { LogOut, Moon, Settings2, Sun } from 'lucide-react';
import { Wordmark } from './Logo';
import { useTheme } from '../lib/hooks';
import { useT } from '../i18n';
import { hosted } from '../lib/client';
import { Credits } from './Credits';

export function TopBar({ children, onSettings }: { children?: React.ReactNode; onSettings: () => void }) {
  const { dark, toggle } = useTheme();
  const { t } = useT();
  // desktop app on macOS: the window has no title bar, so the top bar leaves room for the traffic lights and drags the window
  const macDesktop = typeof window !== 'undefined' && window.studioBridge?.platform === 'darwin';
  return (
    <header className={`sticky top-0 z-20 flex h-[52px] shrink-0 items-center gap-4 border-b border-line bg-paper/90 px-4 backdrop-blur-md ${macDesktop ? 'pl-[84px] [-webkit-app-region:drag] [&_a]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag]' : ''}`}>
      <a href="#/" className="shrink-0 rounded-lg" aria-label={t('common.home')}><Wordmark /></a>
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      <button className="fs-icon-btn" onClick={toggle} aria-label={dark ? t('common.toLight') : t('common.toDark')} title={dark ? t('common.light') : t('common.dark')}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
      {hosted ? (
        <>
          <Credits />
          {hosted.email && <span className="hidden max-w-[220px] truncate text-[12.5px] text-ink-3 sm:inline" title={hosted.email}>{hosted.email}</span>}
          <button className="fs-icon-btn" onClick={() => hosted?.signOut()} aria-label={t('common.signOut')} title={t('common.signOut')}><LogOut size={16} /></button>
        </>
      ) : (
        <button className="fs-icon-btn" onClick={onSettings} aria-label={t('common.settings')} title={t('common.settings')}><Settings2 size={16} /></button>
      )}
    </header>
  );
}
