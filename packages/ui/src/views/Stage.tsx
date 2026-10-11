import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Captions, CaptionsOff, Check, ChevronLeft, ChevronRight, Download, Images, Maximize2, MessageSquareText, Quote, TriangleAlert } from 'lucide-react';
import { client, type PageTiming, type ProjectView, type Timeline } from '../lib/client';
import { film, finished, relPath, STAGE_NAME, STAGES, type PageView, type RunView } from '../lib/run';
import { ExportControls, RevealFile } from './Export';
import { pageName } from '../lib/describe';
import { Lightbox } from './Lightbox';
import { clip, type Ref } from '../lib/refs';
import { t as tr, useT } from '../i18n';

// The workbench is about the film and its pages, each page's picture next to the words it carries: a film view (player,
// a page lane in proportion to time, the line being spoken), a canvas of page cards, and a focused page to look closely.

const statusText = (s: PageView['status']) => tr(`stage.status.${s}`);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** the timeline (pages, lines, times) refetched whenever the script, the voice or the film changes */
function useTimeline(id: string, key: string) {
  const [tl, setTl] = useState<Timeline | null>(null);
  useEffect(() => { let live = true; client.timeline(id).then((t) => live && setTl(t)).catch(() => {}); return () => { live = false; }; }, [id, key]);
  return tl;
}

/** time reported by an embedded engine player (postMessage studio:time) */
function usePlayerTime(frame: React.RefObject<HTMLIFrameElement | null>, version = '') {
  const [st, setSt] = useState({ t: 0, playing: false, ready: false });
  useEffect(() => setSt({ t: 0, playing: false, ready: false }), [version]);   // a reloaded player starts over
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === 'studio:time') setSt((s) => ({ ...s, t: e.data.t, playing: !!e.data.playing }));
      else if (e.data?.type === 'studio:ready') setSt((s) => ({ ...s, ready: true }));
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, [frame]);
  return st;
}
const seekFrame = (frame: HTMLIFrameElement | null, t: number, play = true) => frame?.contentWindow?.postMessage({ type: 'studio:seek', t, play }, '*');

