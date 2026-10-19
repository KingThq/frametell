import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Download, ExternalLink, FolderOpen, Loader2, Presentation } from 'lucide-react';
import { client, downloadUrl, hosted, type DeckLink, type ProjectView } from '../lib/client';
import { useNow } from '../lib/hooks';
import { clock, film, isWorking, relPath, type RunView } from '../lib/run';
import { useT } from '../i18n';
import { orShort } from '../components/Credits';

// The live preview is the film; an mp4 is made only when asked for. One control for it wherever it appears.

/** export the finished film to mp4: the button, its progress, or the file once it is done */
export function ExportControls({ run, project, size = '' }: { run: RunView; project: ProjectView; size?: string }) {
  const { t } = useT();
  const now = useNow(!!run.exporting);
  const [asking, setAsking] = useState(false);
  const cut = film(run);
  if (cut) return (
    <>
      <a className={`fs-btn fs-btn-secondary ${size}`} href={downloadUrl(project, relPath(cut.path, project.id))} download><Download size={14} aria-hidden /> {t('common.export.download')}</a>
      <RevealFile file={cut.saved?.withSubs ?? cut.path} size={size} />
    </>
  );
  if (run.exporting) return <span className={`fs-btn fs-btn-secondary pointer-events-none ${size}`} role="status"><Loader2 size={14} className="animate-spin" aria-hidden /> {t('common.export.exporting', { time: clock(now - run.exporting) })}</span>;
  return (
    <button className={`fs-btn fs-btn-secondary ${size}`} disabled={asking || isWorking(run)} onClick={async () => { setAsking(true); try { await client.export(project.id).catch(orShort(project.id)); } finally { setAsking(false); } }}
      title={run.stale ? t('common.export.staleTitle') : t('common.export.title')}>
      <Download size={14} aria-hidden /> {run.stale ? t('common.export.exportLatest') : t('common.export.exportMp4')}
    </button>
  );
}

/** the preview as a slide deck (the engine's ?deck), in a window of its own */
const openDeck = (project: ProjectView) => window.open(`${client.fileUrl(project, 'index.html')}?deck`, '_blank', 'noopener');

/**
 * The film as a slide deck, a line a click. Here, the preview opens as one; a hosted service also keeps it at a public
 * address (hosted.deck), made, updated and taken down from the popover.
 */
