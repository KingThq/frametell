import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Check, ImagePlus, Images, Library, Loader2, RotateCcw, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import { client, type LibraryAsset, type ProjectView, type UserAsset } from '../lib/client';
import { ASSET_ACCEPT, ASSET_MAX_COUNT, assetPath, assetThumbPath, fmtBytes, makeThumb, nameOf, refuse, isSvgFile } from '../lib/assets';
import type { Ref } from '../lib/refs';
import { Lightbox } from './Lightbox';
import { t as tr, useT } from '../i18n';

// The film's assets (素材): pictures given to be seen in the film. A drawer over the workbench, opened from the stage's
// toolbar (or the composer's “Add assets”, the studio:assets event): a large drop zone, the film's assets as cards (the
// small copy on a checked ground, so a transparent logo shows its edges), each with its name and a note for the
// director, and “Put in the film”, which hands it to the composer as a reference with a sentence ready to send. A host
// with an account-wide library (Cloud 素材库) gets a second tab to copy one in.

// ── the film's list, shared by the toolbar's count and the drawer ─────────────────────────────────────────────────────

type Store = { list?: UserAsset[]; error?: string; loading?: boolean };
const stores = new Map<string, Store>();
const listeners = new Map<string, Set<() => void>>();
const emit = (id: string, next: Store) => { stores.set(id, next); listeners.get(id)?.forEach((f) => f()); };
const load = (id: string) => {
  const cur = stores.get(id) ?? {};
  emit(id, { ...cur, loading: true });
  client.assets(id)
    .then((list) => emit(id, { list }))
    .catch((e: Error) => emit(id, { ...stores.get(id), loading: false, error: e.message }));
};
/** put one in the list, or replace the one with its file (the same picture uploaded again comes back as that one) */
const upsert = (id: string, a: UserAsset) => {
  const cur = stores.get(id)?.list ?? [];
  emit(id, { list: cur.some((x) => x.file === a.file) ? cur.map((x) => (x.file === a.file ? a : x)) : [...cur, a] });
};
const drop = (id: string, file: string) => emit(id, { list: (stores.get(id)?.list ?? []).filter((x) => x.file !== file) });

const EMPTY: Store = {};
function useFilmAssets(id: string) {
  const sub = useCallback((f: () => void) => {
    let set = listeners.get(id); if (!set) listeners.set(id, (set = new Set()));
    set.add(f);
    return () => { set!.delete(f); };
  }, [id]);
  const store = useSyncExternalStore(sub, () => stores.get(id) ?? EMPTY);
  useEffect(() => { if (!stores.get(id)?.list) load(id); }, [id]);
  return store;
}

const OPEN_EVENT = 'studio:assets';

/** the toolbar's button: 素材, with how many the film has */
export function AssetsButton({ project, size = 'fs-btn-sm' }: { project: ProjectView; size?: string }) {
  useT();
  const { list } = useFilmAssets(project.id);
  const n = list?.length ?? 0;
  return (
    <button type="button" className={`fs-btn fs-btn-ghost ${size}`} onClick={() => dispatchEvent(new CustomEvent(OPEN_EVENT))} title={tr('assets.buttonTitle')} aria-haspopup="dialog">
      <Images size={14} aria-hidden /> {n ? tr('assets.buttonCount', { n }) : tr('assets.button')}
    </button>
  );
}

// ── the drawer ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** an upload on its way (or failed): its own small copy shown at once */
type Up = { key: string; file: File; name: string; preview?: string; thumb?: Blob; error?: string };

/** the drawer, mounted with the workbench and opened by the studio:assets event; `onRef` hands a reference to the composer */
export function AssetsPanel({ project, onRef }: { project: ProjectView; onRef: (r: Ref) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    addEventListener(OPEN_EVENT, on);
    return () => removeEventListener(OPEN_EVENT, on);
  }, []);
  const shut = useCallback(() => setOpen(false), []);
  if (!open) return null;
  return createPortal(<Drawer project={project} onRef={onRef} onClose={shut} />, document.body);
}

