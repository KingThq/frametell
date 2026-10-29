import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Search, Settings2 } from 'lucide-react';
import type { ModelInfo } from '../lib/client';
import { t, type MessageKey } from '../i18n';
import { ProviderLogo } from './ProviderLogo';

// The model to make a film with: pick a connected provider on the left, then one of its models on the right. The search
// spans every provider (each shows how many of its models match) and moves to one that has a match; an id the provider
// does not list can be typed in and used as it is.

export const modelKey = (m: Pick<ModelInfo, 'provider' | 'id'>) => `${m.provider}/${m.id}`;
/** a provider by the name Studio gives it (「Claude」, not Pi's 「Anthropic」); the user's own endpoints keep theirs */
export const nameOf = (m: Pick<ModelInfo, 'provider' | 'providerName'>) => { const k = `providers.name.${m.provider}`; const n = t(k as MessageKey); return n === k ? m.providerName : n; };

export function ModelPicker({ id = 'model', models, value, onChange, onAdd, onManage, disabled }: {
  id?: string;
  models: ModelInfo[];
  value?: string;
  onChange: (key: string) => void;
  /** use an id the provider does not list: save it for that provider, then pick it */
  onAdd?: (provider: string, modelId: string) => Promise<void> | void;
  onManage?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [cur, setCur] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const picked = models.find((m) => modelKey(m) === value);

  // the connected providers in the order models come, each with its models matching the search
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const by = new Map<string, { provider: string; name: string; items: ModelInfo[] }>();
    for (const m of models) {
      if (!by.has(m.provider)) by.set(m.provider, { provider: m.provider, name: nameOf(m), items: [] });
      if (!s || `${m.name} ${m.id} ${m.providerName} ${nameOf(m)}`.toLowerCase().includes(s)) by.get(m.provider)!.items.push(m);
    }
    return [...by.values()];
  }, [models, q]);
  // the provider shown on the right: the one chosen, unless the search left it empty and another has a match
  const chosen = groups.find((g) => g.provider === cur);
  const active = chosen && (chosen.items.length || !q.trim() || !groups.some((g) => g.items.length)) ? chosen : groups.find((g) => g.items.length) || groups[0];
  const typed = q.trim();
  const exact = models.some((m) => m.id === typed || modelKey(m) === typed);
  // a typed id no provider lists: offer it on the provider shown
  const offer = onAdd && active && typed && !exact && /^[\w./:@-]+$/.test(typed) ? { provider: active.provider, name: active.name } : undefined;
  const flat = [...(active?.items || []).map((m) => ({ kind: 'model' as const, m })), ...(offer ? [{ kind: 'add' as const, o: offer }] : [])];

  useEffect(() => {
    if (!open) return;
    setQ(''); setCur(picked?.provider || models[0]?.provider);
    requestAnimationFrame(() => search.current?.focus());
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('mousedown', away);
    return () => removeEventListener('mousedown', away);
  }, [open]);
  // on opening or switching provider, light the model in use if it is there, else the first
  useEffect(() => { setHi(Math.max(0, flat.findIndex((x) => x.kind === 'model' && modelKey(x.m) === value))); }, [q, active?.provider, open]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hi, open]);
  useEffect(() => { list.current?.scrollTo({ top: 0 }); }, [active?.provider]);

  const choose = async (i: number) => {
    const x = flat[i];
    if (!x) return;
    if (x.kind === 'model') onChange(modelKey(x.m));
    else { await onAdd?.(x.o.provider, typed); onChange(`${x.o.provider}/${typed}`); }
    setOpen(false);
  };
  const step = (d: number) => {
    const at = groups.findIndex((g) => g.provider === active?.provider);
    const next = groups[(at + d + groups.length) % groups.length];
    if (next) setCur(next.provider);
  };

  let i = -1;
  return (
    <div ref={root} className="relative">
      <button id={id} type="button" disabled={disabled} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}
        className="flex h-11 w-full items-center gap-2.5 rounded-[10px] border border-line bg-surface pl-3 pr-2.5 text-left transition-[border-color,box-shadow] duration-150 hover:border-line-2 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/15 disabled:opacity-50">
        {picked ? <ProviderLogo id={picked.provider} name={nameOf(picked)} size={18} /> : <span className="h-[18px] w-[18px] rounded-full border border-dashed border-line-2" aria-hidden />}
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{picked ? picked.name : value ? value.split('/').slice(1).join('/') : t('picker.none')}</span>
        {picked && <span className="hidden shrink-0 text-[12px] text-ink-3 sm:inline">{nameOf(picked)}</span>}
        <ChevronDown size={15} className={`shrink-0 text-ink-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-line bg-surface shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35),0_2px_6px_rgb(0_0_0/0.12)] animate-pop [transform-origin:top]"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(flat.length - 1, h + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
            else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !q) { e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1); }
            else if (e.key === 'Tab' && groups.length > 1) { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
            else if (e.key === 'Enter') { e.preventDefault(); void choose(hi); }
            else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); root.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
          }}>
          <label className="flex items-center gap-2 border-b border-line px-3">
            <Search size={14} className="shrink-0 text-ink-3" aria-hidden />
            <span className="sr-only">{t('picker.search')}</span>
            <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('picker.searchHint')} spellCheck={false} autoComplete="off"
              className="h-10 w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
              role="combobox" aria-expanded aria-controls={`${id}-list`} aria-activedescendant={flat.length ? `${id}-o${hi}` : undefined} />
          </label>
          <div className="flex flex-col sm:h-[320px] sm:flex-row">
            {groups.length > 1 && (
              <div role="tablist" aria-orientation="vertical" aria-label={t('picker.providers')}
                className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-1.5 sm:w-44 sm:flex-col sm:overflow-y-auto sm:overflow-x-visible sm:border-b-0 sm:border-r">
                {groups.map((g) => {
                  const on = g.provider === active?.provider, empty = !!typed && !g.items.length;
                  return (
                    <button key={g.provider} type="button" role="tab" aria-selected={on} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setCur(g.provider)}
                      className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors ${on ? 'bg-ink/[0.07] text-ink' : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink'} ${empty && !on ? 'opacity-45' : ''}`}>
                      <ProviderLogo id={g.provider} name={g.name} size={14} />
                      <span className="min-w-0 flex-1 truncate">{g.name}</span>
                      {picked?.provider === g.provider && !typed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
                      {typed && <span className="shrink-0 text-[11px] tabular-nums text-ink-3">{g.items.length}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <div ref={list} id={`${id}-list`} role="listbox" aria-label={active?.name} className="max-h-[320px] min-w-0 flex-1 overflow-y-auto overscroll-contain py-1.5 sm:max-h-none">
              {active?.items.map((m) => {
                i++;
                const idx = i, on = modelKey(m) === value;
                return (
                  <div key={m.id} id={`${id}-o${idx}`} data-i={idx} role="option" aria-selected={on} onMouseEnter={() => setHi(idx)} onMouseDown={(e) => e.preventDefault()} onClick={() => void choose(idx)}
                    className={`mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 ${hi === idx ? 'bg-ink/[0.06]' : ''}`}>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-[13px] text-ink">{m.name}</span>
                        {m.recommended && <span className="shrink-0 rounded-[5px] bg-accent-soft px-1.5 text-[10.5px] leading-[17px] text-accent-ink">{t('picker.recommended')}</span>}
                        {!m.vision && <span className="shrink-0 text-[11px] text-ink-3">{t('picker.noVision')}</span>}
                      </span>
                      {m.name !== m.id && <span className="block truncate font-mono text-[11px] text-ink-3">{m.id}</span>}
                    </span>
                    {on && <Check size={14} className="shrink-0 text-accent-ink" aria-hidden />}
                  </div>
                );
              })}
              {offer && (() => {
                i++;
                const idx = i;
                return (
                  <div role="group" aria-label={t('picker.useTyped')} className={active?.items.length ? 'mt-1 border-t border-line pt-1.5' : ''}>
                    <div id={`${id}-o${idx}`} data-i={idx} role="option" aria-selected={false} onMouseEnter={() => setHi(idx)} onMouseDown={(e) => e.preventDefault()} onClick={() => void choose(idx)}
                      className={`mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${hi === idx ? 'bg-ink/[0.06]' : ''}`}>
                      <Plus size={14} className="shrink-0 text-ink-3" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-ink-2">{t('picker.useOn', { id: typed, provider: offer.name })}</span>
                    </div>
                  </div>
                );
              })()}
              {!flat.length && <p className="px-4 py-6 text-center text-[12.5px] text-ink-3">{models.length ? t('picker.noMatch') : t('picker.noProvider')}</p>}
            </div>
          </div>
          {onManage && (
            <button type="button" onClick={() => { setOpen(false); onManage(); }} className="flex w-full items-center gap-2 border-t border-line px-3.5 py-2.5 text-left text-[12.5px] text-ink-2 transition-colors hover:bg-ink/[0.04] hover:text-ink">
              <Settings2 size={13} aria-hidden /> {t('picker.manage')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
