import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Captions, CaptionsOff, Check, ChevronLeft, ChevronRight, Download, Images, Maximize2, MessageSquareText, Quote, TriangleAlert } from 'lucide-react';
import { client, type PageTiming, type ProjectView, type Timeline } from '../lib/client';
import { relPath, STAGE_NAME, STAGES, type PageView, type RunView } from '../lib/run';
import { pageName } from '../lib/describe';
import { Lightbox } from './Lightbox';
import { clip, type Ref } from '../lib/refs';

// The workbench is about the film and its pages, each page's picture next to the words it carries: a film view (player,
// a page lane in proportion to time, the line being spoken), a canvas of page cards, and a focused page to look closely.

const STATUS_TEXT: Record<PageView['status'], string> = { queued: '排队', drawing: '正在画', checking: '自己检查中', ok: '画好了', flagged: '有一处要你看看', failed: '没画出来' };
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

function Thumb({ p, project, poster, className = '' }: { p?: PageView; project: ProjectView; poster?: string; className?: string }) {
  // project-relative: the page's own settled frame (fresh after a redraw), else a frame cut from the film, else its check sheet
  const src = p?.thumb ? relPath(p.thumb, project.id) : poster ?? (p?.sheet ? relPath(p.sheet, project.id) : undefined);
  const working = p?.status === 'drawing' || p?.status === 'checking';
  return (
    <span className={`block overflow-hidden bg-paper-2 ${className.includes('absolute') ? '' : 'relative'} ${className}`}>
      {src && <img src={client.fileUrl(project, src)} alt="" className="absolute inset-0 h-full w-full object-cover object-left-top opacity-0 transition-opacity duration-500 [&.loaded]:opacity-100" ref={(el) => { if (el?.complete && el.naturalWidth) el.classList.add('loaded'); }} onLoad={(e) => e.currentTarget.classList.add('loaded')} />}
      {!src && <span className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-3">{working ? '正在画' : '排队'}</span>}
      {working && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden>
          <rect x="1" y="1" width="158" height="88" rx="6" fill="none" stroke="rgb(var(--fs-accent))" strokeWidth="2" pathLength="100" strokeDasharray="22 78" className="motion-safe:animate-[trace_1.6s_linear_infinite]" style={{ strokeDashoffset: 100 }} />
        </svg>
      )}
      {p?.status === 'ok' && <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-jade text-paper" aria-hidden><Check size={10} strokeWidth={3} /></span>}
      {p?.status === 'flagged' && <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-seal text-paper" aria-hidden><TriangleAlert size={9} strokeWidth={3} /></span>}
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
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [vt, setVt] = useState(0);
  const ft = usePlayerTime(frame).t;
  const okCount = ids.filter((id) => ['ok', 'flagged'].includes(run.pages[id]?.status)).length;
  const t = run.video ? vt : ft;
  const seek = (s: number) => { if (video.current) { video.current.currentTime = s; void video.current.play().catch(() => {}); } else seekFrame(frame.current, s); };

  let screen: React.ReactNode;
  if (run.video) {
    const src = subs ? run.video.path : run.video.noSubs;
    screen = <video ref={video} key={`${src}-${playKey ?? 0}`} controls autoPlay={!!playKey} onTimeUpdate={(e) => setVt(e.currentTarget.currentTime)} className="h-full w-full rounded-xl bg-black object-contain" src={client.fileUrl(project, relPath(src, project.id))} />;
  } else if (okCount > 0) {
    screen = <iframe ref={frame} key={okCount} title="预览：已经画好的页面" src={client.fileUrl(project, 'index.html')} sandbox="allow-scripts" className="h-full w-full rounded-xl border-0 bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />;
  } else {
    const current = STAGES.find((s) => run.stages[s].status === 'running');
    screen = (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-line bg-paper-2/60 text-center">
        <span className="font-display text-[22px] text-ink-2">{run.paused ? '已暂停' : current ? `${STAGE_NAME[current]}中` : run.awaitingApproval ? '等你确认分镜' : '准备开始'}</span>
        <span className="mt-2 max-w-[38ch] text-[12.5px] leading-relaxed text-ink-3">{run.paused ? '已经做好的部分都保留着，在左边点「继续制作」就从停下的地方接着做。' : run.awaitingApproval ? '在左边看一遍分镜，确认或直接说要改哪里。画面会在这里一页一页出现。' : '画好的页面会在这里预览，成片完成后在这里播放。'}</span>
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
          {/* the page lane: each page as wide as its share of the film; the playhead walks across it */}
          <div className="relative flex gap-1" role="list" aria-label="分页时间带">
            {pages.map((pt, i) => {
              const share = total && pt.end != null ? (pt.end - pt.start!) / total : 1 / pages.length;
              const on = cur?.id === pt.id && total > 0;
              const section = run.storyboard?.pages.find((x) => x.id === pt.id)?.section;
              return (
                <div role="listitem" key={pt.id} style={{ flexGrow: share, flexBasis: 0 }} className="min-w-[44px]">
                  <button onClick={() => (pt.start != null ? seek(pt.start) : onFocus(pt.id))} aria-label={`跳到第 ${i + 1} 页${section ? `：${section}` : ''}`} title={section}
                    className={`group relative block h-[58px] w-full overflow-hidden rounded-md ring-offset-2 ring-offset-paper transition-shadow ${on ? 'ring-2 ring-accent' : 'ring-1 ring-line hover:ring-line-2'}`}>
                    <Thumb p={run.pages[pt.id]} project={project} poster={tl?.posters?.[pt.id]} className="absolute inset-0" />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-3 text-left text-[11.5px] font-medium text-white">{i + 1} {section}</span>
                  </button>
                </div>
              );
            })}
            {total > 0 && <span className="pointer-events-none absolute -bottom-1.5 -top-1.5 w-[2px] rounded-full bg-accent shadow-[0_0_0_2px_rgb(var(--fs-paper))]" style={{ left: `${Math.min(100, (t / total) * 100)}%` }} aria-hidden />}
          </div>
          {/* the line being spoken, with the way into this page */}
          <div className="mt-3.5 flex min-h-[44px] items-start gap-4">
            <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-ink" aria-live="off">
              {cur && <span className="mr-2 text-[12.5px] text-ink-3 tabular">{pageName(cur.id)} · {mmss(t)}</span>}
              {line?.text ?? <span className="text-ink-3">口播写好后，每一句会在这里跟着画面走。</span>}
            </p>
            {cur && curIndex >= 0 && <button className="fs-btn fs-btn-secondary fs-btn-sm shrink-0" onClick={() => onFocus(cur.id)}><Maximize2 size={13} aria-hidden /> 细看这一页</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── the canvas: every page, its picture and its words ──────────────────────────────────────────────────────────────

function Canvas({ run, project, ids, tl, onFocus, onRef }: { run: RunView; project: ProjectView; ids: string[]; tl: Timeline | null; onFocus: (id: string) => void; onRef: (r: Ref) => void }) {
  if (!ids.length) return <p className="px-6 py-10 text-center text-[13px] text-ink-3">分镜写好后，每一页会排在这里。</p>;
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <ol className="mx-auto grid max-w-[1280px] gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        {ids.map((id, i) => {
          const p = run.pages[id], sb = run.storyboard?.pages.find((x) => x.id === id), pt = tl?.pages.find((x) => x.id === id);
          const lines = linesOf(id, tl, run);
          return (
            <li key={id} className="group/c relative">
              <button onClick={() => onRef({ kind: 'page', page: id, label: `第 ${i + 1} 页${sb?.section ? `「${sb.section}」` : ''}`, thumb: p?.thumb ? relPath(p.thumb, project.id) : tl?.posters?.[id] })}
                className="fs-lb-btn absolute right-2 top-2 z-10 h-7 w-auto gap-1 px-2.5 text-[11.5px] opacity-0 transition-opacity focus-visible:opacity-100 group-hover/c:opacity-100" title="把这一页加到对话">
                <Quote size={11} aria-hidden /> 引用
              </button>
              <button onClick={() => onFocus(id)} className="group flex h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-surface text-left transition-[border-color,transform] duration-200 hover:-translate-y-px hover:border-line-2">
                <Thumb p={p} project={project} poster={tl?.posters?.[id]} className="aspect-video w-full border-b border-line" />
                <span className="flex flex-1 flex-col px-3.5 pb-3.5 pt-3">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[12px] text-ink-3 tabular">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{sb?.section ?? pageName(id)}</span>
                    {pt && <span className="shrink-0 font-mono text-[11.5px] text-ink-3 tabular">{mmss(pt.start)}–{mmss(pt.end)}</span>}
                  </span>
                  <span className="mt-2 line-clamp-4 text-[12.5px] leading-[1.7] text-ink-2">{lines.map((l) => l.text).join('') || '这一页的口播还没写好'}</span>
                  {p?.status === 'flagged' && p.issues[0] && <span className="mt-2 text-[12px] leading-relaxed text-seal">{p.issues[0]}</span>}
                  {p && p.status !== 'ok' && p.status !== 'flagged' && <span className="mt-2 text-[12px] text-accent-ink">{STATUS_TEXT[p.status]}</span>}
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

/** full-resolution frames of the film at the given times, cut on demand (a few at a time) */
function useFrames(project: ProjectView, times: number[], enabled: boolean) {
  const [paths, setPaths] = useState<Record<string, string>>({});
  const key = times.map((t) => t.toFixed(1)).join(',');
  useEffect(() => {
    if (!enabled || !times.length) return;
    let live = true;
    const queue = times.filter((t) => !paths[t.toFixed(1)]);
    const next = async (): Promise<void> => {
      const t = queue.shift(); if (t == null || !live) return;
      try { const f = await client.frame(project.id, t); if (f && live) setPaths((cur) => ({ ...cur, [t.toFixed(1)]: f })); } catch {}
      return next();
    };
    void Promise.all([next(), next(), next()]);
    return () => { live = false; };
  }, [project.id, key, enabled]);
  return (t: number) => paths[t.toFixed(1)];
}

function Focus({ id, run, project, ids, tl, onFocus, onBack, onRef }: { id: string; run: RunView; project: ProjectView; ids: string[]; tl: Timeline | null; onFocus: (id: string) => void; onBack: () => void; onRef: (r: Ref) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const screenBox = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const cueList = useRef<HTMLOListElement>(null);
  const version = ids.map((x) => `${run.pages[x]?.status ?? ''}${run.pages[x]?.round ?? ''}`).join('|') + (run.video?.path ?? '');
  const { t, playing: running, ready } = usePlayerTime(frame, version);
  const [light, setLight] = useState<{ kind: 'frames' | 'sheet'; i: number } | null>(null);
  const i = ids.indexOf(id), p = run.pages[id], sb = run.storyboard?.pages.find((x) => x.id === id);
  const lines = linesOf(id, tl, run);
  const drawn = p?.status === 'ok' || p?.status === 'flagged' || !!run.video;
  const prev = ids[i - 1], next = ids[i + 1];
  const pt = tl?.pages.find((x) => x.id === id);
  const timed = lines.some((l) => l.abs != null);
  // the player boots straight onto the page it opens on (past the cross-fade from the page before); later turns seek
  const startAt = useRef(0);
  const booted = useRef('');
  if (pt && booted.current !== version) { booted.current = version; startAt.current = Math.min(pt.start + 0.6, pt.end - 0.1); }
  const poster = p?.thumb ? relPath(p.thumb, project.id) : tl?.posters?.[id];
  const moments = useMemo(() => (pt && timed ? lines.map((_, j) => momentOf(lines, j, pt.end)) : []), [pt?.start, pt?.end, lines.length, timed]);
  const frameAt = useFrames(project, moments, !!run.video);
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

  const pageLabel = `第 ${i + 1} 页${sb?.section ? `「${sb.section}」` : ''}`;
  const pageRef: Ref = { kind: 'page', page: id, label: pageLabel, thumb: p?.thumb ? relPath(p.thumb, project.id) : tl?.posters?.[id] };
  const lineRef = (j: number): Ref => ({ kind: 'line', page: id, at: lines[j].abs ?? 0, text: lines[j].text, label: `第 ${i + 1} 页 ${mmss(lines[j].abs ?? 0)}「${clip(lines[j].text, 10)}」` });
  const frameRef = (j: number): Ref | undefined => { const f = frameAt(moments[j]); return f ? { kind: 'frame', page: id, at: moments[j], path: f, text: lines[j]?.text, label: `第 ${i + 1} 页 ${mmss(lines[j]?.abs ?? moments[j])} 的画面` } : undefined; };
  const frameItems = moments.map((m, j) => ({ src: frameAt(m) ? client.fileUrl(project, frameAt(m)!) : '', title: `${pageLabel} · ${mmss(lines[j]?.abs ?? m)}`, caption: lines[j]?.text }));
  const sheetItems = p?.sheet ? [{ src: client.fileUrl(project, relPath(p.sheet, project.id)), title: `${pageLabel} · 第 ${p.round} 轮自检截图`, caption: '导演检查这一页时看的截图，每格左下角是它在成片里的时间' }] : [];

  let screen: React.ReactNode;
  if (drawn) screen = (
    <div ref={screenBox} className="group relative h-full w-full overflow-hidden rounded-xl bg-paper-2">
      {/* until the player has drawn this page, its picture stands in; the player then fades in already on it */}
      {!ready && poster && <img src={client.fileUrl(project, poster)} alt="" className="absolute inset-0 h-full w-full object-contain" />}
      {pt && <iframe ref={frame} key={version} title="预览" src={`${client.fileUrl(project, 'index.html')}?from=${startAt.current.toFixed(2)}`} sandbox="allow-scripts" allowFullScreen
        className={`relative h-full w-full border-0 transition-opacity duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${ready ? 'opacity-100' : 'opacity-0'}`} />}
      <button className="fs-lb-btn absolute right-3 top-3 opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100" onClick={() => void screenBox.current?.requestFullscreen?.()} aria-label="全屏看" title="全屏看"><Maximize2 size={15} /></button>
    </div>
  );
  else screen = (
    <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-line-2 bg-paper-2/50 px-8 text-center">
      <span className="font-display text-[22px] text-ink-2">{p ? STATUS_TEXT[p.status] : '还没开始画'}</span>
      {!!sb?.beats?.length && <ul className="mt-4 max-w-[52ch] space-y-1.5 text-left text-[12.5px] leading-relaxed text-ink-3">{sb.beats.map((b, j) => <li key={j}><span className="mr-2 font-mono text-[11.5px]">{b.at}</span>{b.object}：{b.action}</li>)}</ul>}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-5 pt-4">
        <button className="fs-btn fs-btn-ghost fs-btn-sm" onClick={onBack}><ArrowLeft size={14} aria-hidden /> 全部页面</button>
        <h2 className="min-w-0 truncate text-[14px] font-medium"><span className="mr-2 text-ink-3 tabular">第 {i + 1} 页</span>{sb?.section}</h2>
        {pt && <span className="hidden shrink-0 font-mono text-[11.5px] text-ink-3 tabular sm:inline">{mmss(pt.start)}–{mmss(pt.end)}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {sheetItems.length > 0 && <button className="fs-btn fs-btn-ghost fs-btn-sm" onClick={() => setLight({ kind: 'sheet', i: 0 })} title="导演检查这一页时看的截图"><Images size={14} aria-hidden /> 自检截图</button>}
          <button className="fs-icon-btn" disabled={!prev} onClick={() => prev && onFocus(prev)} aria-label="上一页"><ChevronLeft size={16} /></button>
          <span className="w-[42px] text-center text-[12px] text-ink-3 tabular">{i + 1} / {ids.length}</span>
          <button className="fs-icon-btn" disabled={!next} onClick={() => next && onFocus(next)} aria-label="下一页"><ChevronRight size={16} /></button>
        </span>
      </div>
      <div className="min-h-0 flex-1 px-6 pt-3 [container-type:size]">
        <div className="mx-auto flex h-full items-center justify-center">
          <div className="aspect-video" style={{ width: 'min(100cqw, calc(100cqh * 16 / 9), 1280px)' }}>{screen}</div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1280px] px-6 pb-5 pt-3">
        {moments.length > 0 && !!run.video && (
          <div ref={strip} className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2 pt-1" role="list" aria-label="这一页的关键画面">
            {moments.map((m, j) => {
              const src = frameAt(m), on = j === active && inThis;
              return (
                <div key={j} role="listitem" data-i={j} className="group/f relative shrink-0 snap-start">
                  <button onClick={() => seekFrame(frame.current, m, false)} onDoubleClick={() => src && setLight({ kind: 'frames', i: j })}
                    aria-label={`${mmss(lines[j]?.abs ?? m)} 这一句的画面：${lines[j]?.text ?? ''}`} aria-current={on || undefined}
                    className={`relative block aspect-video w-[132px] overflow-hidden rounded-lg bg-paper-2 ring-offset-2 ring-offset-paper transition-[box-shadow,opacity] duration-150 ${on ? 'ring-2 ring-accent' : 'opacity-75 ring-1 ring-line hover:opacity-100'}`}>
                    {src ? <img src={client.fileUrl(project, src)} alt="" className="h-full w-full object-cover" loading="lazy" />
                      : <span className="absolute inset-0 animate-pulse bg-ink/[0.06]" aria-hidden />}
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 font-mono text-[10px] leading-4 text-white tabular">{mmss(lines[j]?.abs ?? m)}</span>
                  </button>
                  {src && (
                    <span className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/f:opacity-100">
                      <button className="fs-lb-btn h-6 w-6" onClick={() => { const r = frameRef(j); if (r) onRef(r); }} aria-label="把这一帧加到对话" title="加到对话"><Quote size={11} /></button>
                      <button className="fs-lb-btn h-6 w-6" onClick={() => setLight({ kind: 'frames', i: j })} aria-label="放大看这一帧" title="放大看"><Maximize2 size={11} /></button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-2 grid gap-x-6 gap-y-3 md:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <h3 className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-3"><MessageSquareText size={13} aria-hidden /> 这一页的口播{timed ? ' · 点一句从那里播，时间是在成片里的位置' : ''}</h3>
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
                    {l.abs != null && <button onClick={() => onRef(lineRef(j))} className="absolute right-1.5 top-1/2 inline-flex h-6 -translate-y-1/2 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-ink-3 opacity-0 transition-opacity hover:bg-ink/[0.07] hover:text-ink focus-visible:opacity-100 group-hover/l:opacity-100"><Quote size={11} aria-hidden /> 引用</button>}
                  </li>
                );
              }) : <li className="px-2.5 text-[13px] text-ink-3">口播还没写好。</li>}
            </ol>
            {p?.status === 'flagged' && p.issues.length > 0 && <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-seal"><TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />{p.issues.join('；')}</p>}
          </div>
          <div className="flex items-start">
            <button className="fs-btn fs-btn-secondary" onClick={() => onRef(pageRef)} title="把这一页加到对话里，说说想怎么改">改这一页</button>
          </div>
        </div>
      </div>

      {light && (light.kind === 'sheet' ? sheetItems : frameItems).length > 0 && (
        <Lightbox items={light.kind === 'sheet' ? sheetItems : frameItems} index={light.i} onIndex={(n) => { setLight({ ...light, i: n }); if (light.kind === 'frames') seekFrame(frame.current, moments[n], false); }} onClose={() => setLight(null)}
          actions={light.kind === 'frames' ? (_, n) => <button className="fs-btn fs-btn-sm border border-white/15 bg-white/10 text-white hover:bg-white/20" onClick={() => { const r = frameRef(n); if (r) { onRef(r); setLight(null); } }}><Quote size={13} aria-hidden /> 加到对话</button> : undefined} />
      )}
    </div>
  );
}

// ── the workbench ──────────────────────────────────────────────────────────────────────────────────────────────────

export function Stage({ run, project, selected, onSelect, playKey, onRef }: { run: RunView; project: ProjectView; selected?: string; onSelect: (id?: string) => void; playKey?: number; onRef: (r: Ref) => void }) {
  const [view, setView] = useState<'film' | 'pages'>('film');
  const [subs, setSubs] = useState(true);
  const ids = run.pageOrder.length ? run.pageOrder : run.storyboard?.pages.map((p) => p.id) || [];
  const tlKey = `${run.stages.script.status}-${run.stages.narrate.status}-${run.stages.render.status}-${run.video?.path ?? ''}`;
  const tl = useTimeline(project.id, tlKey);
  useEffect(() => { if (playKey) { onSelect(undefined); setView('film'); } }, [playKey]);   // 「播放」from the conversation
  const focused = useMemo(() => (selected && ids.includes(selected) ? selected : undefined), [selected, ids]);
  const cut = run.video ? (subs ? run.video.path : run.video.noSubs) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!focused && (
        <div className="flex items-center gap-3 px-5 pt-4">
          <div className="flex rounded-lg bg-ink/[0.05] p-0.5" role="tablist" aria-label="工作台视图">
            {([['film', '成片'], ['pages', `逐页${ids.length ? ` · ${ids.length}` : ''}`]] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={`rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors ${view === k ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink'}`}>{l}</button>
            ))}
          </div>
          {run.video && cut && (
            <span className="ml-auto flex items-center gap-1.5">
              <button className="fs-btn fs-btn-ghost fs-btn-sm" aria-pressed={subs} onClick={() => setSubs(!subs)} title={subs ? '正在看带字幕的版本' : '正在看无字幕的版本'}>
                {subs ? <Captions size={14} aria-hidden /> : <CaptionsOff size={14} aria-hidden />}{subs ? '字幕：开' : '字幕：关'}
              </button>
              <a className="fs-btn fs-btn-secondary fs-btn-sm" href={client.fileUrl(project, relPath(cut, project.id))} download><Download size={13} aria-hidden /> 下载{subs ? '带字幕版' : '无字幕版'}</a>
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
