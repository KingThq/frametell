import { useMemo, useState } from 'react';
import { Check, Download, FolderOpen, Loader2, TriangleAlert } from 'lucide-react';
import { client, type ProjectView } from '../lib/client';
import { clock, money, relPath, STAGE_NAME, STAGES, type PageView, type RunView } from '../lib/run';
import { useNow } from '../lib/hooks';

/** one page in the film strip; while it is being drawn a caramel line travels its border */
function Tile({ p, project, index, selected, onClick, section }: { p?: PageView; project: ProjectView; index: number; selected: boolean; onClick: () => void; section?: string }) {
  const status = p?.status ?? 'queued';
  const working = status === 'drawing' || status === 'checking';
  const thumb = p?.sheet ? client.fileUrl(project, relPath(p.sheet, project.id)) : undefined;
  return (
    <button onClick={onClick} aria-pressed={selected} title={section}
      className={`group relative aspect-video w-[132px] shrink-0 overflow-hidden rounded-lg text-left transition-[transform,box-shadow] duration-200 ease-out ${selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-paper' : 'hover:-translate-y-px'} ${status === 'queued' ? 'border border-dashed border-line-2 bg-paper-2/40' : 'border border-line bg-paper-2'}`}>
      {thumb && <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover object-left-top opacity-0 transition-opacity duration-500 [&.loaded]:opacity-100" onLoad={(e) => e.currentTarget.classList.add('loaded')} />}
      {working && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 132 74.25" preserveAspectRatio="none" aria-hidden>
          <rect x="1" y="1" width="130" height="72.25" rx="7" fill="none" stroke="rgb(var(--fs-accent))" strokeWidth="2" pathLength="100" strokeDasharray="22 78" className="motion-safe:animate-[trace_1.6s_linear_infinite]" style={{ strokeDashoffset: 100 }} />
        </svg>
      )}
      <span className="absolute bottom-1 left-1.5 rounded bg-black/55 px-1 py-px font-mono text-[10px] text-white/90 tabular">{String(index + 1).padStart(2, '0')}</span>
      {status === 'ok' && <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-jade text-paper" aria-label="完成"><Check size={10} strokeWidth={3} /></span>}
      {status === 'flagged' && <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-seal text-paper" aria-label="需要关注"><TriangleAlert size={9} strokeWidth={3} /></span>}
      {status === 'queued' && <span className="absolute inset-0 flex items-center justify-center text-[11px] text-ink-3">排队</span>}
    </button>
  );
}

function Progress({ run, project }: { run: RunView; project: ProjectView }) {
  const now = useNow(STAGES.some((s) => run.stages[s].status === 'running'));
  return (
    <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
      <ol className="space-y-2.5">
        {STAGES.map((s) => {
          const st = run.stages[s];
          const took = st.startedAt ? (st.endedAt ?? now) - st.startedAt : 0;
          return (
            <li key={s} className="flex items-center gap-3 text-[13px]">
              <span className="w-4">
                {st.status === 'done' ? <Check size={14} className="text-jade" /> : st.status === 'running' ? <Loader2 size={14} className="animate-spin text-accent" /> : st.status === 'failed' ? <TriangleAlert size={14} className="text-seal" /> : <span className="mx-auto block h-1.5 w-1.5 rounded-full bg-line-2" />}
              </span>
              <span className={st.status === 'pending' ? 'text-ink-3' : 'text-ink'}>{STAGE_NAME[s]}</span>
              <span className="h-px flex-1 bg-line" />
              <span className="font-mono text-[12px] text-ink-3 tabular">{st.status === 'skipped' ? '跳过' : took ? clock(took) : ''}</span>
            </li>
          );
        })}
      </ol>
      <dl className="grid min-w-[180px] content-start gap-3 text-[12.5px]">
        <div><dt className="text-ink-3">已花费</dt><dd className="mt-0.5 font-mono text-[18px] text-ink tabular">{money(run.cost)}</dd></div>
        <div><dt className="text-ink-3">模型</dt><dd className="mt-0.5 text-ink-2">{project.model.split('/').pop()}</dd></div>
        {run.cost && <div><dt className="text-ink-3">token</dt><dd className="mt-0.5 font-mono text-[11.5px] text-ink-2 tabular">输入 {fmtK(run.cost.usage.input + run.cost.usage.cacheRead)} · 输出 {fmtK(run.cost.usage.output)}</dd><dd className="text-[11.5px] text-ink-3">缓存命中 {pct(run.cost.usage.cacheRead, run.cost.usage.input + run.cost.usage.cacheRead)}</dd></div>}
      </dl>
    </div>
  );
}
const fmtK = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n));
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) + '%' : '—');

