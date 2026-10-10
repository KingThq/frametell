import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Pause, Play } from 'lucide-react';
import { client, type ProjectView } from '../lib/client';
import { useLoad, useRun } from '../lib/hooks';
import { isWorking, money, STAGE_NAME, type RunView } from '../lib/run';
import { TopBar } from '../components/TopBar';
import { Conversation } from './Conversation';
import { Stage } from './Stage';

const fmtK = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n));

/** what this film has cost; the details (model, tokens, cache) open on click instead of crowding the workbench */
function CostChip({ run, project }: { run: RunView; project: ProjectView }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('mousedown', off); addEventListener('keydown', off);
    return () => { removeEventListener('mousedown', off); removeEventListener('keydown', off); };
  }, [open]);
  const u = run.cost?.usage;
  const seen = u ? u.input + u.cacheRead : 0;
  return (
    <span ref={box} className="relative">
      <button className="fs-btn fs-btn-ghost fs-btn-sm font-mono tabular" aria-expanded={open} onClick={() => setOpen(!open)} title="本项目已花费">{money(run.cost)}</button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-[240px] rounded-xl border border-line bg-surface p-4 shadow-xl animate-fade" role="dialog" aria-label="花费明细">
          <p className="text-[12px] text-ink-3">这条视频已花费</p>
          <p className="mt-0.5 font-mono text-[22px] text-ink tabular">{money(run.cost)}</p>
          <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-[12.5px]">
            <div className="flex justify-between gap-3"><dt className="text-ink-3">模型</dt><dd className="truncate text-ink-2">{project.model.split('/').pop()}</dd></div>
            {u && <div className="flex justify-between gap-3"><dt className="text-ink-3">读入</dt><dd className="font-mono text-ink-2 tabular">{fmtK(seen)} token</dd></div>}
            {u && <div className="flex justify-between gap-3"><dt className="text-ink-3">写出</dt><dd className="font-mono text-ink-2 tabular">{fmtK(u.output)} token</dd></div>}
            {u && seen > 0 && <div className="flex justify-between gap-3"><dt className="text-ink-3">缓存命中</dt><dd className="font-mono text-ink-2 tabular">{Math.round((100 * u.cacheRead) / seen)}%</dd></div>}
          </dl>
        </div>
      )}
    </span>
  );
}

const LEFT_KEY = 'fs.workbench.left', LEFT_DEFAULT = 420, LEFT_MIN = 320;
const readLeft = () => { try { const n = Number(localStorage.getItem(LEFT_KEY)); return n > 0 ? n : LEFT_DEFAULT; } catch { return LEFT_DEFAULT; } };

