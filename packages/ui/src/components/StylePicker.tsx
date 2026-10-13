import { useEffect, useRef, useState } from 'react';
import { Check, LayoutGrid, Lock, X } from 'lucide-react';
import type { StyleInfo } from '../lib/client';
import { STYLE_SWATCH, styleLabel } from '../lib/styles';
import { t } from '../i18n';

// The film's style. When the styles come with pictures (a hosted service's style market gives each a still and a short
// loop from a real film), a row of 16:9 thumbnails — the chosen style and a few others — ending in one that opens every
// style in a dialog, grouped free / members; hovering or focusing a thumbnail plays its loop. Without pictures (the
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
  return <Wall styles={styles} value={value} onChange={onChange} locked={locked} />;
}

/** how many thumbnails the row shows before the one that opens them all */
const ROW = 4;

function Wall({ styles, value, onChange, locked }: { styles: StyleInfo[]; value: string; onChange: (id: string) => void; locked: (id: string) => boolean }) {
  const [open, setOpen] = useState(false);
  // the chosen style always shows, in its place among the first few or in the last slot
  const row = styles.slice(0, ROW);
  const chosen = styles.find((s) => s.id === value);
  if (chosen && !row.includes(chosen)) row[ROW - 1] = chosen;
  const all = styles.length > ROW;
  return (
    <>
      <div className={`grid grid-cols-2 gap-x-2.5 gap-y-3 ${all ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`} role="radiogroup" aria-label={t('home.style')}>
        {row.map((s) => <Tile key={s.id} s={s} on={value === s.id} locked={locked(s.id)} pick={() => onChange(s.id)} />)}
        {all && (
          <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
            className="group flex flex-col gap-1.5 rounded-[12px] text-left outline-none focus-visible:ring-4 focus-visible:ring-accent/25">
            <span className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-[10px] bg-paper-2 ring-1 ring-line transition-[box-shadow,transform] duration-200 ease-[var(--fs-ease)] group-hover:-translate-y-0.5 group-hover:shadow-[var(--fs-shadow-lg)]">
              <span className="absolute inset-0 grid grid-cols-3 grid-rows-2 gap-px opacity-45 transition-opacity group-hover:opacity-70" aria-hidden>
                {styles.filter((s) => !row.includes(s)).slice(0, 6).map((s) => <img key={s.id} src={styleLabel(s).poster} alt="" loading="lazy" className="h-full w-full object-cover" />)}
              </span>
              <span className="relative inline-flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-[12px] font-medium text-white"><LayoutGrid size={12} aria-hidden />{t('home.styleAll', { n: styles.length })}</span>
            </span>
            <span className="truncate px-0.5 text-[12.5px] text-ink-2 group-hover:text-ink">{t('home.styleBrowse')}</span>
          </button>
        )}
      </div>
      {open && <AllStyles styles={styles} value={value} locked={locked} onClose={() => setOpen(false)} pick={(id) => { onChange(id); setOpen(false); }} />}
    </>
  );
}

/** every style, in a dialog: free ones first, then the members' */
function AllStyles({ styles, value, locked, pick, onClose }: { styles: StyleInfo[]; value: string; locked: (id: string) => boolean; pick: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const groups = [
    { key: 'free', title: t('home.styleFree'), list: styles.filter((s) => s.tier !== 'member') },
    { key: 'member', title: t('home.styleMemberGroup'), list: styles.filter((s) => s.tier === 'member') },
  ].filter((g) => g.list.length);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="all-styles-title"
      onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
      className="m-auto max-h-[min(860px,calc(100vh-48px))] w-[min(1080px,calc(100vw-32px))] max-w-none overflow-hidden rounded-[16px] bg-paper p-0 text-ink shadow-[var(--fs-shadow-lg)] backdrop:bg-black/55 open:animate-[fade_160ms_ease-out]">
      <div className="flex max-h-[inherit] flex-col">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <h2 id="all-styles-title" className="text-[15px] font-semibold">{t('home.styleDialog')}</h2>
          <span className="text-[12.5px] text-ink-3">{t('home.styleAll', { n: styles.length })}</span>
          <button type="button" className="fs-icon-btn ml-auto" onClick={() => ref.current?.close()} aria-label={t('home.styleClose')}><X size={16} aria-hidden /></button>
        </header>
        <div className="overflow-y-auto px-5 pb-6 pt-4">
          {groups.map((g) => (
            <section key={g.key} className="mt-2 first:mt-0" aria-label={g.title}>
              {groups.length > 1 && <h3 className="mb-2.5 mt-3 text-[12px] font-medium uppercase tracking-[.06em] text-ink-3">{g.title}</h3>}
              <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4" role="radiogroup" aria-label={g.title}>
                {g.list.map((s) => <Tile key={s.id} s={s} on={value === s.id} locked={locked(s.id)} pick={() => pick(s.id)} summary />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}

function Tile({ s, on, locked, pick, summary }: { s: StyleInfo; on: boolean; locked: boolean; pick: () => void; summary?: boolean }) {
  const [hot, setHot] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const { name, poster, loop, summary: line } = styleLabel(s);
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
      {summary && line && <span className="-mt-1 line-clamp-2 px-0.5 text-[11.5px] leading-snug text-ink-3">{line}</span>}
    </button>
  );
}