function StoryboardTab({ run }: { run: RunView }) {
  if (!run.storyboard) return <p className="text-[13px] text-ink-3">分镜写好后会出现在这里。</p>;
  return (
    <ol className="space-y-4">
      {run.storyboard.pages.map((p, i) => (
        <li key={p.id} className="grid grid-cols-[28px_1fr] gap-3">
          <span className="font-mono text-[12px] text-ink-3 tabular">{String(i + 1).padStart(2, '0')}</span>
          <div>
            <p className="text-[13.5px] font-medium">{p.section}</p>
            <p className="mt-1 max-w-[70ch] text-[12.5px] leading-relaxed text-ink-2">{p.say}</p>
            <ul className="mt-2 space-y-1">{(p.beats || []).map((b, j) => <li key={j} className="text-[12px] leading-relaxed text-ink-3"><span className="mr-2 font-mono text-[11px]">{b.at}</span>{b.object} — {b.action}{b.text ? `「${b.text}」` : ''}</li>)}</ul>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ExportTab({ run, project }: { run: RunView; project: ProjectView }) {
  if (!run.video) return <p className="text-[13px] text-ink-3">渲染完成后，可以在这里下载成片。</p>;
  const files = [{ label: '成片（带字幕）', rel: relPath(run.video.path, project.id) }, { label: '成片（无字幕）', rel: relPath(run.video.noSubs, project.id) }];
  return (
    <div className="space-y-3">
      {files.map((f) => (
        <a key={f.rel} href={client.fileUrl(project, f.rel)} download className="flex items-center justify-between rounded-xl border border-line px-4 py-3 text-[13px] transition-colors hover:border-line-2 hover:bg-surface-2">
          <span>{f.label}<span className="ml-2 text-ink-3">MP4 · 1080p · {Math.round(run.video!.duration)} 秒</span></span>
          <Download size={15} className="text-ink-3" />
        </a>
      ))}
      <p className="flex items-center gap-1.5 pt-1 text-[12px] text-ink-3"><FolderOpen size={13} /> 项目文件夹：~/.frametell/projects/{project.id}</p>
    </div>
  );
}

export function Stage({ run, project, selected, onSelect }: { run: RunView; project: ProjectView; selected?: string; onSelect: (id?: string) => void }) {
  const [tab, setTab] = useState<'progress' | 'storyboard' | 'export'>('progress');
  const ids = run.pageOrder.length ? run.pageOrder : run.storyboard?.pages.map((p) => p.id) || [];
  const okCount = ids.filter((id) => ['ok', 'flagged'].includes(run.pages[id]?.status)).length;
  const sel = selected ? run.pages[selected] : undefined;
  const preview = useMemo(() => client.fileUrl(project, 'index.html'), [project.id, project.previewBase]);

  let screen: React.ReactNode;
  if (sel?.sheet) {
    screen = (
      <figure className="flex h-full flex-col">
        <img src={client.fileUrl(project, relPath(sel.sheet, project.id))} alt={`${sel.id} 第 ${sel.round} 轮检查截图`} className="min-h-0 flex-1 rounded-xl object-contain" />
        <figcaption className="mt-3 flex items-start justify-between gap-4 text-[12.5px]">
          <span className="text-ink-2"><span className="font-mono text-ink-3">{sel.id}</span> · 第 {sel.round} 轮自检截图{sel.issues.length ? ` · ${sel.issues.length} 个待改问题` : ''}</span>
          <button className="fs-btn fs-btn-ghost fs-btn-sm -mt-1" onClick={() => onSelect(undefined)}>回到预览</button>
        </figcaption>
      </figure>
    );
  } else if (run.video) {
    screen = <video key={run.video.path} controls className="h-full w-full rounded-xl bg-black object-contain" src={client.fileUrl(project, relPath(run.video.path, project.id))} />;
  } else if (okCount > 0) {
    screen = <iframe key={okCount} title="预览" src={preview} sandbox="allow-scripts" className="h-full w-full rounded-xl border-0 bg-black" />;
  } else {
    const current = STAGES.find((s) => run.stages[s].status === 'running');
    screen = (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-line bg-paper-2/60 text-center">
        <span className="font-display text-[22px] text-ink-2">{current ? `${STAGE_NAME[current]}中` : run.awaitingApproval ? '等你确认分镜' : '准备开始'}</span>
        <span className="mt-2 max-w-[38ch] text-[12.5px] leading-relaxed text-ink-3">{run.awaitingApproval ? '在左边看一遍分镜，确认或写下修改意见。画面会在这里一页一页出现。' : '画好的页面会在这里预览，成片完成后在这里播放。'}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 px-6 pt-5">
        <div className="mx-auto flex h-full max-h-[calc((100vw-460px)*0.5625)] max-w-[1280px] items-center justify-center">
          <div className="aspect-video max-h-full w-full">{screen}</div>
        </div>
      </div>
      {ids.length > 0 && (
        <div className="px-6 pt-4">
          <div className="flex gap-2.5 overflow-x-auto pb-1" role="list" aria-label="分页">
            {ids.map((id, i) => <div role="listitem" key={id}><Tile p={run.pages[id]} index={i} project={project} selected={selected === id} section={run.storyboard?.pages.find((p) => p.id === id)?.section} onClick={() => onSelect(selected === id ? undefined : id)} /></div>)}
          </div>
        </div>
      )}
      <div className="mt-4 border-t border-line">
        <div className="flex gap-1 px-5" role="tablist">
          {([['progress', '进度'], ['storyboard', '分镜'], ['export', '导出']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`relative px-3 py-2.5 text-[13px] font-medium transition-colors ${tab === k ? 'text-ink' : 'text-ink-3 hover:text-ink'}`}>
              {l}{k === 'export' && run.video ? <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-jade align-middle" /> : null}
              <span className={`absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-ink transition-opacity ${tab === k ? 'opacity-100' : 'opacity-0'}`} />
            </button>
          ))}
        </div>
        <div className="h-[220px] overflow-y-auto px-6 py-4" role="tabpanel">
          {tab === 'progress' ? <Progress run={run} project={project} /> : tab === 'storyboard' ? <StoryboardTab run={run} /> : <ExportTab run={run} project={project} />}
        </div>
      </div>
    </div>
  );
}