function Drawer({ project, onRef, onClose }: { project: ProjectView; onRef: (r: Ref) => void; onClose: () => void }) {
  const { t } = useT();
  const id = project.id;
  const store = useFilmAssets(id);
  const list = store.list;
  const [tab, setTab] = useState<'film' | 'library'>('film');
  const [ups, setUps] = useState<Up[]>([]);
  const [note, setNote] = useState<string>();
  const [drag, setDrag] = useState(false);
  const [light, setLight] = useState<number | null>(null);
  const [fresh, setFresh] = useState<string>();
  const picker = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const back = useRef<Element | null>(document.activeElement);
  const lib = client.assetLibrary;

  // read again each time it opens: something added in another tab, or by the host, shows up
  useEffect(() => { load(id); }, [id]);
  useEffect(() => { requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()); }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && light === null && !e.defaultPrevented) close(); };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [light]);
  useEffect(() => { if (!note) return; const h = setTimeout(() => setNote(undefined), 5200); return () => clearTimeout(h); }, [note]);
  useEffect(() => () => { for (const u of upsRef.current) if (u.preview) URL.revokeObjectURL(u.preview); }, []);
  const upsRef = useRef(ups); upsRef.current = ups;
  const listRef = useRef(list); listRef.current = list;
  const refTo = useRef(onRef); refTo.current = onRef;   // the workbench hands a new function each render

  const close = () => { onClose(); (back.current as HTMLElement | null)?.focus?.(); };

  const send = (u: Up) => {
    setUps((cur) => cur.map((x) => (x.key === u.key ? { ...x, error: undefined } : x)));
    client.addAsset(id, u.file, { name: u.name, thumb: u.thumb })
      .then((a) => {
        upsert(id, a);
        setFresh(a.file);
        setUps((cur) => cur.filter((x) => x.key !== u.key));
        if (u.preview) URL.revokeObjectURL(u.preview);
      })
      .catch((e: Error) => setUps((cur) => cur.map((x) => (x.key === u.key ? { ...x, error: e.message } : x))));
  };

  const upload = (files: File[]) => {
    const refused: string[] = [];
    const ok = files.filter((f) => {
      const why = refuse(f);
      if (why) refused.push(tr(why === 'type' ? 'assets.refused.type' : 'assets.refused.size', { name: f.name }));
      return !why;
    });
    const room = ASSET_MAX_COUNT - (listRef.current?.length ?? 0) - upsRef.current.length;
    if (ok.length > room) refused.push(tr('assets.refused.full', { n: ASSET_MAX_COUNT }));
    setNote(refused.length ? refused.join(' · ') : undefined);
    if (tab !== 'film') setTab('film');
    for (const f of ok.slice(0, Math.max(0, room))) {
      const u: Up = { key: `${f.name}:${f.size}:${Math.random().toString(36).slice(2, 7)}`, file: f, name: nameOf(f), preview: isSvgFile(f) ? URL.createObjectURL(f) : undefined };
      setUps((cur) => [...cur, u]);
      // the small copy first: it is what the card shows at once, and what goes up with the picture
      void makeThumb(f).then((thumb) => {
        const preview = u.preview ?? (thumb ? URL.createObjectURL(thumb) : URL.createObjectURL(f));
        const ready = { ...u, thumb, preview };
        setUps((cur) => cur.map((x) => (x.key === u.key ? ready : x)));
        send(ready);
      });
    }
  };

  // stable callbacks taking the asset's file, so a change to one card re-renders only that card
  const put = useCallback((file: string) => {
    const a = listRef.current?.find((x) => x.file === file); if (!a) return;
    refTo.current({ kind: 'file', label: a.name, path: assetPath(a), image: true, asset: true, thumb: assetThumbPath(a) });
    dispatchEvent(new CustomEvent('studio:compose', { detail: tr('assets.putText', { name: a.name }) }));
    onClose();   // the composer takes the focus
  }, [onClose]);
  const openAt = useCallback((file: string) => { const i = listRef.current?.findIndex((x) => x.file === file) ?? -1; if (i >= 0) setLight(i); }, []);
  const save = useCallback(async (file: string, patch: { name?: string; note?: string }) => { upsert(id, await client.updateAsset(id, file, patch)); }, [id]);
  const remove = useCallback(async (file: string) => { await client.removeAsset(id, file); drop(id, file); }, [id]);

  const count = (list?.length ?? 0);
  const items = list ?? [];
  const lightItems = useMemo(() => items.map((a) => ({ src: client.fileUrl(project, assetPath(a)), title: a.name, caption: a.note || undefined })), [items, project]);

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) upload([...e.dataTransfer.files]); };

  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <div className="absolute inset-0 bg-[rgb(10_10_10/0.28)] animate-fade" onClick={close} aria-hidden />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="fs-assets-title"
        className="absolute inset-y-0 right-0 flex w-[min(640px,100vw)] flex-col border-l border-line bg-paper shadow-[-24px_0_48px_-24px_rgb(0_0_0/0.35)] animate-slide"
        onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }}
        onDrop={onDrop}>
        <header className="flex items-start gap-3 px-6 pb-3 pt-5">
          <div className="min-w-0 flex-1">
            <h2 id="fs-assets-title" className="flex items-baseline gap-2.5 font-display text-[26px] leading-tight tracking-[-0.01em] text-ink">
              {t('assets.title')}
              {count > 0 && <span className="font-sans text-[13px] font-medium tabular text-ink-3">{t('assets.count', { n: count })}</span>}
            </h2>
            <p className="mt-1 max-w-[52ch] text-[12.5px] leading-relaxed text-ink-3">{t('assets.intro')}</p>
          </div>
          <button type="button" className="fs-icon-btn -mr-2 shrink-0" onClick={close} aria-label={t('assets.close')}><X size={17} /></button>
        </header>
        {lib && (
          <div className="px-6 pb-3">
            <div className="inline-flex rounded-lg bg-ink/[0.05] p-0.5" role="tablist" aria-label={t('assets.tabs')}>
              {([['film', t('assets.film'), Images], ['library', t('assets.library'), Library]] as const).map(([k, l, Icon]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors ${tab === k ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink'}`}>
                  <Icon size={13} aria-hidden />{l}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
          {tab === 'film' ? (
            <>
              <DropZone drag={drag} full={count + ups.length >= ASSET_MAX_COUNT} onPick={() => picker.current?.click()} />
              <input ref={picker} type="file" multiple accept={ASSET_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden
                onChange={(e) => { upload([...(e.target.files || [])]); e.target.value = ''; }} />
              {note && <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-seal-soft px-3 py-2 text-[12.5px] leading-relaxed text-seal" role="alert"><TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />{note}</p>}
              {store.error && !list && <p className="mt-6 text-[12.5px] text-seal" role="alert">{t('assets.loadFailed', { error: store.error })}</p>}
              {!list && !store.error && <p className="mt-6 flex items-center gap-1.5 text-[12.5px] text-ink-3"><Loader2 size={13} className="animate-spin" aria-hidden />{t('assets.loading')}</p>}
              {(items.length > 0 || ups.length > 0) && (
                <ul className="mt-5 grid grid-cols-1 gap-4 min-[420px]:grid-cols-2" aria-label={t('assets.film')}>
                  {items.map((a) => <AssetCard key={a.file} a={a} project={project} fresh={a.file === fresh} onPut={put} onOpen={openAt} onSave={save} onRemove={remove} />)}
                  {ups.map((u) => <UploadCard key={u.key} u={u} onRetry={() => send(u)} onDismiss={() => { if (u.preview) URL.revokeObjectURL(u.preview); setUps((cur) => cur.filter((x) => x.key !== u.key)); }} />)}
                </ul>
              )}
            </>
          ) : (
            <LibraryGrid project={project} inFilm={items} onUsed={(a) => { upsert(id, a); setFresh(a.file); setTab('film'); }} />
          )}
        </div>
      </div>
      {light !== null && lightItems[light] && (
        <Lightbox items={lightItems} index={light} onIndex={setLight} onClose={() => setLight(null)}
          actions={(_, i) => (
            <button type="button" className="mr-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/90 px-3.5 text-[12.5px] font-medium text-black transition-colors hover:bg-white"
              onClick={() => { const a = items[i]; setLight(null); if (a) put(a.file); }}>
              <ImagePlus size={14} aria-hidden />{t('assets.put')}
            </button>
          )} />
      )}
    </div>
  );
}

/** the large place to drop pictures; a click (or Enter) opens the file picker */
function DropZone({ drag, full, onPick }: { drag: boolean; full: boolean; onPick: () => void }) {
  const { t } = useT();
  return (
    <button type="button" data-autofocus onClick={onPick} disabled={full}
      className={`group flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed px-6 py-9 text-center transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60
        ${drag ? 'border-accent bg-accent-soft/70' : 'border-line-2 bg-surface hover:border-accent/60 hover:bg-accent-soft/30'}`}>
      <span className={`grid h-12 w-12 place-items-center rounded-full transition-colors duration-200 ${drag ? 'bg-accent text-accent-fg' : 'bg-ink/[0.05] text-ink-2 group-hover:bg-accent/15 group-hover:text-accent-ink'}`}>
        <Upload size={20} aria-hidden />
      </span>
      <span className="mt-1 text-[14.5px] font-medium text-ink">{full ? t('assets.drop.full', { n: ASSET_MAX_COUNT }) : drag ? t('assets.drop.release') : t('assets.drop.title')}</span>
      {!full && !drag && <span className="text-[12.5px] text-ink-3">{t('assets.drop.or')} <span className="font-medium text-accent-ink underline-offset-2 group-hover:underline">{t('assets.drop.pick')}</span></span>}
      <span className="text-[11.5px] text-ink-3">{t('assets.drop.formats')}</span>
    </button>
  );
}

const TYPE_LABEL: Record<UserAsset['type'], string> = { png: 'PNG', jpg: 'JPG', webp: 'WebP', gif: 'GIF', svg: 'SVG' };

/** a picture on the checked ground, in a box of a fixed shape so the grid doesn't jump while it loads */
function Picture({ src, alt, busy }: { src?: string; alt: string; busy?: boolean }) {
  return (
    <span className="fs-checker relative block aspect-[4/3] w-full overflow-hidden">
      {src && <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} className="absolute inset-0 h-full w-full object-contain p-4" />}
      {busy && <span className="absolute inset-0 grid place-items-center bg-[rgb(10_10_10/0.28)]"><Loader2 size={20} className="animate-spin text-white" aria-hidden /></span>}
    </span>
  );
}

/** one of the film's assets: its picture (a click shows it large), name and note edited in place, and what to do with it */
const AssetCard = memo(function AssetCard({ a, project, fresh, onPut, onOpen, onSave, onRemove }: {
  a: UserAsset; project: ProjectView; fresh: boolean;
  onPut: (file: string) => void; onOpen: (file: string) => void;
  onSave: (file: string, patch: { name?: string; note?: string }) => Promise<void>; onRemove: (file: string) => Promise<void>;
}) {
  const { t } = useT();
  const [name, setName] = useState(a.name);
  const [note, setNote] = useState(a.note);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => setName(a.name), [a.name]);
  useEffect(() => setNote(a.note), [a.note]);

  const commit = async (patch: { name?: string; note?: string }) => {
    if ((patch.name === undefined || patch.name === a.name) && (patch.note === undefined || patch.note === a.note)) return;
    setSaving(true); setError(undefined);
    try { await onSave(a.file, patch); }
    catch (e) { setError(t('assets.saveFailed', { error: (e as Error).message })); setName(a.name); setNote(a.note); }
    finally { setSaving(false); }
  };
  const del = async () => {
    setRemoving(true); setError(undefined);
    try { await onRemove(a.file); }
    catch (e) { setError(t('assets.removeFailed', { error: (e as Error).message })); setRemoving(false); setConfirm(false); }
  };

  return (
    <li className={`flex flex-col overflow-hidden rounded-xl border bg-surface transition-colors duration-150 hover:border-line-2 ${fresh ? 'animate-pop border-accent/50' : 'border-line'} ${removing ? 'opacity-50' : ''}`}>
      <button type="button" className="relative block outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" onClick={() => onOpen(a.file)} aria-label={t('assets.open', { name: a.name })}>
        <Picture src={client.fileUrl(project, assetThumbPath(a))} alt="" />
        <span className="fs-tag absolute left-2 top-2 border-line bg-surface/90 text-ink-2">{TYPE_LABEL[a.type] ?? a.type}</span>
      </button>
      <div className="flex flex-1 flex-col gap-1 border-t border-line/70 px-3 pb-3 pt-2.5">
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label={t('assets.nameOf', { name: a.name })}
          onBlur={() => { const v = name.trim(); if (!v) setName(a.name); else void commit({ name: v }); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur(); else if (e.key === 'Escape') { e.preventDefault(); setName(a.name); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); } }}
          className="-mx-1.5 w-[calc(100%+12px)] rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[13.5px] font-medium text-ink outline-none transition-colors hover:border-line focus:border-accent/70 focus:bg-paper" />
        <textarea value={note} maxLength={200} rows={2} onChange={(e) => setNote(e.target.value)} placeholder={t('assets.notePlaceholder')} aria-label={t('assets.noteOf', { name: a.name })}
          onBlur={() => void commit({ note: note.trim() })}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === 'Escape') { e.preventDefault(); setNote(a.note); } }}
          className="-mx-1.5 w-[calc(100%+12px)] resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[12.5px] leading-snug text-ink-2 outline-none transition-colors placeholder:text-ink-3/80 hover:border-line focus:border-accent/70 focus:bg-paper" />
        <p className="flex items-center gap-1.5 text-[11.5px] tabular text-ink-3">
          {t('assets.size', { w: a.w, h: a.h })} · {fmtBytes(a.bytes)}
          {saving && <Loader2 size={11} className="animate-spin" aria-hidden />}
          {a.type === 'gif' && <span className="truncate" title={t('assets.gif')}>· {t('assets.gif')}</span>}
        </p>
        {error && <p className="text-[11.5px] text-seal" role="alert">{error}</p>}
        <div className="mt-auto flex items-center gap-1.5 pt-2">
          {confirm ? (
            <span className="flex w-full items-center gap-1.5 animate-fade">
              <span className="mr-auto text-[12.5px] text-ink-2">{t('assets.confirmRemove')}</span>
              <button type="button" autoFocus className="fs-btn fs-btn-ghost fs-btn-sm" onClick={() => setConfirm(false)} disabled={removing}>{t('assets.confirmNo')}</button>
              <button type="button" className="fs-btn fs-btn-sm border border-seal/40 bg-seal-soft text-seal hover:bg-seal/15" onClick={() => void del()} disabled={removing}>
                {removing && <Loader2 size={12} className="animate-spin" aria-hidden />}{t('assets.confirmYes')}
              </button>
            </span>
          ) : (
            <>
              <button type="button" className="fs-btn fs-btn-secondary fs-btn-sm flex-1" onClick={() => onPut(a.file)} title={t('assets.putTitle')}>
                <ImagePlus size={13} aria-hidden />{t('assets.put')}
              </button>
              <button type="button" className="fs-icon-btn h-[30px] w-[30px] hover:text-seal" onClick={() => setConfirm(true)} aria-label={t('assets.removeOf', { name: a.name })} title={t('assets.remove')}><Trash2 size={14} /></button>
            </>
          )}
        </div>
      </div>
    </li>
  );
});

