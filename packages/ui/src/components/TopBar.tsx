import { Moon, Settings2, Sun } from 'lucide-react';
import { Wordmark } from './Logo';
import { useTheme } from '../lib/hooks';

export function TopBar({ children, onSettings }: { children?: React.ReactNode; onSettings: () => void }) {
  const { dark, toggle } = useTheme();
  // desktop app on macOS: the window has no title bar, so the top bar leaves room for the traffic lights and drags the window
  const macDesktop = typeof window !== 'undefined' && window.studioBridge?.platform === 'darwin';
  return (
    <header className={`sticky top-0 z-20 flex h-[52px] shrink-0 items-center gap-4 border-b border-line bg-paper/90 px-4 backdrop-blur-md ${macDesktop ? 'pl-[84px] [-webkit-app-region:drag] [&_a]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag]' : ''}`}>
      <a href="#/" className="shrink-0 rounded-lg" aria-label="Frametell 首页"><Wordmark /></a>
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      <button className="fs-icon-btn" onClick={toggle} aria-label={dark ? '切换为浅色' : '切换为深色'} title={dark ? '浅色' : '深色'}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
      <button className="fs-icon-btn" onClick={onSettings} aria-label="设置" title="设置"><Settings2 size={16} /></button>
    </header>
  );
}
