import { useEffect, useRef, useState } from 'react';
import { ArrowUp, AudioLines, Clock, FileText, Film, Layers, Loader2, Paperclip, Pencil, Plus, Quote, TriangleAlert, X } from 'lucide-react';
import { client, type ProjectView } from '../lib/client';
import { refKey, toSend, type Ref } from '../lib/refs';
import { finished, isWorking, type RunView } from '../lib/run';
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

// While the film is being made, a message waits above the box instead of going in: a note sent mid-run was read only by
// the sessions spoken to after it, and while the pages were drawing that was often none, so it was lost. The queue goes
// to the director as one message when the run comes to rest, and until then it can be edited or removed. It is kept per
// film in this browser, so a reload doesn't lose it (but nothing is sent while no tab is open).
type Queued = { id: string; text: string; refs: Ref[] };
const QUEUE_KEY = (id: string) => `fs:queue:${id}`;
const readQueue = (id: string): Queued[] => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY(id)) || '[]'); } catch { return []; } };
const writeQueue = (id: string, q: Queued[]) => { try { if (q.length) localStorage.setItem(QUEUE_KEY(id), JSON.stringify(q)); else localStorage.removeItem(QUEUE_KEY(id)); } catch { /* private mode */ } };
/** the run has to rest this long before the queue goes: the log of a run under way arrives just after the page opens,
 * and a step can hand over to the next with a beat where nothing runs */
const SETTLE_MS = 1500;

