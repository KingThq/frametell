import { useEffect, useState } from 'react';
import { ChevronLeft, Pause, Play } from 'lucide-react';
import { client, type ProjectView } from '../lib/client';
import { useLoad, useRun } from '../lib/hooks';
import { money, STAGE_NAME } from '../lib/run';
import { TopBar } from '../components/TopBar';
import { Conversation } from './Conversation';
import { Stage } from './Stage';

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
          <span className="hidden font-mono text-[12.5px] text-ink-2 tabular sm:inline" title="本项目已花费">{money(run.cost)}</span>
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
            <Conversation run={run} project={p} onSelectPage={(pid) => { setSelected(selected === pid ? undefined : pid); setPane('stage'); }} selected={selected} onPlay={play} />
          </aside>
          <section className={`min-h-0 min-w-0 lg:block ${pane === 'stage' ? 'block' : 'hidden'}`} aria-label="工作台">
            <Stage run={run} project={p} selected={selected} onSelect={setSelected} playKey={playKey} />
          </section>
        </main>
      )}
    </div>
  );
}