function Thumb({ p, project, poster, className = '', badge = true }: { p?: PageView; project: ProjectView; poster?: string; className?: string; badge?: boolean }) {
  // project-relative: the page's own settled frame (fresh after a redraw), else a frame cut from the film, else its check sheet
  const src = p?.thumb ? relPath(p.thumb, project.id) : poster ?? (p?.sheet ? relPath(p.sheet, project.id) : undefined);
  const working = p?.status === 'drawing' || p?.status === 'checking';
  useT();
  return (
    <span className={`block overflow-hidden bg-paper-2 ${className.includes('absolute') ? '' : 'relative'} ${className}`}>
      {src && <img src={client.fileUrl(project, src)} alt="" className="absolute inset-0 h-full w-full object-cover object-left-top opacity-0 transition-opacity duration-500 [&.loaded]:opacity-100" ref={(el) => { if (el?.complete && el.naturalWidth) el.classList.add('loaded'); }} onLoad={(e) => e.currentTarget.classList.add('loaded')} />}
      {!src && <span className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-3">{statusText(working ? 'drawing' : 'queued')}</span>}
      {working && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden>
          <rect x="1" y="1" width="158" height="88" rx="6" fill="none" stroke="rgb(var(--fs-accent))" strokeWidth="2" pathLength="100" strokeDasharray="22 78" className="motion-safe:animate-[trace_1.6s_linear_infinite]" style={{ strokeDashoffset: 100 }} />
        </svg>
      )}
      {badge && p?.status === 'ok' && <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-jade text-paper" aria-hidden><Check size={10} strokeWidth={3} /></span>}
      {badge && p?.status === 'flagged' && <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-seal text-paper" aria-hidden><TriangleAlert size={9} strokeWidth={3} /></span>}
    </span>
  );
}

/** the lines of a page: the voiced cues once the script exists, the storyboard's say before that */
function linesOf(id: string, tl: Timeline | null, run: RunView): { text: string; at?: number; abs?: number }[] {
  const pt = tl?.pages.find((p) => p.id === id);
  if (pt?.cues.length) return pt.cues.map((c) => ({ text: c.text, at: c.at, abs: c.abs }));
  const say = run.storyboard?.pages.find((p) => p.id === id)?.say;
  return say ? [{ text: say }] : [];
}

// ── film view ───────────────────────────────────────────────────────────────────────────────────────────────────────

function Film({ run, project, ids, tl, subs, playKey, onFocus }: { run: RunView; project: ProjectView; ids: string[]; tl: Timeline | null; subs: boolean; playKey?: number; onFocus: (id: string) => void }) {
  useT();
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [vt, setVt] = useState(0);
  const ft = usePlayerTime(frame).t;
  const okCount = ids.filter((id) => ['ok', 'flagged'].includes(run.pages[id]?.status)).length;
  const cut = film(run);
  const t = cut ? vt : ft;
  const seek = (s: number) => { if (video.current) { video.current.currentTime = s; void video.current.play().catch(() => {}); } else seekFrame(frame.current, s); };

  let screen: React.ReactNode;
  if (cut) {
    const src = subs ? cut.path : cut.noSubs;
    screen = <video ref={video} key={`${src}-${playKey ?? 0}`} controls autoPlay={!!playKey} onTimeUpdate={(e) => setVt(e.currentTarget.currentTime)} className="h-full w-full rounded-xl bg-black object-contain" src={client.fileUrl(project, relPath(src, project.id))} />;
  } else if (okCount > 0) {
    screen = <iframe ref={frame} key={ids.map((x) => `${run.pages[x]?.status ?? ''}${run.pages[x]?.round ?? ''}`).join('|')} title={tr('stage.previewTitle')} src={client.fileUrl(project, 'index.html')} sandbox="allow-scripts" className="h-full w-full rounded-xl border-0 bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />;
  } else {
    const current = STAGES.find((s) => run.stages[s].status === 'running');
    screen = (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-line bg-paper-2/60 text-center">
        <span className="font-display text-[22px] text-ink-2">{run.paused ? tr('stage.paused') : current ? tr('stage.stageRunning', { stage: STAGE_NAME[current] }) : run.awaitingApproval ? tr('stage.awaitingApproval') : tr('stage.gettingReady')}</span>
        <span className="mt-2 max-w-[38ch] text-[12.5px] leading-relaxed text-ink-3">{run.paused ? tr('stage.pausedHint') : run.awaitingApproval ? tr('stage.approvalHint') : tr('stage.previewHint')}</span>
      </div>
    );
  }

  const pages: (PageTiming | { id: string; start?: undefined; end?: undefined })[] = tl?.pages.length ? tl.pages : ids.map((id) => ({ id }));
  const total = tl?.duration || 0;
  const cur = tl?.pages.find((p) => t >= p.start && t < p.end) ?? tl?.pages[0];
  const line = cur?.cues.filter((c) => c.abs <= t + 0.05).at(-1) ?? cur?.cues[0];
  const curIndex = cur ? ids.indexOf(cur.id) : -1;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* the screen fills the space it has at 16:9: a size container lets it fit both width and height */}
      <div className="min-h-0 flex-1 px-6 pt-5 [container-type:size]">
        <div className="mx-auto flex h-full items-center justify-center">
          <div className="aspect-video" style={{ width: 'min(100cqw, calc(100cqh * 16 / 9), 1280px)' }}>{screen}</div>
        </div>
      </div>
      {pages.length > 0 && (
        <div className="mx-auto w-full max-w-[1280px] px-6 pb-5 pt-4">
          {/* the page lane: each page as wide as its share of the film, its name beneath; the playhead walks inside the
              page on screen, which stands out while the others rest a step back */}
          <div className="flex gap-[3px]" role="list" aria-label={tr('stage.pageLane')}>
            {pages.map((pt, i) => {
              const share = total && pt.end != null ? (pt.end - pt.start!) / total : 1 / pages.length;
              const on = cur?.id === pt.id && total > 0;
              const section = run.storyboard?.pages.find((x) => x.id === pt.id)?.section;
              const pos = on && pt.end != null ? Math.min(1, Math.max(0, (t - pt.start!) / (pt.end - pt.start!))) : 0;
              const st = run.pages[pt.id]?.status;
              return (
                <div role="listitem" key={pt.id} style={{ flexGrow: share, flexBasis: 0 }} className="min-w-[44px]">
                  <button onClick={() => (pt.start != null ? seek(pt.start + 0.6) : onFocus(pt.id))} aria-label={tr('stage.jumpTo', { n: i + 1, section })} aria-current={on || undefined} title={section}
                    className="group block w-full text-left outline-none">
                    <span className={`relative block h-[60px] overflow-hidden rounded-[9px] bg-paper-2 transition-[filter,box-shadow] duration-200 group-focus-visible:shadow-[0_0_0_2px_rgb(var(--fs-accent))] ${on ? '' : 'brightness-[0.62] saturate-[0.85] group-hover:brightness-90'}`}>
                      <Thumb p={run.pages[pt.id]} project={project} poster={tl?.posters?.[pt.id]} className="absolute inset-0" badge={false} />
                      {on && <span className="pointer-events-none absolute inset-0 rounded-[9px] shadow-[inset_0_0_0_1.5px_rgb(var(--fs-accent))]" aria-hidden />}
                      {on && <span className="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 bg-accent shadow-[0_0_0_1px_rgb(0_0_0/0.25)]" style={{ left: `${pos * 100}%` }} aria-hidden />}
                      {st === 'flagged' && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-seal ring-2 ring-black/20" aria-label={statusText('flagged')} />}
                    </span>
                    <span className={`mt-1.5 flex items-baseline gap-1.5 truncate text-[11.5px] transition-colors ${on ? 'text-ink' : 'text-ink-3 group-hover:text-ink-2'}`}>
                      <span className="font-mono text-[10.5px] tabular opacity-70">{i + 1}</span><span className="truncate">{section}</span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          {/* the line being spoken, with the way into this page */}
          <div className="mt-3 flex min-h-[44px] items-start gap-4">
            <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-ink" aria-live="off">
              {cur && <span className="mr-2 text-[12.5px] text-ink-3 tabular">{pageName(cur.id)} · {mmss(t)}</span>}
              {line?.text ?? <span className="text-ink-3">{tr('stage.lineHint')}</span>}
            </p>
            {cur && curIndex >= 0 && <button className="fs-btn fs-btn-secondary fs-btn-sm shrink-0" onClick={() => onFocus(cur.id)}><Maximize2 size={13} aria-hidden /> {tr('stage.focusPage')}</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── the canvas: every page, its picture and its words ──────────────────────────────────────────────────────────────

function Canvas({ run, project, ids, tl, onFocus, onRef }: { run: RunView; project: ProjectView; ids: string[]; tl: Timeline | null; onFocus: (id: string) => void; onRef: (r: Ref) => void }) {
  useT();
  if (!ids.length) return <p className="px-6 py-10 text-center text-[13px] text-ink-3">{tr('stage.canvasEmpty')}</p>;
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <ol className="mx-auto grid max-w-[1280px] gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        {ids.map((id, i) => {
          const p = run.pages[id], sb = run.storyboard?.pages.find((x) => x.id === id), pt = tl?.pages.find((x) => x.id === id);
          const lines = linesOf(id, tl, run);
          return (
            <li key={id} className="group/c relative">
              <button onClick={() => onRef({ kind: 'page', page: id, label: tr('stage.pageLabel', { n: i + 1, section: sb?.section }), thumb: p?.thumb ? relPath(p.thumb, project.id) : tl?.posters?.[id] })}
                className="fs-lb-btn absolute right-2 top-2 z-10 h-7 w-auto gap-1 px-2.5 text-[11.5px] opacity-0 transition-opacity focus-visible:opacity-100 group-hover/c:opacity-100" title={tr('stage.addPageTitle')}>
                <Quote size={11} aria-hidden /> {tr('stage.quote')}
              </button>
              <button onClick={() => onFocus(id)} className="group flex h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-surface text-left transition-[border-color,transform] duration-200 hover:-translate-y-px hover:border-line-2">
                <Thumb p={p} project={project} poster={tl?.posters?.[id]} className="aspect-video w-full border-b border-line" />
                <span className="flex flex-1 flex-col px-3.5 pb-3.5 pt-3">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[12px] text-ink-3 tabular">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{sb?.section ?? pageName(id)}</span>
                    {pt && <span className="shrink-0 font-mono text-[11.5px] text-ink-3 tabular">{mmss(pt.start)}–{mmss(pt.end)}</span>}
                  </span>
                  <span className="mt-2 line-clamp-4 text-[12.5px] leading-[1.7] text-ink-2">{lines.map((l) => l.text).join('') || tr('stage.noPageNarration')}</span>
                  {p?.status === 'flagged' && p.issues[0] && <span className="mt-2 text-[12px] leading-relaxed text-seal">{p.issues[0]}</span>}
                  {p && p.status !== 'ok' && p.status !== 'flagged' && <span className="mt-2 text-[12px] text-accent-ink">{statusText(p.status)}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── one page, close up ─────────────────────────────────────────────────────────────────────────────────────────────

/** the moment that shows a line: a beat after it starts, once its picture has settled, before the next line */
const momentOf = (lines: { abs?: number }[], j: number, end: number) => {
  const a = lines[j].abs ?? 0, b = lines[j + 1]?.abs ?? end;
  return Math.max(a, Math.min(a + 1.2, a + (b - a) / 2, b - 0.15));
};

/** full-resolution frames of the film at the given times, cut in one go; again whenever the film changes */
function useFrames(project: ProjectView, times: number[], enabled: boolean, version = '') {
  const [paths, setPaths] = useState<Record<string, string>>({});
  const key = times.map((t) => t.toFixed(1)).join(',');
  useEffect(() => {
    setPaths({});
    if (!enabled || !times.length) return;
    let live = true;
    client.frames(project.id, times).then((list) => live && setPaths(Object.fromEntries(times.map((t, i) => [t.toFixed(1), list[i]])))).catch(() => {});
    return () => { live = false; };
  }, [project.id, key, enabled, version]);
  return (t: number) => paths[t.toFixed(1)];
}

function Focus({ id, run, project, ids, tl, onFocus, onBack, onRef }: { id: string; run: RunView; project: ProjectView; ids: string[]; tl: Timeline | null; onFocus: (id: string) => void; onBack: () => void; onRef: (r: Ref) => void }) {
  useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const screenBox = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const cueList = useRef<HTMLOListElement>(null);
  const version = ids.map((x) => `${run.pages[x]?.status ?? ''}${run.pages[x]?.round ?? ''}`).join('|') + (run.ready?.at ?? run.video?.path ?? '');
  const { t, playing: running, ready } = usePlayerTime(frame, version);
  const [light, setLight] = useState<{ kind: 'frames' | 'sheet'; i: number } | null>(null);
  const i = ids.indexOf(id), p = run.pages[id], sb = run.storyboard?.pages.find((x) => x.id === id);
  const lines = linesOf(id, tl, run);
  const drawn = p?.status === 'ok' || p?.status === 'flagged' || finished(run);
  const prev = ids[i - 1], next = ids[i + 1];
  const pt = tl?.pages.find((x) => x.id === id);
  const timed = lines.some((l) => l.abs != null);
  // the player boots straight onto the page it opens on (past the cross-fade from the page before); later turns seek
  const startAt = useRef(0);
  const booted = useRef('');
  if (pt && booted.current !== version) { booted.current = version; startAt.current = Math.min(pt.start + 0.6, pt.end - 0.1); }
  const poster = p?.thumb ? relPath(p.thumb, project.id) : tl?.posters?.[id];
  const moments = useMemo(() => (pt && timed ? lines.map((_, j) => momentOf(lines, j, pt.end)) : []), [pt?.start, pt?.end, lines.length, timed]);
  const frameAt = useFrames(project, moments, finished(run), version);
  // the line on screen right now: words, its frame and the player all point at the same moment
  const active = timed ? Math.max(0, lines.filter((l) => l.abs != null && l.abs <= t + 0.05).length - 1) : -1;
  const inThis = !!pt && t >= pt.start - 0.01 && t < pt.end - 0.01;
  useEffect(() => { setLight(null); }, [id]);
  useEffect(() => {
    if (active < 0 || !inThis) return;
    strip.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    cueList.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active, inThis]);
  // one player for the whole film: turning a page is a jump, not a reload. While it plays across a page boundary, the
  // focused page follows the picture; turning the page by hand jumps there and keeps playing if it was playing.
  const follow = useRef(false);
  const inPage = (x: PageTiming | undefined) => !!x && t >= x.start - 0.01 && t < x.end - 0.01;
  useEffect(() => {
    if (!ready || !pt) return;
    if (follow.current) { follow.current = false; return; }
    if (!inPage(pt)) seekFrame(frame.current, Math.min(pt.start + 0.6, pt.end - 0.1), running);   // past the cross-fade from the page before
  }, [ready, id, pt?.start]);
  useEffect(() => {
    if (!running || !tl || inPage(pt)) return;
    const now = tl.pages.find((x) => t >= x.start && t < x.end);
    if (now && now.id !== id) { follow.current = true; onFocus(now.id); }
  }, [t]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,dialog')) return;
      if (e.key === 'Escape') onBack();
      else if (e.key === 'ArrowLeft' && prev) onFocus(prev);
      else if (e.key === 'ArrowRight' && next) onFocus(next);
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [prev, next, onBack, onFocus]);

  const pageLabel = tr('stage.pageLabel', { n: i + 1, section: sb?.section });
  const pageRef: Ref = { kind: 'page', page: id, label: pageLabel, thumb: p?.thumb ? relPath(p.thumb, project.id) : tl?.posters?.[id] };
  const lineRef = (j: number): Ref => ({ kind: 'line', page: id, at: lines[j].abs ?? 0, text: lines[j].text, label: tr('stage.lineLabel', { n: i + 1, time: mmss(lines[j].abs ?? 0), text: clip(lines[j].text, 10) }) });
  const frameRef = (j: number): Ref | undefined => { const f = frameAt(moments[j]); return f ? { kind: 'frame', page: id, at: moments[j], path: f, text: lines[j]?.text, label: tr('stage.frameLabel', { n: i + 1, time: mmss(lines[j]?.abs ?? moments[j]) }) } : undefined; };
  const frameItems = moments.map((m, j) => ({ src: frameAt(m) ? client.fileUrl(project, frameAt(m)!) : '', title: `${pageLabel} · ${mmss(lines[j]?.abs ?? m)}`, caption: lines[j]?.text }));
  const sheetItems = p?.sheet ? [{ src: client.fileUrl(project, relPath(p.sheet, project.id)), title: tr('stage.sheetTitle', { page: pageLabel, round: p.round ?? 1 }), caption: tr('stage.sheetCaption') }] : [];

  let screen: React.ReactNode;
  if (drawn) screen = (
    <div ref={screenBox} className="group relative h-full w-full overflow-hidden rounded-xl bg-paper-2">
      {/* until the player has drawn this page, its picture stands in; the player then fades in already on it */}
      {!ready && poster && <img src={client.fileUrl(project, poster)} alt="" className="absolute inset-0 h-full w-full object-contain" />}
      {pt && <iframe ref={frame} key={version} title={tr('stage.preview')} src={`${client.fileUrl(project, 'index.html')}?from=${startAt.current.toFixed(2)}`} sandbox="allow-scripts" allowFullScreen
        className={`relative h-full w-full border-0 transition-opacity duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${ready ? 'opacity-100' : 'opacity-0'}`} />}
      <button className="fs-lb-btn absolute right-3 top-3 opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100" onClick={() => void screenBox.current?.requestFullscreen?.()} aria-label={tr('stage.fullscreen')} title={tr('stage.fullscreen')}><Maximize2 size={15} /></button>
    </div>
  );
  else screen = (
    <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-line-2 bg-paper-2/50 px-8 text-center">
      <span className="font-display text-[22px] text-ink-2">{p ? statusText(p.status) : tr('stage.notStarted')}</span>
      {!!sb?.beats?.length && <ul className="mt-4 max-w-[52ch] space-y-1.5 text-left text-[12.5px] leading-relaxed text-ink-3">{sb.beats.map((b, j) => <li key={j}><span className="mr-2 font-mono text-[11.5px]">{b.at}</span>{tr('stage.beat', { object: b.object, action: b.action })}</li>)}</ul>}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-5 pt-4">
        <button className="fs-btn fs-btn-ghost fs-btn-sm" onClick={onBack}><ArrowLeft size={14} aria-hidden /> {tr('stage.allPages')}</button>
        <h2 className="min-w-0 truncate text-[14px] font-medium"><span className="mr-2 text-ink-3 tabular">{tr('stage.pageN', { n: i + 1 })}</span>{sb?.section}</h2>
        {pt && <span className="hidden shrink-0 font-mono text-[11.5px] text-ink-3 tabular sm:inline">{mmss(pt.start)}–{mmss(pt.end)}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {sheetItems.length > 0 && <button className="fs-btn fs-btn-ghost fs-btn-sm" onClick={() => setLight({ kind: 'sheet', i: 0 })} title={tr('stage.sheetButtonTitle')}><Images size={14} aria-hidden /> {tr('stage.sheetButton')}</button>}
          <button className="fs-icon-btn" disabled={!prev} onClick={() => prev && onFocus(prev)} aria-label={tr('stage.prevPage')}><ChevronLeft size={16} /></button>
          <span className="w-[42px] text-center text-[12px] text-ink-3 tabular">{i + 1} / {ids.length}</span>
          <button className="fs-icon-btn" disabled={!next} onClick={() => next && onFocus(next)} aria-label={tr('stage.nextPage')}><ChevronRight size={16} /></button>
        </span>
      </div>
      <div className="min-h-0 flex-1 px-6 pt-3 [container-type:size]">
        <div className="mx-auto flex h-full items-center justify-center">
          <div className="aspect-video" style={{ width: 'min(100cqw, calc(100cqh * 16 / 9), 1280px)' }}>{screen}</div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1280px] px-6 pb-5 pt-3">
        {moments.length > 0 && finished(run) && (
          <div ref={strip} className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2 pt-1" role="list" aria-label={tr('stage.keyFrames')}>
            {moments.map((m, j) => {
              const src = frameAt(m), on = j === active && inThis;
              return (
                <div key={j} role="listitem" data-i={j} className="group/f relative shrink-0 snap-start">
                  <button onClick={() => seekFrame(frame.current, m, false)} onDoubleClick={() => src && setLight({ kind: 'frames', i: j })}
                    aria-label={tr('stage.frameAria', { time: mmss(lines[j]?.abs ?? m), text: lines[j]?.text ?? '' })} aria-current={on || undefined}
                    className={`relative block aspect-video w-[132px] overflow-hidden rounded-lg bg-paper-2 ring-offset-2 ring-offset-paper transition-[box-shadow,opacity] duration-150 ${on ? 'ring-2 ring-accent' : 'opacity-75 ring-1 ring-line hover:opacity-100'}`}>
                    {src ? <img src={client.fileUrl(project, src)} alt="" className="h-full w-full object-cover" loading="lazy" />
                      : <span className="absolute inset-0 animate-pulse bg-ink/[0.06]" aria-hidden />}
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 font-mono text-[10px] leading-4 text-white tabular">{mmss(lines[j]?.abs ?? m)}</span>
                  </button>
                  {src && (
                    <span className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/f:opacity-100">
                      <button className="fs-lb-btn h-6 w-6" onClick={() => { const r = frameRef(j); if (r) onRef(r); }} aria-label={tr('stage.addFrame')} title={tr('stage.addToChat')}><Quote size={11} /></button>
                      <button className="fs-lb-btn h-6 w-6" onClick={() => setLight({ kind: 'frames', i: j })} aria-label={tr('stage.zoomFrame')} title={tr('stage.zoom')}><Maximize2 size={11} /></button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-2 grid gap-x-6 gap-y-3 md:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <h3 className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-3"><MessageSquareText size={13} aria-hidden /> {tr('stage.narrationHeading')}{timed ? tr('stage.narrationHint') : ''}</h3>
            <ol ref={cueList} className="max-h-[148px] space-y-px overflow-y-auto overflow-x-hidden">
              {lines.length ? lines.map((l, j) => {
                const on = j === active && inThis && drawn;
                return (
                  <li key={j} data-i={j} className="group/l relative">
                    <button disabled={l.abs == null || !drawn} onClick={() => seekFrame(frame.current, l.abs!)}
                      className={`flex w-full items-baseline gap-3 rounded-lg py-1.5 pl-2.5 pr-20 text-left text-[13.5px] leading-relaxed transition-colors duration-150 enabled:hover:bg-ink/[0.045] ${on ? 'bg-accent-soft/60 text-ink' : 'text-ink-2'}`}>
                      {l.abs != null && <span className={`w-10 shrink-0 font-mono text-[11.5px] tabular ${on ? 'text-accent-ink' : 'text-ink-3'}`}>{mmss(l.abs)}</span>}
                      <span className="min-w-0">{l.text}</span>
                    </button>
                    {l.abs != null && <button onClick={() => onRef(lineRef(j))} className="absolute right-1.5 top-1/2 inline-flex h-6 -translate-y-1/2 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-ink-3 opacity-0 transition-opacity hover:bg-ink/[0.07] hover:text-ink focus-visible:opacity-100 group-hover/l:opacity-100"><Quote size={11} aria-hidden /> {tr('stage.quote')}</button>}
                  </li>
                );
              }) : <li className="px-2.5 text-[13px] text-ink-3">{tr('stage.noNarration')}</li>}
            </ol>
            {p?.status === 'flagged' && p.issues.length > 0 && <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-seal"><TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />{p.issues.join(tr('stage.issueSep'))}</p>}
          </div>
          <div className="flex items-start">
            <button className="fs-btn fs-btn-secondary" onClick={() => onRef(pageRef)} title={tr('stage.editPageTitle')}>{tr('stage.editPage')}</button>
          </div>
        </div>
      </div>

      {light && (light.kind === 'sheet' ? sheetItems : frameItems).length > 0 && (
        <Lightbox items={light.kind === 'sheet' ? sheetItems : frameItems} index={light.i} onIndex={(n) => { setLight({ ...light, i: n }); if (light.kind === 'frames') seekFrame(frame.current, moments[n], false); }} onClose={() => setLight(null)}
          actions={light.kind === 'frames' ? (_, n) => <button className="fs-btn fs-btn-sm border border-white/15 bg-white/10 text-white hover:bg-white/20" onClick={() => { const r = frameRef(n); if (r) { onRef(r); setLight(null); } }}><Quote size={13} aria-hidden /> {tr('stage.addToChat')}</button> : undefined} />
      )}
    </div>
  );
}

// ── the workbench ──────────────────────────────────────────────────────────────────────────────────────────────────

export function Stage({ run, project, selected, onSelect, playKey, onRef }: { run: RunView; project: ProjectView; selected?: string; onSelect: (id?: string) => void; playKey?: number; onRef: (r: Ref) => void }) {
  useT();
  const [view, setView] = useState<'film' | 'pages'>('film');
  const [subs, setSubs] = useState(true);
  const ids = run.pageOrder.length ? run.pageOrder : run.storyboard?.pages.map((p) => p.id) || [];
  const tlKey = `${run.stages.script.status}-${run.stages.narrate.status}-${run.ready?.at ?? ''}-${run.video?.path ?? ''}`;
  const tl = useTimeline(project.id, tlKey);
  useEffect(() => { if (playKey) { onSelect(undefined); setView('film'); } }, [playKey]);   // 「播放」from the conversation
  const focused = useMemo(() => (selected && ids.includes(selected) ? selected : undefined), [selected, ids]);
  const exported = film(run);
  const cut = exported ? (subs ? exported.path : exported.noSubs) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!focused && (
        <div className="flex items-center gap-3 px-5 pt-4">
          <div className="flex rounded-lg bg-ink/[0.05] p-0.5" role="tablist" aria-label={tr('stage.viewTabs')}>
            {([['film', tr('stage.film')], ['pages', tr('stage.pages', { n: ids.length })]] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={`rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors ${view === k ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink'}`}>{l}</button>
            ))}
          </div>
          {!cut && finished(run) && <span className="ml-auto flex items-center gap-2"><span className="hidden text-[12px] text-ink-3 md:inline">{run.stale ? tr('stage.revisedPreview') : tr('stage.livePreview')}</span><ExportControls run={run} project={project} size="fs-btn-sm" /></span>}
          {cut && (
            <span className="ml-auto flex items-center gap-1.5">
              <button className="fs-btn fs-btn-ghost fs-btn-sm" aria-pressed={subs} onClick={() => setSubs(!subs)} title={subs ? tr('stage.subsOnTitle') : tr('stage.subsOffTitle')}>
                {subs ? <Captions size={14} aria-hidden /> : <CaptionsOff size={14} aria-hidden />}{subs ? tr('stage.subsOn') : tr('stage.subsOff')}
              </button>
              <a className="fs-btn fs-btn-secondary fs-btn-sm" href={client.fileUrl(project, relPath(cut, project.id))} download><Download size={13} aria-hidden /> {subs ? tr('stage.downloadSubs') : tr('stage.downloadNoSubs')}</a>
              <RevealFile file={cut} size="fs-btn-sm" />
            </span>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {focused ? <Focus id={focused} run={run} project={project} ids={ids} tl={tl} onFocus={onSelect} onBack={() => { onSelect(undefined); setView('pages'); }} onRef={onRef} />
          : view === 'film' ? <Film run={run} project={project} ids={ids} tl={tl} subs={subs} playKey={playKey} onFocus={onSelect} />
          : <Canvas run={run} project={project} ids={ids} tl={tl} onFocus={onSelect} onRef={onRef} />}
      </div>
    </div>
  );
}
