import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Play, Search, Square } from 'lucide-react';
import { client, type Voice } from '../lib/client';
import { t } from '../i18n';
import { ProviderLogo } from './ProviderLogo';

// The narrator: the voices of every connected voice service, grouped by service. Any voice can be heard from the list
// without choosing it; the chosen one can be heard from the field itself.

const PROVIDER_NAME: Record<Voice['provider'], () => string> = { volcengine: () => t('home.voice.volcengine'), elevenlabs: () => 'ElevenLabs' };
const gender = (v: Voice) => (v.gender === 'female' ? t('home.voice.femaleTag') : v.gender === 'male' ? t('home.voice.maleTag') : '');

/** one sample playing at a time, whichever list or field asked for it */
function usePreview() {
  const [state, setState] = useState<{ id: string; phase: 'loading' | 'playing' } | null>(null);
  const [failed, setFailed] = useState<string>();
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { audio.current?.pause(); }, []);
  const stop = () => { audio.current?.pause(); audio.current = null; setState(null); };
  const toggle = async (v: Voice) => {
    if (state?.id === v.id) return stop();
    stop(); setFailed(undefined);
    setState({ id: v.id, phase: 'loading' });
    const a = new Audio(client.voicePreviewUrl(v));
    audio.current = a;
    a.onended = () => { if (audio.current === a) setState(null); };
    a.onerror = () => { if (audio.current === a) { setState(null); setFailed(v.id); } };
    try { await a.play(); if (audio.current === a) setState({ id: v.id, phase: 'playing' }); } catch { if (audio.current === a) { setState(null); setFailed(v.id); } }
  };
  return { state, failed, toggle, stop };
}

/** three bars that move while a sample plays */
function Bars() {
  return (
    <span className="flex h-3 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => <span key={i} className="w-[2px] origin-bottom rounded-full bg-current motion-safe:animate-[eq_900ms_ease-in-out_infinite]" style={{ animationDelay: `${i * 150}ms`, height: '100%' }} />)}
    </span>
  );
}

function PlayButton({ v, p, size = 'md' }: { v: Voice; p: ReturnType<typeof usePreview>; size?: 'sm' | 'md' }) {
  const on = p.state?.id === v.id;
  const dim = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); void p.toggle(v); }}
      aria-label={on ? t('home.voice.stopPreview', { name: v.name }) : t('home.voice.preview', { name: v.name })}
      className={`${dim} flex shrink-0 items-center justify-center rounded-full transition-colors duration-150 ${on ? 'bg-accent text-accent-fg' : 'bg-ink/[0.06] text-ink-2 hover:bg-ink/[0.1] hover:text-ink'}`}>
      {on && p.state?.phase === 'loading' ? <Loader2 size={12} className="animate-spin" /> : on ? <Bars /> : <Play size={11} className="translate-x-px fill-current" />}
    </button>
  );
}

