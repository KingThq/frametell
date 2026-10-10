import { useEffect, useState } from 'react';
import { ChevronLeft, Pause, Play } from 'lucide-react';
import { client, type ProjectView } from '../lib/client';
import { useLoad, useRun } from '../lib/hooks';
import { money, STAGE_NAME, STAGES } from '../lib/run';
import { TopBar } from '../components/TopBar';
import { Feed } from './Feed';
import { Stage } from './Stage';

export function Workbench({ id, openSettings }: { id: string; openSettings: () => void }) {
  const project = useLoad(() => client.project(id), [id]);
  const { run, conn } = useRun(project.data);
  const [selected, setSelected] = useState<string>();
  useEffect(() => { document.title = project.data ? `${project.data.title} · Frametell` : 'Frametell'; }, [project.data?.title]);

  const running = STAGES.some((s) => run.stages[s].status === 'running') && !run.awaitingApproval;
  const current = STAGES.find((s) => run.stages[s].status === 'running');
  const status = run.video ? '已完成' : run.awaitingApproval ? '等你确认分镜' : current ? `${STAGE_NAME[current]}中` : run.error ? '已暂停' : '准备中';

  if (project.error) return (
    <div className="flex h-full flex-col"><TopBar onSettings={openSettings} /><div className="flex flex-1 items-center justify-center text-[13px] text-ink-3">{project.error} · <a className="ml-1 text-accent-ink" href="#/">回到首页</a></div></div>
  );
  const p = project.data as ProjectView | undefined;
  return (
    <div className="flex h-full flex-col">
      <TopBar onSettings={openSettings}>
        <a href="#/" className="fs-icon-btn -ml-1 shrink-0" aria-label="返回"><ChevronLeft size={16} /></a>
        <h1 className="min-w-0 truncate text-[14px] font-medium">{p?.title ?? ''}</h1>
        <span className={`shrink-0 text-[12.5px] ${run.video ? 'text-jade' : run.awaitingApproval ? 'text-accent-ink' : 'text-ink-3'}`} aria-live="polite">{status}</span>
        {conn === 'reconnecting' && <span className="shrink-0 text-[12px] text-seal">连接中断，正在重连…</span>}
        <span className="ml-auto hidden shrink-0 items-center gap-3 sm:flex">
          <span className="font-mono text-[12.5px] text-ink-2 tabular" title="本项目已花费">{money(run.cost)}</span>
          {p && running && <button className="fs-btn fs-btn-ghost fs-btn-sm" onClick={() => client.stop(p.id)}><Pause size={13} /> 暂停</button>}
          {p && !running && !run.video && !run.awaitingApproval && run.feed.length > 0 && <button className="fs-btn fs-btn-secondary fs-btn-sm" onClick={() => client.start(p.id)}><Play size={13} /> 继续制作</button>}
        </span>
      </TopBar>
      {!p ? <div className="flex-1" /> : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(360px,420px)_1fr]">
          <aside className="min-h-0 border-line bg-paper-2 lg:border-r" aria-label="导演与 Agent">
            <Feed run={run} project={p} onSelectPage={(pid) => setSelected(selected === pid ? undefined : pid)} selected={selected} />
          </aside>
          <section className="hidden min-h-0 lg:block" aria-label="工作台">
            <Stage run={run} project={p} selected={selected} onSelect={setSelected} />
          </section>
        </div>
      )}
    </div>
  );
}
