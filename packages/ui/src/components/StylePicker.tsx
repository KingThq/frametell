import { useEffect, useRef, useState } from 'react';
import { Check, Lock } from 'lucide-react';
import type { StyleInfo } from '../lib/client';
import { STYLE_SWATCH, styleLabel } from '../lib/styles';
import { t } from '../i18n';

// The film's style. When the styles come with pictures (a hosted service's style market gives each a still and a short
// loop from a real film), a wall of 16:9 thumbnails: hovering or focusing one plays its loop. Without pictures (the
// desktop app), a row of chips with each style's colours.

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function StylePicker({ styles, value, onChange, locked }: { styles: StyleInfo[]; value: string; onChange: (id: string) => void; locked: (id: string) => boolean }) {
  if (!styles.some((s) => s.poster)) {
    return (
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('home.style')}>
        {styles.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={value === s.id} className={`fs-chip ${locked(s.id) ? 'text-ink-3' : ''}`} onClick={() => onChange(s.id)}>
            <span className={`flex -space-x-1 ${locked(s.id) ? 'opacity-60' : ''}`} aria-hidden>{(STYLE_SWATCH[s.id] || s.swatch || []).map((c) => <span key={c} className="h-3 w-3 rounded-full ring-1 ring-black/15" style={{ background: c }} />)}</span>
            {styleLabel(s).name}
            {locked(s.id) && <><Lock size={11} className="text-ink-3" aria-hidden /><span className="sr-only">{t('home.styleMembers')}</span></>}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-x-2.5 gap-y-3 sm:grid-cols-4" role="radiogroup" aria-label={t('home.style')}>
      {styles.map((s) => <Tile key={s.id} s={s} on={value === s.id} locked={locked(s.id)} pick={() => onChange(s.id)} />)}
    </div>
  );
}

function Tile({ s, on, locked, pick }: { s: StyleInfo; on: boolean; locked: boolean; pick: () => void }) {
  const [hot, setHot] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const { name, poster, loop } = styleLabel(s);
  const play = hot && !!loop && !reduced();
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (play) { v.currentTime = 0; v.play().catch(() => {}); } else v.pause();
  }, [play]);
  return (
    <button type="button" role="radio" aria-checked={on} onClick={pick}
      onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)} onFocus={() => setHot(true)} onBlur={() => setHot(false)}
      className="group flex flex-col gap-1.5 rounded-[12px] text-left outline-none focus-visible:ring-4 focus-visible:ring-accent/25">
      <span className={`relative block aspect-video w-full overflow-hidden rounded-[10px] bg-paper-2 ring-1 transition-[box-shadow,transform] duration-200 ease-[var(--fs-ease)]
        ${on ? 'ring-2 ring-accent shadow-[var(--fs-shadow-lg)]' : 'ring-line group-hover:-translate-y-0.5 group-hover:shadow-[var(--fs-shadow-lg)]'}`}>
        <img src={poster} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        {loop && hot && <video ref={video} src={loop} muted loop playsInline preload="auto" className="absolute inset-0 h-full w-full object-cover" />}
        {locked && (
          <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-[3px] text-[10.5px] font-medium leading-none text-white">
            <Lock size={10} aria-hidden />{t('home.styleMembers')}
          </span>
        )}
        {on && <span className="absolute bottom-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-fg shadow-sm" aria-hidden><Check size={12} strokeWidth={3} /></span>}
      </span>
      <span className={`truncate px-0.5 text-[12.5px] ${on ? 'font-medium text-ink' : 'text-ink-2 group-hover:text-ink'}`}>{name}</span>
    </button>
  );
}