export function VoicePicker({ id = 'voice', voices, value, onChange, unconfigured = [] }: { id?: string; voices: Voice[]; value?: string; onChange: (id: string) => void; unconfigured?: readonly Voice['provider'][] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const p = usePreview();
  const picked = voices.find((v) => v.id === value);
  const searchable = voices.length > 8;

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (['volcengine', 'elevenlabs'] as const)
      .map((provider) => ({ provider, items: voices.filter((v) => v.provider === provider && (!s || v.name.toLowerCase().includes(s))) }))
      .filter((g) => g.items.length);
  }, [voices, q]);
  const flat = groups.flatMap((g) => g.items);

  useEffect(() => {
    if (!open) return;
    setQ(''); setHi(Math.max(0, voices.findIndex((v) => v.id === value)));
    requestAnimationFrame(() => (searchable ? search.current : list.current)?.focus());
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('mousedown', away);
    return () => removeEventListener('mousedown', away);
  }, [open]);
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hi, open]);
  const choose = (v?: Voice) => { if (!v) return; onChange(v.id); setOpen(false); };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(flat.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(flat[hi]); }
    else if (e.key === ' ' && !searchable && flat[hi]) { e.preventDefault(); void p.toggle(flat[hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); root.current?.querySelector<HTMLButtonElement>(`#${id}`)?.focus(); }
  };

  let i = -1;
  return (
    <div ref={root} className="relative">
      <div className={`flex h-11 items-center gap-1 rounded-[10px] border bg-surface pr-1.5 transition-[border-color,box-shadow] duration-150 ${open ? 'border-accent ring-4 ring-accent/15' : 'border-line hover:border-line-2'}`}>
        <button id={id} type="button" disabled={!voices.length} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-l-[10px] pl-3 text-left outline-none disabled:opacity-50">
          {picked ? <ProviderLogo id={picked.provider} size={18} /> : <span className="h-[18px] w-[18px] rounded-full border border-dashed border-line-2" aria-hidden />}
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{picked ? picked.name : t('home.voice.none')}</span>
          {picked && gender(picked) && <span className="shrink-0 text-[12px] text-ink-3">{gender(picked)}</span>}
          <ChevronDown size={15} className={`mr-1 shrink-0 text-ink-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {picked && <span className="h-5 w-px bg-line" aria-hidden />}
        {picked && <PlayButton v={picked} p={p} size="sm" />}
      </div>
      {p.failed && p.failed === value && <p className="mt-1.5 text-[12px] text-seal" role="alert">{t('home.voice.previewFailed')}</p>}

      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-line bg-surface shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35),0_2px_6px_rgb(0_0_0/0.12)] animate-pop [transform-origin:top]" onKeyDown={keys}>
          {searchable && (
            <label className="flex items-center gap-2 border-b border-line px-3">
              <Search size={14} className="shrink-0 text-ink-3" aria-hidden />
              <span className="sr-only">{t('picker.search')}</span>
              <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('picker.voiceSearch')} spellCheck={false} autoComplete="off" className="h-10 w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
            </label>
          )}
          <div ref={list} tabIndex={-1} role="listbox" aria-label={t('home.voice.label')} aria-activedescendant={flat.length ? `${id}-o${hi}` : undefined} className="max-h-[320px] overflow-y-auto overscroll-contain py-1.5 outline-none">
            {groups.map((g) => (
              <div key={g.provider} role="group" aria-label={PROVIDER_NAME[g.provider]()}>
                {(groups.length > 1 || unconfigured.includes(g.provider)) && <div className="flex items-center gap-2 px-3 pb-1 pt-2.5 text-[11.5px] font-medium text-ink-3"><ProviderLogo id={g.provider} size={13} />{PROVIDER_NAME[g.provider]()}{unconfigured.includes(g.provider) && <span className="ml-auto font-normal">{t('home.voice.noKeyTag')}</span>}</div>}
                {g.items.map((v) => {
                  i++;
                  const idx = i, on = v.id === value;
                  return (
                    <div key={v.provider + v.id} id={`${id}-o${idx}`} data-i={idx} role="option" aria-selected={on} onMouseEnter={() => setHi(idx)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(v)}
                      className={`mx-1.5 flex cursor-pointer items-center gap-3 rounded-lg py-1.5 pl-1.5 pr-2.5 ${hi === idx ? 'bg-ink/[0.06]' : ''}`}>
                      <PlayButton v={v} p={p} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{v.name}</span>
                      {gender(v) && <span className="shrink-0 text-[11.5px] text-ink-3">{gender(v)}</span>}
                      <Check size={14} className={`shrink-0 text-accent-ink ${on ? '' : 'invisible'}`} aria-hidden />
                    </div>
                  );
                })}
              </div>
            ))}
            {!flat.length && <p className="px-4 py-6 text-center text-[12.5px] text-ink-3">{t('picker.noMatch')}</p>}
          </div>
          <p className="border-t border-line px-3.5 py-2 text-[11.5px] text-ink-3">{t('picker.voiceHint')}</p>
        </div>
      )}
    </div>
  );
}
