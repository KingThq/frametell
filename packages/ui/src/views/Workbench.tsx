import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Pause, Play } from 'lucide-react';
import { client, type ProjectView } from '../lib/client';
import { useLoad, useRun } from '../lib/hooks';
import { money, STAGE_NAME, type RunView } from '../lib/run';
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

export function Workbench({ id, openSettings }: { id: string; openSettings: () => void }) {
  const project = useLoad(() => client.project(id), [id]);
  const { run, conn } = useRun(project.data);
  const [selected, setSelected] = useState<string>();
  const [playKey, setPlayKey] = useState(0);
  const [pane, setPane] = useState<'talk' | 'stage'>('talk');   // narrow windows show one pane at a time
  useEffect(() => { document.title = project.data ? `${project.data.title} · Frametell` : 'Frametell'; }, [project.data?.title]);

  const running = !!run.current && !run.awaitingApproval;
  const status = run.video && !running ? '已完成' : run.awaitingApproval ? '等你确认分镜' : run.paused ? '已暂停' : run.current ? `${STAGE_NAME[run.current]}中` : '准备中';
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
        <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
          <aside className={`min-h-0 min-w-0 border-line bg-paper-2 lg:block lg:border-r ${pane === 'talk' ? 'block' : 'hidden'}`} aria-label="和导演的对话">
            <Conversation run={run} project={p} onSelectPage={(pid) => { setSelected(pid); setPane('stage'); }} selected={selected} onPlay={play} />
          </aside>
          <section className={`min-h-0 min-w-0 lg:block ${pane === 'stage' ? 'block' : 'hidden'}`} aria-label="工作台">
            <Stage run={run} project={p} selected={selected} onSelect={setSelected} playKey={playKey}
              onCompose={(text) => { setPane('talk'); dispatchEvent(new CustomEvent('studio:compose', { detail: text })); }} />
          </section>
        </main>
      )}
    </div>
  );
}
