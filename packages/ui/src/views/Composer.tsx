import { useEffect, useRef, useState } from 'react';
import { ArrowUp, AudioLines, FileText, Film, Layers, Loader2, Paperclip, Plus, Quote, TriangleAlert, X } from 'lucide-react';
import { client, type ProjectView } from '../lib/client';
import { refKey, toSend, type Ref } from '../lib/refs';
import { finished, type RunView } from '../lib/run';
import { Lightbox, type LightItem } from './Lightbox';
import { FilmSettings } from '../components/FilmSettings';
import { useT } from '../i18n';

// The message box to the director. Above the words sits a tray of references — the pages, lines and frames picked on
// the workbench, files attached, pasted or dropped — so a change request points at exactly what it means.

const MAX_REFS = 8;
const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.md,.markdown,.txt,.pdf,.docx,.pptx,.epub';
const isImage = (name: string) => /\.(png|jpe?g|webp|gif)$/i.test(name);

/** a chip in the tray, waiting for its upload, or failed */
type Item = { key: string; ref?: Ref; name?: string; preview?: string; error?: string };

/** one reference as a chip: a picture when it has one, else its kind; the label tells which */
export function RefChip({ r, project, onRemove, onOpen, pending, error, name, preview }: {
  r?: Ref; project: ProjectView; onRemove?: () => void; onOpen?: () => void; pending?: boolean; error?: string; name?: string; preview?: string;
}) {
  const { t } = useT();
  const img = preview ?? (r?.thumb ? client.fileUrl(project, r.thumb) : r?.kind === 'frame' ? client.fileUrl(project, r.path) : r?.kind === 'file' && r.image ? client.fileUrl(project, r.path) : undefined);
  const Icon = error ? TriangleAlert : r?.kind === 'page' ? Layers : r?.kind === 'line' ? Quote : r?.kind === 'frame' ? Film : r?.kind === 'voice' ? AudioLines : FileText;
  const label = r ? (r.kind === 'line' ? `${r.label}` : r.label) : name ?? '';
  const full = error ? t('conversation.composer.chipError', { name: name ?? '', error }) : r?.kind === 'line' ? t('conversation.composer.chipLine', { label: r.label, text: r.text }) : label;
  const Body = onOpen ? 'button' : 'span';
  return (
    <span className={`group/chip inline-flex h-7 max-w-full animate-pop items-center gap-1.5 rounded-lg border pl-1 text-[12px] ${onRemove ? 'pr-0.5' : 'pr-2'} ${error ? 'border-seal/40 bg-seal/[0.06] text-seal' : 'border-line bg-paper-2 text-ink-2'}`} title={full}>
      <Body type={onOpen ? 'button' : undefined} onClick={onOpen} className="inline-flex min-w-0 items-center gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent">
        {img && !error
          ? <span className="relative h-5 w-[30px] shrink-0 overflow-hidden rounded-[4px] bg-ink/10"><img src={img} alt="" className="h-full w-full object-cover" />{pending && <span className="absolute inset-0 flex items-center justify-center bg-black/40"><Loader2 size={11} className="animate-spin text-white" aria-hidden /></span>}</span>
          : <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-ink/[0.06]">{pending ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <Icon size={11} aria-hidden />}</span>}
        <span className="min-w-0 max-w-[180px] truncate">{label}</span>
      </Body>
      {onRemove && <button type="button" onClick={onRemove} aria-label={t('conversation.composer.remove', { label })} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-ink/[0.08] hover:text-ink"><X size={12} aria-hidden /></button>}
    </span>
  );
}

export function Composer({ run, project, viewing, openSettings }: { run: RunView; project: ProjectView; viewing?: Ref; openSettings?: (section?: string) => void }) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [note, setNote] = useState<string>();
  const [light, setLight] = useState<LightItem | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const focus = () => requestAnimationFrame(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });

  const add = (r: Ref) => setItems((cur) => {
    const k = refKey(r);
    if (r.kind === 'voice') return [...cur.filter((x) => x.key !== k), { key: k, ref: r }];   // one voice: the latest choice
    if (cur.some((x) => x.key === k)) return cur;
    if (cur.length >= MAX_REFS) { setNote(t('conversation.composer.maxRefs', { n: MAX_REFS })); return cur; }
    return [...cur, { key: k, ref: r }];
  });
  // the workbench hands over pages, lines and frames; “change this page”-style prompts still prefill the words
  useEffect(() => {
    const onRef = (e: Event) => { add((e as CustomEvent<Ref>).detail); focus(); };
    const onCompose = (e: Event) => { const t = (e as CustomEvent<string>).detail; setText((cur) => (cur.trim() ? cur : t)); focus(); };
    addEventListener('studio:ref', onRef); addEventListener('studio:compose', onCompose);
    return () => { removeEventListener('studio:ref', onRef); removeEventListener('studio:compose', onCompose); };
  }, []);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(undefined), 2600); return () => clearTimeout(t); }, [note]);
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'; }, [text]);

  const upload = (files: File[]) => {
    const room = MAX_REFS - items.length;
    if (files.length > room) setNote(t('conversation.composer.maxRefsDropped', { n: MAX_REFS }));
    for (const f of files.slice(0, Math.max(0, room))) {
      const key = `up:${f.name}:${f.size}:${Math.random().toString(36).slice(2, 7)}`;
      const preview = isImage(f.name) ? URL.createObjectURL(f) : undefined;
      setItems((cur) => [...cur, { key, name: f.name, preview }]);
      client.attach(project.id, f)
        .then((r) => setItems((cur) => cur.map((x) => (x.key === key ? { key: refKey(r), ref: r, preview } : x))))
        .catch((e: Error) => setItems((cur) => cur.map((x) => (x.key === key ? { ...x, error: e.message } : x))));
    }
    focus();
  };

  const refs = items.filter((x) => x.ref && !x.error).map((x) => x.ref!);
  const pending = items.some((x) => !x.ref && !x.error);
  const canSend = (!!text.trim() || refs.length > 0) && !busy && !pending;
  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      await client.say(project.id, text.trim(), toSend(refs));
      setText('');
      for (const x of items) if (x.preview) URL.revokeObjectURL(x.preview);
      setItems([]);
    } catch (e) { setNote((e as Error).message); } finally { setBusy(false); ref.current?.focus(); }
  };

  const open = (x: Item) => {
    const r = x.ref;
    const src = x.preview ?? (r?.kind === 'frame' ? client.fileUrl(project, r.path) : r?.kind === 'file' && r.image ? client.fileUrl(project, r.path) : undefined);
    if (src) setLight({ src, title: r?.label ?? x.name ?? '', caption: r?.kind === 'frame' ? r.text : undefined });
  };
  const suggest = viewing && !items.some((x) => x.key === refKey(viewing)) ? viewing : undefined;
  // the narrator: the one the user last switched to, else the one the film was made with; a switch waiting in the tray
  const voice = run.voice ?? project.voice;
  const switchTo = items.find((x) => x.ref?.kind === 'voice')?.ref as Extract<Ref, { kind: 'voice' }> | undefined;
  const narrated = run.stages.narrate.status === 'done';

  const placeholder = t(run.awaitingApproval ? 'conversation.composer.placeholder.approval'
    : finished(run) && !run.current ? (items.length ? 'conversation.composer.placeholder.finishedWithItems' : 'conversation.composer.placeholder.finished')
    : run.paused ? 'conversation.composer.placeholder.paused'
    : run.current ? 'conversation.composer.placeholder.running'
    : 'conversation.composer.placeholder.idle');

  return (
    <form className="px-4 pb-4" onSubmit={(e) => { e.preventDefault(); void send(); }}
      onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) upload([...e.dataTransfer.files]); }}>
      <div className={`relative rounded-2xl border bg-surface shadow-[var(--fs-shadow-sm)] transition-[border-color,box-shadow] duration-150 focus-within:border-accent/70 focus-within:ring-4 focus-within:ring-accent/10 ${drag ? 'border-accent ring-4 ring-accent/15' : 'border-line'}`}>
        {items.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-line/70 px-2.5 pb-2 pt-2.5" aria-label={t('conversation.composer.tray')}>
            {items.map((x) => (
              <RefChip key={x.key} r={x.ref} project={project} name={x.name} preview={x.preview} pending={!x.ref && !x.error} error={x.error}
                onOpen={(x.preview || x.ref?.kind === 'frame' || (x.ref?.kind === 'file' && x.ref.image)) ? () => open(x) : undefined}
                onRemove={() => setItems((cur) => cur.filter((y) => y.key !== x.key))} />
            ))}
          </div>
        )}
        <label htmlFor="say" className="sr-only">{t('conversation.composer.label')}</label>
        <textarea id="say" ref={ref} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
            else if (e.key === 'Backspace' && !text && items.length && e.currentTarget.selectionStart === 0) setItems((cur) => cur.slice(0, -1));
          }}
          onPaste={(e) => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); upload(files); } }}
          className="block max-h-[160px] min-h-[52px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-3" />
        <div className="flex items-center gap-1.5 px-2 pb-2">
          <button type="button" className="fs-icon-btn" onClick={() => picker.current?.click()} aria-label={t('conversation.composer.attach')} title={t('conversation.composer.attachTitle')}><Paperclip size={15} /></button>
          <input ref={picker} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { upload([...(e.target.files || [])]); e.target.value = ''; }} />
          <FilmSettings project={project} narrated={narrated} current={voice} pending={switchTo} openSettings={openSettings}
            onPick={(v) => {
              if (!v) setItems((cur) => cur.filter((x) => x.ref?.kind !== 'voice'));
              else add({ kind: 'voice', label: t('conversation.composer.voiceTo', { name: v.name }), provider: v.provider, id: v.id, name: v.name });
              focus();
            }} />
          {suggest && (
            <button type="button" onClick={() => { add(suggest); focus(); }} title={t('conversation.composer.add', { label: suggest.label })}
              className="inline-flex h-7 min-w-0 items-center gap-1 rounded-lg border border-dashed border-line-2 px-2 text-[12px] text-ink-3 transition-colors hover:border-accent/60 hover:text-ink">
              <Plus size={12} aria-hidden /><span className="truncate">{suggest.label.split(/[「“]/)[0].trim()}</span>
            </button>
          )}
          <span className="ml-auto truncate px-1 text-[11.5px] text-ink-3" role="status">{note ?? (pending ? t('conversation.composer.attaching') : switchTo ? t(narrated ? 'conversation.composer.voiceSend' : 'conversation.composer.voiceSendEarly') : suggest ? t('conversation.composer.sendHint') : t('conversation.composer.sendHintNewline'))}</span>
          <button type="submit" disabled={!canSend} aria-label={t('conversation.composer.send')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg transition-[opacity,transform] duration-150 disabled:opacity-30 active:scale-95">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ArrowUp size={16} strokeWidth={2.5} aria-hidden />}
          </button>
        </div>
        {drag && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-accent-soft/85 text-[13px] font-medium text-accent-ink backdrop-blur-[2px]">
            {t('conversation.composer.drop')}
          </div>
        )}
      </div>
      {light && <Lightbox items={[light]} index={0} onIndex={() => {}} onClose={() => setLight(null)} />}
    </form>
  );
}