export function DeckControls({ project, size = '' }: { project: ProjectView; size?: string }) {
  const { t, locale } = useT();
  const deck = hosted?.deck;
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number; width: number }>();
  const [link, setLink] = useState<DeckLink | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const place = () => {
    const el = root.current; if (!el) return;
    const r = el.getBoundingClientRect(), width = Math.min(420, innerWidth - 16);
    setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - width, innerWidth - width - 8)), width });
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { const el = e.target as HTMLElement; if (!root.current?.contains(el) && !el.closest?.('[data-deck]')) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const moved = () => place();
    addEventListener('mousedown', away); addEventListener('keydown', esc); addEventListener('resize', moved); addEventListener('scroll', moved, true);
    return () => { removeEventListener('mousedown', away); removeEventListener('keydown', esc); removeEventListener('resize', moved); removeEventListener('scroll', moved, true); };
  }, [open]);
  useEffect(() => { if (open && deck && link === undefined) deck.read(project.id).then(setLink, () => setLink(null)); }, [open, deck, link, project.id]);
  if (!deck) return <button type="button" className={`fs-btn fs-btn-ghost ${size}`} title={t('common.export.deckTitle')} onClick={() => openDeck(project)}><Presentation size={14} aria-hidden /> {t('common.export.deck')}</button>;

  const act = async (f: () => Promise<DeckLink | null>) => {
    setBusy(true); setError('');
    try { setLink(await f()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const copy = async () => { if (!link) return; try { await navigator.clipboard.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the link is selectable */ } };
  const when = link ? new Date(link.at).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <span ref={root} className="relative inline-flex">
      <button type="button" className={`fs-btn fs-btn-ghost ${size}`} aria-expanded={open} title={t('common.export.deckTitle')} onClick={() => (open ? setOpen(false) : (place(), setOpen(true)))}><Presentation size={14} aria-hidden /> {t('common.export.deck')}</button>
      {open && at && createPortal((
        <span role="dialog" data-deck aria-label={t('common.export.deck')} style={{ top: at.top, left: at.left, width: at.width }} className="fixed z-50 flex flex-col gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35),0_2px_6px_rgb(0_0_0/0.12)] animate-pop [transform-origin:top_right]">
          <span className="block text-[12.5px] leading-relaxed text-ink-2">{t('common.export.deckIntro')}</span>
          <button type="button" className="fs-btn fs-btn-secondary fs-btn-sm self-start" onClick={() => openDeck(project)}><Presentation size={13} aria-hidden /> {t('common.export.deckPreview')}</button>
          <span className="block border-t border-line pt-3">
            <span className="block text-[12.5px] font-medium text-ink">{t('common.export.deckLink')}</span>
            <span className="mt-1 block text-[12px] leading-relaxed text-ink-3">{t('common.export.deckLinkHint')}</span>
            {link === undefined ? <Loader2 size={14} className="mt-2 animate-spin text-ink-3" aria-hidden /> : link ? (
              <>
                <span className="mt-2 flex items-start gap-2">
                  <code className="min-w-0 flex-1 select-all break-all rounded-lg bg-paper-2 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-ink">{link.url}</code>
                  <button type="button" className="fs-btn fs-btn-secondary fs-btn-sm shrink-0" onClick={() => void copy()}>{copied ? <Check size={13} className="text-jade" aria-hidden /> : <Copy size={13} aria-hidden />} {copied ? t('common.export.copied') : t('common.export.copy')}</button>
                </span>
                <span className="mt-1.5 block text-[11.5px] text-ink-3 tabular">{t('common.export.deckAt', { time: when })}</span>
                <span className="mt-2 flex flex-wrap gap-2">
                  <a className="fs-btn fs-btn-secondary fs-btn-sm" href={link.url} target="_blank" rel="noopener"><ExternalLink size={13} aria-hidden /> {t('common.export.deckOpen')}</a>
                  <button type="button" className="fs-btn fs-btn-ghost fs-btn-sm" disabled={busy} onClick={() => void act(() => deck.publish(project.id))}>{t('common.export.deckUpdate')}</button>
                  <button type="button" className="fs-btn fs-btn-ghost fs-btn-sm" disabled={busy} onClick={() => void act(async () => { await deck.remove(project.id); return null; })}>{t('common.export.deckRemove')}</button>
                </span>
              </>
            ) : (
              <button type="button" className="fs-btn fs-btn-accent fs-btn-sm mt-2" disabled={busy} onClick={() => void act(() => deck.publish(project.id))}>{t('common.export.deckPublish')}</button>
            )}
            {busy && <span className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-3" role="status"><Loader2 size={13} className="animate-spin" aria-hidden /> {t('common.export.deckWorking')}</span>}
            {error && <span className="mt-2 block text-[12px] leading-relaxed text-seal" role="alert">{error}</span>}
          </span>
        </span>
      ), document.body)}
    </span>
  );
}

/**
 * Where an exported file is. In the desktop app: show it in Finder (Explorer, the file manager). In a browser, which
 * cannot open one: the path, to copy. On a hosted service the file is on its server, not here: nothing (the download is).
 */
export function RevealFile({ file, size = '' }: { file: string; size?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number; width: number }>();
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  // placed against the window, not the button's pane: a narrow pane must not clip it
  const place = () => {
    const el = root.current; if (!el) return;
    const r = el.getBoundingClientRect(), width = Math.min(440, innerWidth - 16);
    setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, innerWidth - width - 8)), width });
  };
  const show = () => { place(); setOpen(true); };
  const platform = (window.studioBridge as { platform?: string } | undefined)?.platform;
  useEffect(() => {
    if (!open) return;
    // the popover lives on the body (no pane clips it): a click in it is not a click away
    const away = (e: MouseEvent) => { const el = e.target as HTMLElement; if (!root.current?.contains(el) && !el.closest?.('[data-reveal]')) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const moved = () => place();   // follows the button when the pane scrolls or the window resizes
    addEventListener('mousedown', away); addEventListener('keydown', esc); addEventListener('resize', moved); addEventListener('scroll', moved, true);
    return () => { removeEventListener('mousedown', away); removeEventListener('keydown', esc); removeEventListener('resize', moved); removeEventListener('scroll', moved, true); };
  }, [open]);
  if (hosted) return null;
  if (client.reveal) {
    const label = platform === 'darwin' ? t('common.export.revealMac') : platform === 'win32' ? t('common.export.revealWin') : t('common.export.revealOther');
    return <button type="button" className={`fs-btn fs-btn-ghost ${size}`} onClick={() => void client.reveal!(file)}><FolderOpen size={14} aria-hidden /> {label}</button>;
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(file); } catch {
      const r = document.createRange(); const el = document.querySelector('[data-reveal] code'); if (el) { r.selectNodeContents(el); getSelection()?.removeAllRanges(); getSelection()?.addRange(r); document.execCommand('copy'); }
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <span ref={root} className="relative inline-flex">
      <button type="button" className={`fs-btn fs-btn-ghost ${size}`} aria-expanded={open} onClick={() => (open ? setOpen(false) : show())}><FolderOpen size={14} aria-hidden /> {t('common.export.where')}</button>
      {open && at && createPortal((
        <span role="dialog" data-reveal aria-label={t('common.export.where')} style={{ top: at.top, left: at.left, width: at.width }} className="fixed z-50 rounded-xl border border-line bg-surface p-3 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35),0_2px_6px_rgb(0_0_0/0.12)] animate-pop [transform-origin:top_left]">
          <span className="block text-[12px] text-ink-3">{t('common.export.pathHint')}</span>
          <span className="mt-2 flex items-start gap-2">
            <code className="min-w-0 flex-1 select-all break-all rounded-lg bg-paper-2 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-ink">{file}</code>
            <button type="button" className="fs-btn fs-btn-secondary fs-btn-sm shrink-0" onClick={() => void copy()}>{copied ? <Check size={13} className="text-jade" aria-hidden /> : <Copy size={13} aria-hidden />} {copied ? t('common.export.copied') : t('common.export.copy')}</button>
          </span>
        </span>
      ), document.body)}

    </span>
  );
}