/** an upload on its way, shown by its own small copy; or failed, to try again or let go */
function UploadCard({ u, onRetry, onDismiss }: { u: Up; onRetry: () => void; onDismiss: () => void }) {
  const { t } = useT();
  return (
    <li className={`flex flex-col overflow-hidden rounded-xl border bg-surface animate-pop ${u.error ? 'border-seal/40' : 'border-line'}`} aria-busy={!u.error}>
      <Picture src={u.preview} alt="" busy={!u.error} />
      <div className="flex flex-1 flex-col gap-1 border-t border-line/70 px-3 pb-3 pt-2.5">
        <p className="truncate text-[13.5px] font-medium text-ink" title={u.file.name}>{u.name}</p>
        {u.error
          ? <>
              <p className="flex items-start gap-1 text-[12px] leading-snug text-seal" role="alert"><TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />{t('assets.failed', { error: u.error })}</p>
              <div className="mt-auto flex items-center gap-1.5 pt-2">
                <button type="button" className="fs-btn fs-btn-secondary fs-btn-sm flex-1" onClick={onRetry}><RotateCcw size={13} aria-hidden />{t('assets.retry')}</button>
                <button type="button" className="fs-btn fs-btn-ghost fs-btn-sm" onClick={onDismiss}>{t('assets.dismiss')}</button>
              </div>
            </>
          : <p className="flex items-center gap-1.5 text-[12px] text-ink-3" role="status"><Loader2 size={12} className="animate-spin" aria-hidden />{t('assets.uploading')} · {fmtBytes(u.file.size)}</p>}
      </div>
    </li>
  );
}

