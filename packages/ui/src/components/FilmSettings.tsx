import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, ChevronUp, Settings2 } from 'lucide-react';
import { client, hosted, type ProjectView, type Voice } from '../lib/client';
import { useLoad } from '../lib/hooks';
import { useT } from '../i18n';
import { VoiceList, usePreview } from './VoicePicker';

// This film's settings, from the composer: a field that names the narrator, opening a panel above it where any voice
// can be heard and picked. Picking does not switch yet: it puts a 「换成…」 chip in the composer, and sending it has the
// whole film narrated again (nothing is redrawn), together with whatever else the message asks.

type Choice = { provider: Voice['provider']; id: string; name?: string };

export function FilmSettings({ project, narrated, current, pending, onPick, openSettings }: {
  project: ProjectView;
  /** the narration exists already: switching narrates it again */
  narrated: boolean;
  /** the film's narrator now */
  current?: Choice;
  /** a switch waiting in the composer */
  pending?: Choice;
  /** a voice picked (null: back to the current one, the chip goes) */
  onPick: (v: Voice | null) => void;
  openSettings?: (section?: string) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('mousedown', away);
    return () => removeEventListener('mousedown', away);
  }, [open]);
  const shown = pending ?? current;
  const close = () => { setOpen(false); root.current?.querySelector<HTMLButtonElement>('button')?.focus(); };

  return (
    // no `relative` here: the panel lines up with the composer around it, not with this small field
    <div ref={root} className="min-w-0">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} title={t('conversation.film.open')}
        className={`inline-flex h-7 min-w-0 max-w-[200px] items-center gap-1.5 rounded-lg border px-2 text-[12px] transition-colors duration-150 ${open ? 'border-accent/60 bg-accent-soft/50 text-ink' : 'border-line text-ink-2 hover:border-line-2 hover:text-ink'}`}>
        <AudioLines size={13} className={`shrink-0 ${pending ? 'text-accent-ink' : 'text-ink-3'}`} aria-hidden />
        <span className="sr-only">{t('conversation.film.voice')}</span>
        <span className="min-w-0 truncate">{shown ? shown.name || shown.id : t('home.voice.silent')}</span>
        <ChevronUp size={12} className={`shrink-0 text-ink-3 transition-transform duration-200 ${open ? '' : 'rotate-180'}`} aria-hidden />
      </button>
      {open && <Panel project={project} narrated={narrated} current={current} pending={pending} onClose={close} openSettings={openSettings}
        onPick={(v) => { onPick(v && current && v.provider === current.provider && v.id === current.id ? null : v); close(); }} />}
    </div>
  );
}

function Panel({ project, narrated, current, pending, onPick, onClose, openSettings }: {
  project: ProjectView; narrated: boolean; current?: Choice; pending?: Choice; onPick: (v: Voice | null) => void; onClose: () => void; openSettings?: (section?: string) => void;
}) {
  const { t } = useT();
  const voices = useLoad(() => client.voices());
  const p = usePreview();
  const lang = project.lang ?? 'zh';
  // the voices that speak the film's language (on a hosted service, those it can use), and the film's own voice even
  // when it has left the list
  const list = useMemo(() => {
    const all = (voices.data?.voices ?? []).filter((v) => (!v.lang || v.lang === lang) && (!hosted || voices.data?.configured[v.provider]));
    if (current && !all.some((v) => v.provider === current.provider && v.id === current.id)) all.unshift({ provider: current.provider, id: current.id, name: current.name || current.id });
    return all;
  }, [voices.data, lang, current?.id]);
  const unconfigured = voices.data && !hosted ? (['volcengine', 'elevenlabs'] as const).filter((x) => !voices.data!.configured[x]) : [];

  return (
    <div role="dialog" aria-label={t('conversation.film.title')} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      className="absolute inset-x-0 bottom-[calc(100%+8px)] z-30 overflow-hidden rounded-xl border border-line bg-surface shadow-[0_-12px_32px_-8px_rgb(0_0_0/0.35),0_2px_6px_rgb(0_0_0/0.12)] animate-pop [transform-origin:bottom]">
      <header className="flex items-baseline justify-between gap-3 border-b border-line px-3.5 pb-2.5 pt-3">
        <h3 className="text-[13px] font-semibold text-ink">{t('conversation.film.title')}</h3>
        <span className="text-[11.5px] text-ink-3">{t('conversation.film.voice')}</span>
      </header>
      {voices.loading && !voices.data
        ? <p className="px-4 py-8 text-center text-[12.5px] text-ink-3">{t('conversation.film.loading')}</p>
        : voices.error && !voices.data
          ? <p className="px-4 py-6 text-[12.5px] text-seal" role="alert">{voices.error}</p>
          : <VoiceList id="film-voice" voices={list} value={pending?.id ?? current?.id} p={p} silent={false} unconfigured={unconfigured} listClass="max-h-[min(320px,42vh)]"
              onChoose={(v) => onPick(v)} onEscape={onClose} onAdded={(v) => { voices.reload(); onPick(v); }} />}
      <footer className="flex items-start gap-2 border-t border-line bg-paper-2/60 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-ink-3">
        <span className="min-w-0 flex-1">{narrated ? t('conversation.film.costAfter') : t('conversation.film.costBefore')}</span>
        {openSettings && !hosted && (
          <button type="button" onClick={() => { onClose(); openSettings('voice'); }} className="inline-flex shrink-0 items-center gap-1 text-accent-ink hover:underline">
            <Settings2 size={12} aria-hidden />{t('conversation.film.services')}
          </button>
        )}
      </footer>
    </div>
  );
}
