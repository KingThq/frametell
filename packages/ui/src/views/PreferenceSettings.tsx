import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Info, Loader2, Plus } from 'lucide-react';
import type { PublicSettings, SettingsPatch } from '../lib/client';
import { intlTag, t, type MessageKey } from '../i18n';

// 「创作偏好」: what the user wants in every film, in their own words. The director and the page agents read it in their
// system prompt (packages/agent: preferencesSection). It saves itself a moment after typing stops, and on leaving the
// field or the dialog.

/** MAX_PREFERENCES in @frametell/core's config: the server refuses anything longer */
const MAX = 2000;
const GROUPS = ['voice', 'look', 'shape', 'audience'] as const;

type Saving = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const bare = (line: string) => line.trim().replace(/^[-*•·]\s*/, '');

export function PreferenceSettings({ s, patch }: { s: PublicSettings; patch: (p: SettingsPatch) => Promise<void> }) {
  const [text, setText] = useState(s.preferences ?? '');
  const [state, setState] = useState<Saving>('idle');
  const [err, setErr] = useState('');
  const saved = useRef((s.preferences ?? '').trim());
  const latest = useRef(text);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const field = useRef<HTMLTextAreaElement>(null);

  const save = async (v: string) => {
    clearTimeout(timer.current);
    if (v.trim() === saved.current) { setState((x) => (x === 'dirty' ? 'idle' : x)); return; }
    setState('saving');
    try {
      await patch({ preferences: v });
      saved.current = v.trim();
      // typed on while it saved: that newer text is still to save
      setState(latest.current.trim() === saved.current ? 'saved' : 'dirty');
      setErr('');
    } catch (e) { setErr((e as Error).message); setState('error'); }
  };
  const change = (v: string) => {
    latest.current = v;
    setText(v);
    setState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(v), 700);
  };
  // closing the dialog (or switching section) mid-pause still saves what was typed
  useEffect(() => () => { clearTimeout(timer.current); if (latest.current.trim() !== saved.current) void patch({ preferences: latest.current }).catch(() => {}); }, []);

  const lines = text.split('\n');
  const has = (starter: string) => lines.some((l) => bare(l) === starter);
  const toggle = (starter: string) => {
    if (has(starter)) change(lines.filter((l) => bare(l) !== starter).join('\n').replace(/\n{3,}/g, '\n\n').trim());
    else {
      const next = `${text.trimEnd()}${text.trim() ? '\n' : ''}- ${starter}`;
      if (next.length <= MAX) change(next);
    }
    // keep the new line in view, without taking the focus from the chips
    requestAnimationFrame(() => { const f = field.current; if (f) f.scrollTop = f.scrollHeight; });
  };

  const n = text.length;
  const near = n > MAX * 0.9;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-line pb-5 pl-7 pr-14 pt-6">
        <h3 className="text-[17px] font-semibold text-ink">{t('settings.prefs.title')}</h3>
        <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-3">{t('settings.prefs.desc')}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
        <label htmlFor="prefs" className="fs-label">{t('settings.prefs.label')}</label>
        <div className="overflow-hidden rounded-xl border border-line bg-paper transition-[border-color,box-shadow] duration-150 hover:border-line-2 focus-within:!border-accent focus-within:ring-4 focus-within:ring-accent/15">
          <textarea id="prefs" ref={field} value={text} maxLength={MAX} spellCheck={false} aria-describedby="prefs-status prefs-precedence"
            onChange={(e) => change(e.target.value)} onBlur={() => void save(latest.current)}
            onKeyDown={(e) => { if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(latest.current); } }}
            placeholder={t('settings.prefs.placeholder')}
            className="block max-h-[min(46vh,420px)] min-h-[188px] w-full resize-none bg-transparent px-4 py-3.5 text-[14px] leading-[1.75] text-ink caret-accent outline-none [field-sizing:content] placeholder:text-ink-3" />
          <div className="flex min-h-[40px] items-center justify-between gap-3 border-t border-line bg-surface/60 px-4 py-2 text-[12px]">
            <Status state={state} empty={!text.trim()} err={err} onRetry={() => void save(latest.current)} />
            <span className={`shrink-0 font-mono tabular-nums ${n >= MAX ? 'text-seal' : near ? 'text-accent-ink' : 'text-ink-3'}`} aria-label={`${n} / ${MAX}`}>
              {t('settings.prefs.count', { n: n.toLocaleString(intlTag()), max: MAX.toLocaleString(intlTag()) })}
            </span>
          </div>
        </div>
        <p id="prefs-precedence" className="mt-2.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-ink-3"><Info size={13} className="mt-[3px] shrink-0" aria-hidden />{t('settings.prefs.precedence')}</p>

        <section aria-labelledby="prefs-starters" className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h4 id="prefs-starters" className="text-[13px] font-semibold text-ink">{t('settings.prefs.starters')}</h4>
            <p className="text-[12px] text-ink-3">{t('settings.prefs.startersHint')}</p>
          </div>
          <div className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {GROUPS.map((g) => (
              <div key={g} role="group" aria-labelledby={`prefs-g-${g}`}>
                <p id={`prefs-g-${g}`} className="mb-2 text-[12px] font-medium text-ink-2">{t(`settings.prefs.group.${g}` as MessageKey)}</p>
                <div className="flex flex-col items-start gap-1.5">
                  {(['a', 'b'] as const).map((k) => {
                    const starter = t(`settings.prefs.starter.${g}.${k}` as MessageKey);
                    const on = has(starter);
                    return (
                      <button key={k} type="button" aria-pressed={on} onClick={() => toggle(starter)} title={t(on ? 'settings.prefs.drop' : 'settings.prefs.add', { text: starter })}
                        className="fs-chip h-auto min-h-8 max-w-full py-1.5 text-left leading-snug">
                        {on ? <Check size={13} className="shrink-0" aria-hidden /> : <Plus size={13} className="shrink-0 text-ink-3" aria-hidden />}
                        <span>{starter}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Status({ state, empty, err, onRetry }: { state: Saving; empty: boolean; err: string; onRetry: () => void }) {
  return (
    <p id="prefs-status" role="status" aria-live="polite" className="flex min-w-0 items-center gap-1.5">
      {state === 'saving' ? <><Loader2 size={13} className="shrink-0 animate-spin text-ink-3" aria-hidden /><span className="text-ink-3">{t('settings.prefs.saving')}</span></>
        : state === 'saved' ? <span key="saved" className="flex min-w-0 animate-fade items-center gap-1.5 text-ink-2"><Check size={13} className="shrink-0 text-jade" aria-hidden /><span className="truncate">{t('settings.prefs.saved')}</span></span>
          : state === 'error' ? <span className="flex min-w-0 items-center gap-1.5 text-seal" role="alert">
            <CircleAlert size={13} className="shrink-0" aria-hidden /><span className="truncate" title={err}>{t('settings.prefs.failed')}{err ? ` · ${err}` : ''}</span>
            <button type="button" onClick={onRetry} className="shrink-0 rounded px-1 font-medium text-accent-ink underline-offset-2 hover:underline">{t('settings.prefs.retry')}</button>
          </span>
            : <span className="truncate text-ink-3">{empty ? t('settings.prefs.empty') : t('settings.prefs.applies')}</span>}
    </p>
  );
}