// ── the host's library (Cloud 素材库) ─────────────────────────────────────────────────────────────────────────────────

function LibraryGrid({ project, inFilm, onUsed }: { project: ProjectView; inFilm: UserAsset[]; onUsed: (a: UserAsset) => void }) {
  const { t } = useT();
  const [items, setItems] = useState<LibraryAsset[]>();
  const [error, setError] = useState<string>();
  const [using, setUsing] = useState<string>();
  const [failed, setFailed] = useState<{ id: string; error: string }>();
  useEffect(() => {
    let live = true;
    client.assetLibrary!.list().then((l) => live && setItems(l)).catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, []);
  const had = useMemo(() => new Set(inFilm.map((a) => a.from).filter(Boolean)), [inFilm]);
  const use = useCallback(async (libId: string) => {
    setUsing(libId); setFailed(undefined);
    try { onUsed(await client.assetLibrary!.use(project.id, libId)); }
    catch (e) { setFailed({ id: libId, error: (e as Error).message }); }
    finally { setUsing(undefined); }
  }, [project.id, onUsed]);

  if (error) return <p className="mt-2 text-[12.5px] text-seal" role="alert">{t('assets.libraryFailed', { error })}</p>;
  if (!items) return <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-ink-3"><Loader2 size={13} className="animate-spin" aria-hidden />{t('assets.libraryLoading')}</p>;
  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-ink-3">{items.length ? t('assets.libraryIntro') : t('assets.libraryEmpty')}</p>
      {failed && <p className="mt-3 rounded-lg bg-seal-soft px-3 py-2 text-[12.5px] text-seal" role="alert">{t('assets.failed', { error: failed.error })}</p>}
      <ul className="mt-4 grid grid-cols-2 gap-3 min-[480px]:grid-cols-3">
        {items.map((x) => <LibraryCard key={x.id} x={x} had={had.has(x.id)} busy={using === x.id} disabled={!!using} onUse={use} />)}
      </ul>
    </>
  );
}

