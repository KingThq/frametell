import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useT } from '../i18n';

// A frame at full size, to read every detail: click zooms in where you point, drag pans, the wheel zooms, ←/→ steps
// through the set, Esc closes. Used for the film's frames and the director's self-check sheet.

export interface LightItem { src: string; title: string; caption?: string }

const MAX = 4;

export function Lightbox({ items, index, onIndex, onClose, actions }: {
  items: LightItem[]; index: number; onIndex: (i: number) => void; onClose: () => void; actions?: (item: LightItem, i: number) => React.ReactNode;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const item = items[index];
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => setZ({ s: 1, x: 0, y: 0 }), [index]);
  const go = (d: number) => { const n = index + d; if (n >= 0 && n < items.length) onIndex(n); };

  /** zoom to `s` keeping the point under (cx, cy) — relative to the stage centre — where it is */
  const zoomAt = (s: number, cx = 0, cy = 0) => setZ((cur) => {
    const ns = Math.min(MAX, Math.max(1, s));
    if (ns === 1) return { s: 1, x: 0, y: 0 };
    const k = ns / cur.s;
    return { s: ns, x: cx - (cx - cur.x) * k, y: cy - (cy - cur.y) * k };
  });
  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2] as const;
  };

  return (
    <dialog ref={ref} onClose={onClose} aria-label={item?.title}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
        else if (e.key === '+' || e.key === '=') zoomAt(z.s * 1.5);
        else if (e.key === '-') zoomAt(z.s / 1.5);
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 text-ink backdrop:bg-[rgb(10_10_10/0.96)] open:animate-[fade_160ms_ease-out]">
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-3 px-5 py-3 text-paper">
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-medium text-white">{item?.title}</p>
            {item?.caption && <p className="mt-0.5 truncate text-[12.5px] text-white/60">{item.caption}</p>}
          </div>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {item && actions?.(item, index)}
            <button className="fs-lb-btn" onClick={() => zoomAt(z.s / 1.5)} disabled={z.s <= 1} aria-label={t('stage.lightbox.zoomOut')}><ZoomOut size={16} /></button>
            <span className="w-11 text-center text-[12px] tabular text-white/70">{Math.round(z.s * 100)}%</span>
            <button className="fs-lb-btn" onClick={() => zoomAt(z.s * 1.5)} disabled={z.s >= MAX} aria-label={t('stage.lightbox.zoomIn')}><ZoomIn size={16} /></button>
            {items.length > 1 && <span className="ml-2 w-12 text-center text-[12px] tabular text-white/70">{index + 1} / {items.length}</span>}
            <button className="fs-lb-btn ml-1" onClick={() => ref.current?.close()} aria-label={t('stage.lightbox.close')}><X size={17} /></button>
          </span>
        </header>
        <div ref={stage} className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden ${z.s > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
          onWheel={(e) => { const [cx, cy] = local(e); zoomAt(z.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), cx, cy); }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: z.x, oy: z.y, moved: false }; }}
          onPointerMove={(e) => {
            const d = drag.current; if (!d) return;
            if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
            if (d.moved && z.s > 1) setZ((cur) => ({ ...cur, x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
          }}
          onPointerUp={(e) => {
            const d = drag.current; drag.current = null;
            if (d && !d.moved) { const [cx, cy] = local(e); z.s > 1 ? zoomAt(1) : zoomAt(2.5, cx, cy); }
          }}>
          {item?.src && <img key={item.src} src={item.src} alt={item.title} draggable={false}
            className="absolute inset-0 m-auto max-h-full max-w-full object-contain px-4 pb-4 transition-transform duration-150 ease-out will-change-transform"
            style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }} />}
          {index > 0 && <button className="fs-lb-btn absolute left-4 top-1/2 h-11 w-11 -translate-y-1/2" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={() => go(-1)} aria-label={t('stage.lightbox.prev')}><ChevronLeft size={20} /></button>}
          {index < items.length - 1 && <button className="fs-lb-btn absolute right-4 top-1/2 h-11 w-11 -translate-y-1/2" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={() => go(1)} aria-label={t('stage.lightbox.next')}><ChevronRight size={20} /></button>}
        </div>
        <p className="pb-3 text-center text-[11.5px] text-white/45">{t('stage.lightbox.hint')}</p>
      </div>
    </dialog>
  );
}