export function Workbench({ id, openSettings }: { id: string; openSettings: () => void }) {
  const project = useLoad(() => client.project(id), [id]);
  const { run, conn } = useRun(project.data);
  const [selected, setSelected] = useState<string>();
  const [playKey, setPlayKey] = useState(0);
  const [pane, setPane] = useState<'talk' | 'stage'>('talk');   // narrow windows show one pane at a time
  const main = useRef<HTMLElement>(null);
  const [box, setBox] = useState(0);
  const [left, setLeft] = useState(readLeft);
  const [drag, setDrag] = useState(false);
  const hasMain = !!project.data;
  useEffect(() => {
    const el = main.current; if (!el) return;
    const ro = new ResizeObserver(() => setBox(el.clientWidth)); ro.observe(el); setBox(el.clientWidth);
    return () => ro.disconnect();
  }, [hasMain]);
  const maxLeft = Math.max(LEFT_MIN, Math.min(720, box ? box * 0.6 : 720));
  const width = Math.round(Math.min(maxLeft, Math.max(LEFT_MIN, left)));
  const setWidth = (w: number, save = true) => {
    const v = Math.round(Math.min(maxLeft, Math.max(LEFT_MIN, w))); setLeft(v);
    if (save) try { localStorage.setItem(LEFT_KEY, String(v)); } catch { /* private mode */ }
  };
  const onSash = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !main.current) return;
    setWidth(e.clientX - main.current.getBoundingClientRect().left, false);
  };
  const endSash = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag(false); e.currentTarget.releasePointerCapture?.(e.pointerId);
    try { localStorage.setItem(LEFT_KEY, String(width)); } catch { /* private mode */ }
  };
  useEffect(() => { document.title = project.data ? `${project.data.title} · Frametell` : 'Frametell'; }, [project.data?.title]);

  const running = isWorking(run);
  const status = run.revising ? '修改中' : run.video && !running ? '已完成' : run.awaitingApproval ? '等你确认分镜' : run.paused ? '已暂停' : run.current ? `${STAGE_NAME[run.current]}中` : '准备中';
  const play = () => { setSelected(undefined); setPane('stage'); setPlayKey((k) => k + 1); };

  if (project.error) return (
    <div className="flex h-full flex-col"><TopBar onSettings={openSettings} /><main className="flex flex-1 items-center justify-center text-[13px] text-ink-3">{project.error} · <a className="ml-1 text-accent-ink" href="#/">回到首页</a></main></div>
  );
  const p = project.data as ProjectView | undefined;
  return (
    <div className="flex h-full flex-col">
      <TopBar onSettings={openSettings}>
        <a href="#/" className="fs-icon-btn -ml-1 shrink-0" aria-label="返回首页"><ChevronLeft size={16} /></a>
        <h1 className="min-w-0 truncate text-[14px] font-medium">{p?.title ?? ''}</h1>
        <span className={`hidden shrink-0 text-[12.5px] sm:inline ${run.video && !running ? 'text-jade' : run.awaitingApproval ? 'text-accent-ink' : 'text-ink-3'}`} aria-live="polite">{status}</span>
        {conn === 'reconnecting' && <span className="shrink-0 rounded-full bg-seal-soft px-2 py-0.5 text-[12px] text-seal" role="status">连接中断，正在重连</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {p && <CostChip run={run} project={p} />}
          {p && running && <button className="fs-btn fs-btn-ghost fs-btn-sm" onClick={() => client.stop(p.id)} title="随时可以继续，已做好的不会重做"><Pause size={13} aria-hidden /> 暂停</button>}
          {p && run.paused && <button className="fs-btn fs-btn-secondary fs-btn-sm" onClick={() => client.start(p.id)}><Play size={13} aria-hidden /> 继续制作</button>}
        </span>
      </TopBar>
      {p && (
        <div className="flex border-b border-line lg:hidden" role="tablist" aria-label="视图">
          {([['talk', '对话'], ['stage', '画面']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={pane === k} onClick={() => setPane(k)} className={`flex-1 py-2.5 text-[13px] font-medium ${pane === k ? 'text-ink shadow-[inset_0_-2px_0_rgb(var(--fs-ink))]' : 'text-ink-3'}`}>{l}</button>
          ))}
        </div>
      )}
      {!p ? <div className="flex-1" /> : (
        <main ref={main} style={{ '--fs-left': `${width}px` } as React.CSSProperties} className={`relative grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[var(--fs-left)_minmax(0,1fr)] ${drag ? 'select-none [&_iframe]:pointer-events-none' : ''}`}>
          <aside className={`min-h-0 min-w-0 border-line bg-paper-2 lg:block lg:border-r ${pane === 'talk' ? 'block' : 'hidden'}`} aria-label="和导演的对话">
            <Conversation run={run} project={p} onSelectPage={(pid) => { setSelected(pid); setPane('stage'); }} selected={selected} onPlay={play} />
          </aside>
          <section className={`min-h-0 min-w-0 lg:block ${pane === 'stage' ? 'block' : 'hidden'}`} aria-label="工作台">
            <Stage run={run} project={p} selected={selected} onSelect={setSelected} playKey={playKey}
              onCompose={(text) => { setPane('talk'); dispatchEvent(new CustomEvent('studio:compose', { detail: text })); }} />
          </section>
          <div role="separator" aria-orientation="vertical" aria-label="调整对话栏宽度" aria-valuenow={width} aria-valuemin={LEFT_MIN} aria-valuemax={Math.round(maxLeft)} tabIndex={0}
            style={{ left: width - 4 }}
            className={`group absolute inset-y-0 z-10 hidden w-2 cursor-col-resize touch-none outline-none lg:block ${drag ? 'cursor-col-resize' : ''}`}
            onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(true); e.preventDefault(); }}
            onPointerMove={onSash} onPointerUp={endSash} onPointerCancel={endSash}
            onDoubleClick={() => setWidth(LEFT_DEFAULT)}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth(width + (e.key === 'ArrowLeft' ? -16 : 16)); } }}>
            <span className={`absolute inset-y-0 left-[3px] transition-colors group-hover:w-[2px] group-hover:bg-accent group-focus-visible:w-[2px] group-focus-visible:bg-accent ${drag ? 'w-[2px] bg-accent' : 'w-px bg-transparent'}`} />
          </div>
        </main>
      )}
    </div>
  );
}