const LibraryCard = memo(function LibraryCard({ x, had, busy, disabled, onUse }: { x: LibraryAsset; had: boolean; busy: boolean; disabled: boolean; onUse: (id: string) => void }) {
  const { t } = useT();
  return (
    <li>
      <button type="button" onClick={() => onUse(x.id)} disabled={disabled} title={x.note || x.name} aria-label={t('assets.useOf', { name: x.name })}
        className="group block w-full overflow-hidden rounded-xl border border-line bg-surface text-left outline-none transition-colors duration-150 hover:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-progress">
        <span className="relative block">
          <Picture src={x.thumb || x.url} alt="" busy={busy} />
          {had && <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-jade px-1.5 py-0.5 text-[10.5px] font-medium text-white"><Check size={10} strokeWidth={3} aria-hidden />{t('assets.inFilm')}</span>}
        </span>
        <span className="block border-t border-line/70 px-2.5 py-2">
          <span className="block truncate text-[12.5px] font-medium text-ink">{x.name}</span>
          <span className="block truncate text-[11px] tabular text-ink-3">{busy ? t('assets.using') : `${t('assets.size', { w: x.w, h: x.h })} · ${TYPE_LABEL[x.type] ?? x.type}`}</span>
        </span>
      </button>
    </li>
  );
});

// ── the new film's strip (Home) ───────────────────────────────────────────────────────────────────────────────────────

/** an asset given with a new film, its small copy made in the browser */
export type PendingAsset = { key: string; file: File; thumb?: Blob; preview?: string };

/** the small copy of each picture, for the new film's strip: `onReady` replaces the entry when its copy is made */
export function prepareAssets(files: File[], onReady: (a: PendingAsset) => void): PendingAsset[] {
  return files.map((file) => {
    const a: PendingAsset = { key: `${file.name}:${file.size}:${Math.random().toString(36).slice(2, 7)}`, file, preview: isSvgFile(file) ? URL.createObjectURL(file) : undefined };
    if (!a.preview) void makeThumb(file).then((thumb) => onReady({ ...a, thumb, preview: URL.createObjectURL(thumb ?? file) }));
    return a;
  });
}

/** the new film's 素材: real thumbnails, apart from the document chips; a tile to add more (or drop on it) */
export function AssetStrip({ items, onAdd, onRemove }: { items: PendingAsset[]; onAdd: () => void; onRemove: (key: string) => void }) {
  const { t } = useT();
  return (
    <div className="mt-4">
      <p className="mb-2 flex items-baseline gap-2 text-[12.5px]">
        <span className="font-medium text-ink-2">{t('assets.home.title')}{items.length > 0 && <span className="ml-1.5 tabular text-ink-3">{items.length}</span>}</span>
        <span className="truncate text-ink-3">{t('assets.home.hint')}</span>
      </p>
      <ul className="flex flex-wrap gap-2.5">
        {items.map((a) => (
          <li key={a.key} className="group/a relative h-[84px] w-[112px] overflow-hidden rounded-xl border border-line animate-pop">
            <span className="fs-checker absolute inset-0">
              {a.preview
                ? <img src={a.preview} alt={a.file.name} decoding="async" className="absolute inset-0 h-full w-full object-contain p-2" />
                : <span className="absolute inset-0 grid place-items-center"><Loader2 size={16} className="animate-spin text-ink-3" aria-hidden /></span>}
            </span>
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/55 to-transparent px-2 pb-1 pt-3 text-[10.5px] text-white">{nameOf(a.file)}</span>
            <button type="button" onClick={() => onRemove(a.key)} aria-label={t('assets.home.remove', { name: a.file.name })}
              className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-150 hover:bg-black/75 focus-visible:opacity-100 group-hover/a:opacity-100">
              <X size={12} aria-hidden />
            </button>
          </li>
        ))}
        <li>
          <button type="button" onClick={onAdd}
            className={`flex h-[84px] flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed border-line-2 text-ink-3 transition-colors duration-150 hover:border-accent/60 hover:bg-accent-soft/30 hover:text-accent-ink ${items.length ? 'w-[112px]' : 'w-[min(300px,100%)] px-4'}`}>
            <ImagePlus size={18} aria-hidden />
            <span className="text-[11.5px]">{items.length ? t('assets.home.add') : t('assets.home.drop')}</span>
          </button>
        </li>
      </ul>
    </div>
  );
}