/** one queued message: its words (edited in place) and what it carries */
function QueuedRow({ q, project, onSave, onRemove }: { q: Queued; project: ProjectView; onSave: (text: string) => void; onRemove: () => void }) {
  const { t } = useT();
  const [draft, setDraft] = useState<string>();
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = box.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }, [draft]);
  const save = () => { if (draft != null) onSave(draft.trim()); setDraft(undefined); };
  return (
    <li className="group/q flex items-start gap-2 rounded-xl px-2.5 py-2 hover:bg-ink/[0.035]">
      <div className="min-w-0 flex-1">
        {!!q.refs.length && <div className="mb-1 flex flex-wrap gap-1">{q.refs.map((r) => <RefChip key={refKey(r)} r={r} project={project} />)}</div>}
        {draft != null
          ? <>
              <textarea ref={box} autoFocus value={draft} rows={1} onChange={(e) => setDraft(e.target.value)} onBlur={save} onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)} aria-label={t('conversation.composer.queue.edit')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); }
                  else if (e.key === 'Escape') { e.preventDefault(); setDraft(undefined); }
                }}
                className="block w-full resize-none rounded-lg border border-accent/60 bg-surface px-2 py-1 text-[13px] leading-relaxed text-ink outline-none ring-4 ring-accent/10" />
              <span className="mt-1 block text-[11px] text-ink-3">{t('conversation.composer.queue.save')}</span>
            </>
          : q.text && <p className="line-clamp-3 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{q.text}</p>}
      </div>
      {draft == null && (
        <span className="flex shrink-0 gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover/q:opacity-100">
          <button type="button" className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 hover:bg-ink/[0.08] hover:text-ink" onClick={() => setDraft(q.text)} aria-label={t('conversation.composer.queue.edit')} title={t('conversation.composer.queue.edit')}><Pencil size={12} aria-hidden /></button>
          <button type="button" className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 hover:bg-ink/[0.08] hover:text-ink" onClick={onRemove} aria-label={t('conversation.composer.queue.remove')} title={t('conversation.composer.queue.remove')}><X size={13} aria-hidden /></button>
        </span>
      )}
    </li>
  );
}

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
  const [queue, setQueueState] = useState<Queued[]>(() => readQueue(project.id));
  const [flush, setFlush] = useState<{ sending?: boolean; error?: string }>({});
  const setQueue = (f: (q: Queued[]) => Queued[]) => setQueueState((cur) => { const next = f(cur); writeQueue(project.id, next); return next; });
  const queueRef = useRef(queue); queueRef.current = queue;
  const running = isWorking(run);
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
  const clear = () => { setText(''); for (const x of items) if (x.preview) URL.revokeObjectURL(x.preview); setItems([]); };
  const send = async () => {
    if (!canSend) return;
    // the film is being made (or a queue is still waiting its turn): this one waits too, after the others
    if (running || queue.length) {
      setQueue((q) => [...q, { id: Math.random().toString(36).slice(2, 10), text: text.trim(), refs }]);
      clear(); ref.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await client.say(project.id, text.trim(), toSend(refs));
      clear();
    } catch (e) { setNote((e as Error).message); } finally { setBusy(false); ref.current?.focus(); }
  };

  // the run at rest: the queue goes as one message (each would otherwise start a change of its own), the references
  // gathered, the last voice picked winning
  const sendQueue = async () => {
    const q = queueRef.current;
    if (!q.length) return;
    const text = q.map((x) => x.text).filter(Boolean).join('\n\n');
    const all = new Map<string, Ref>();
    for (const r of q.flatMap((x) => x.refs)) { const k = refKey(r); all.delete(k); all.set(k, r); }
    const voices = [...all.values()].filter((r) => r.kind === 'voice');
    const refs = [...all.values()].filter((r) => r.kind !== 'voice' || r === voices.at(-1));
    setFlush({ sending: true });
    try {
      await client.say(project.id, text, toSend(refs));
      setQueue((cur) => cur.filter((x) => !q.some((y) => y.id === x.id)));   // what was queued while it went stays
      setFlush({});
    } catch (e) { setFlush({ error: (e as Error).message }); }
  };
  useEffect(() => {
    if (running || !queue.length || flush.sending || flush.error) return;
    const t = setTimeout(() => void sendQueue(), SETTLE_MS);
    return () => clearTimeout(t);
  }, [running, queue.length, flush.sending, flush.error]);
  useEffect(() => { if (running) setFlush((f) => (f.error ? {} : f)); }, [running]);

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
      {queue.length > 0 && (
        <section className="mb-2 rounded-2xl border border-line bg-paper px-1.5 pb-1.5 pt-2" aria-label={t('conversation.composer.queue.title', { n: queue.length })}>
          <header className="flex items-center gap-1.5 px-2.5 pb-1 text-[11.5px] text-ink-3">
            {flush.sending ? <Loader2 size={12} className="animate-spin" aria-hidden /> : flush.error ? <TriangleAlert size={12} className="text-seal" aria-hidden /> : <Clock size={12} aria-hidden />}
            <span className="font-medium text-ink-2">{t('conversation.composer.queue.title', { n: queue.length })}</span>
            <span className={`min-w-0 truncate ${flush.error ? 'text-seal' : ''}`} role="status">· {flush.sending ? t('conversation.composer.queue.sending') : flush.error ? t('conversation.composer.queue.failed', { error: flush.error }) : t('conversation.composer.queue.waiting')}</span>
            {flush.error && !running && <button type="button" className="ml-auto shrink-0 rounded-md px-1.5 text-accent-ink hover:bg-ink/[0.06]" onClick={() => void sendQueue()}>{t('conversation.composer.queue.retry')}</button>}
          </header>
          <ol className="max-h-[200px] overflow-y-auto">
            {queue.map((q) => (
              <QueuedRow key={q.id} q={q} project={project}
                onSave={(v) => setQueue((cur) => (v || q.refs.length ? cur.map((x) => (x.id === q.id ? { ...x, text: v } : x)) : cur.filter((x) => x.id !== q.id)))}
                onRemove={() => setQueue((cur) => cur.filter((x) => x.id !== q.id))} />
            ))}
          </ol>
        </section>
      )}
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
          <span className="ml-auto truncate px-1 text-[11.5px] text-ink-3" role="status">{note ?? (pending ? t('conversation.composer.attaching') : (running || queue.length) && (text.trim() || refs.length) ? t('conversation.composer.queueHint') : switchTo ? t(narrated ? 'conversation.composer.voiceSend' : 'conversation.composer.voiceSendEarly') : suggest ? t('conversation.composer.sendHint') : t('conversation.composer.sendHintNewline'))}</span>
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
