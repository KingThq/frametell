import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, CircleDashed, Clapperboard, Loader2, RotateCcw, Sparkles, TriangleAlert, Wrench } from 'lucide-react';
import { client, type ProjectView } from '../lib/client';
import { clock, STAGE_NAME, type FeedItem, type PageView, type RunView, type Storyboard } from '../lib/run';
import { Crest } from '../components/Logo';

/** **bold** and `code` only: the director writes plain sentences */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return <>{parts.map((p, i) => p.startsWith('**') ? <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong> : p.startsWith('`') ? <code key={i} className="rounded bg-ink/[0.07] px-1 py-px font-mono text-[0.88em]">{p.slice(1, -1)}</code> : <span key={i}>{p}</span>)}</>;
}

const TOOL_NAME: Record<string, string> = { read: '读取', write: '写入', edit: '修改', bash: '运行', Read: '读取', Write: '写入', Edit: '修改', Bash: '运行', Glob: '查找', Grep: '搜索' };

function Collapsible({ icon, label, children, tone = 'text-ink-3' }: { icon: React.ReactNode; label: React.ReactNode; children: React.ReactNode; tone?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pl-9">
      <button className={`group inline-flex items-center gap-1.5 rounded-md py-0.5 text-[12.5px] ${tone} hover:text-ink`} aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon}<span>{label}</span><ChevronRight size={12} className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="mt-1.5 animate-fade">{children}</div>}
    </div>
  );
}

function ApprovalCard({ sb, project, active }: { sb: Storyboard; project: ProjectView; active: boolean }) {
  const [feedback, setFeedback] = useState('');
  const [sent, setSent] = useState(false);
  const submit = async () => { setSent(true); await client.approve(project.id, feedback.trim() || undefined); };
  const done = !active || sent;
  return (
    <div className={`ml-9 rounded-2xl border ${done ? 'border-line' : 'border-accent/50 shadow-[0_0_0_4px_rgb(var(--fs-accent)/0.07)]'} bg-surface`}>
      <div className="border-b border-line px-4 py-3.5">
        <p className="text-[11.5px] font-medium text-accent-ink">分镜 · {sb.pages.length} 页</p>
        <h3 className="mt-1 text-balance text-[15px] font-semibold leading-snug">{sb.title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{sb.summary}</p>
      </div>
      <ol className="divide-y divide-line">
        {sb.pages.map((p, i) => (
          <li key={p.id} className="flex gap-3 px-4 py-2.5">
            <span className="mt-0.5 w-5 shrink-0 font-mono text-[11.5px] text-ink-3 tabular">{String(i + 1).padStart(2, '0')}</span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium leading-snug">{p.section}</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-3">{(p.beats || []).map((b) => `${b.object}${b.action ? '：' + b.action : ''}`).join(' → ')}</span>
            </span>
          </li>
        ))}
      </ol>
      {done ? (
        <p className="flex items-center gap-1.5 border-t border-line px-4 py-3 text-[12.5px] text-jade"><Check size={14} /> 已确认，开始制作</p>
      ) : (
        <div className="border-t border-line p-3">
          <label htmlFor="sb-feedback" className="sr-only">修改意见</label>
          <textarea id="sb-feedback" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="想改哪里？比如「第 3 页换成天平的比喻」。不改就直接确认。"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
            className="block w-full resize-none rounded-xl border border-line bg-paper-2/60 px-3 py-2.5 text-[13px] leading-relaxed outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-accent focus:ring-4 focus:ring-accent/15" />
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-ink-3">确认后开始写口播、配音和画面</span>
            <button className="fs-btn fs-btn-accent" onClick={submit}>{feedback.trim() ? '按意见修改后继续' : '确认分镜，开始制作'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

const PAGE_STATUS: Record<PageView['status'], { label: string; icon: React.ReactNode }> = {
  queued: { label: '排队', icon: <CircleDashed size={14} className="text-ink-3" /> },
  drawing: { label: '正在画', icon: <Loader2 size={14} className="animate-spin text-accent" /> },
  checking: { label: '自检', icon: <Loader2 size={14} className="animate-spin text-accent" /> },
  ok: { label: '完成', icon: <Check size={14} className="text-jade" /> },
  flagged: { label: '需要关注', icon: <TriangleAlert size={14} className="text-seal" /> },
  failed: { label: '失败', icon: <AlertTriangle size={14} className="text-seal" /> },
};

function PagesBlock({ run, sb, onSelect, selected }: { run: RunView; sb?: Storyboard; onSelect: (id: string) => void; selected?: string }) {
  const ids = run.pageOrder.length ? run.pageOrder : sb?.pages.map((p) => p.id) || [];
  const done = ids.filter((id) => ['ok', 'flagged'].includes(run.pages[id]?.status)).length;
  return (
    <div className="ml-9 rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[13px] font-medium">逐页画面与自检</span>
        <span className="font-mono text-[12px] text-ink-3 tabular">{done}/{ids.length}</span>
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {ids.map((id) => {
          const p = run.pages[id], s = PAGE_STATUS[p?.status ?? 'queued'];
          const section = sb?.pages.find((x) => x.id === id)?.section;
          return (
            <li key={id}>
              <button onClick={() => onSelect(id)} aria-current={selected === id}
                className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink/[0.03] ${selected === id ? 'bg-accent-soft/40' : ''}`}>
                <span className="mt-0.5" aria-label={s.label}>{s.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium"><span className="mr-1.5 font-mono text-[11.5px] text-ink-3">{id}</span>{section}</span>
                    <span className="shrink-0 text-[11.5px] text-ink-3">{s.label}{p?.round ? ` · 第 ${p.round} 轮` : ''}</span>
                  </span>
                  {p?.lastText && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed text-ink-3">{p.lastText}</span>}
                  {p?.status === 'flagged' && p.issues[0] && <span className="mt-0.5 block text-[12px] leading-relaxed text-seal">{p.issues[0]}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Item({ it, run, project, onSelectPage, selected }: { it: FeedItem; run: RunView; project: ProjectView; onSelectPage: (id: string) => void; selected?: string }) {
  switch (it.kind) {
    case 'stage': {
      const st = run.stages[it.stage];
      const took = st.startedAt && st.endedAt ? clock(st.endedAt - st.startedAt) : undefined;
      if (it.status === 'running') return null;
      return (
        <div className="flex items-center gap-3 py-1 pl-9" role="separator">
          <span className={`text-[11.5px] font-medium ${it.status === 'failed' ? 'text-seal' : it.status === 'skipped' ? 'text-ink-3' : 'text-ink-2'}`}>
            {STAGE_NAME[it.stage]}{it.status === 'done' ? '完成' : it.status === 'skipped' ? '跳过' : it.status === 'failed' ? '失败' : ''}{took ? ` · ${took}` : ''}
          </span>
          <span className="h-px flex-1 bg-line" />
          {it.detail && it.status !== 'failed' && <span className="max-w-[55%] truncate text-[11.5px] text-ink-3" title={it.detail}>{it.detail}</span>}
        </div>
      );
    }
    case 'say':
      return (
        <div className="flex gap-3 animate-rise">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-paper-2 ring-1 ring-line"><Crest size={14} /></span>
          <p className="min-w-0 whitespace-pre-wrap text-[13.5px] leading-[1.7] text-ink-2"><Rich text={it.text} /></p>
        </div>
      );
    case 'think':
      return <Collapsible icon={<Sparkles size={12} />} label="思考"><p className="whitespace-pre-wrap border-l border-line pl-3 text-[12.5px] italic leading-relaxed text-ink-3">{it.text}</p></Collapsible>;
    case 'tools':
      return (
        <Collapsible icon={<Wrench size={12} />} label={`${it.calls.length} 个操作`}>
          <ul className="space-y-1 border-l border-line pl-3">
            {it.calls.map((c) => <li key={c.id} className="truncate font-mono text-[11.5px] text-ink-3" title={c.summary}><span className={c.ok === false ? 'text-seal' : 'text-ink-2'}>{TOOL_NAME[c.name] || c.name}</span> {c.summary}</li>)}
          </ul>
        </Collapsible>
      );
    case 'check':
      return it.reds + it.yellows === 0
        ? <p className="flex items-center gap-1.5 pl-9 text-[12.5px] text-jade"><Check size={13} /> 分镜检查通过</p>
        : <Collapsible icon={<TriangleAlert size={12} />} tone={it.reds ? 'text-seal' : 'text-ink-3'} label={`分镜检查：${it.reds} 处要改${it.yellows ? `，${it.yellows} 处提醒` : ''}`}><ul className="space-y-1 border-l border-line pl-3 text-[12px] leading-relaxed text-ink-3">{it.messages.map((m, i) => <li key={i}>{m}</li>)}</ul></Collapsible>;
    case 'approval':
      return <ApprovalCard sb={it.storyboard} project={project} active={run.awaitingApproval && run.feed.filter((f) => f.kind === 'approval').at(-1) === it} />;
    case 'pages':
      return <PagesBlock run={run} sb={run.storyboard} onSelect={onSelectPage} selected={selected} />;
    case 'error':
      return (
        <div className="ml-9 rounded-2xl border border-seal/40 bg-seal-soft/60 px-4 py-3" role="alert">
          <p className="text-[13px] leading-relaxed text-ink">{it.message}</p>
          {run.error === it.message && <button className="fs-btn fs-btn-secondary fs-btn-sm mt-2.5" onClick={() => client.start(project.id)}><RotateCcw size={13} /> 继续制作</button>}
        </div>
      );
    case 'done':
      return (
        <div className="ml-9 flex items-center gap-3 rounded-2xl border border-jade/40 bg-jade-soft/60 px-4 py-3">
          <Clapperboard size={16} className="text-jade" />
          <p className="text-[13px]">成片完成 · {Math.round(it.duration)} 秒{run.gate && !run.gate.red ? '，质量门禁通过' : ''}</p>
        </div>
      );
  }
}

const STYLE_NAME: Record<string, string> = { 'warm-story': '暖调叙事插画', study: '安静书房' };

/** the user's request, as the first message of the conversation */
function Brief({ project }: { project: ProjectView }) {
  return (
    <div className="ml-9 rounded-2xl rounded-tl-md bg-surface px-4 py-3 ring-1 ring-line">
      <p className="text-[13px] leading-relaxed text-ink">{project.notes || `把资料做成一条讲解视频`}</p>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-3">
        {project.materials.map((m) => <span key={m} className="max-w-[200px] truncate" title={m}>{m}</span>)}
        <span>约 {Math.round(project.durationSec / 60)} 分钟</span>
        <span>{STYLE_NAME[project.style] ?? project.style}</span>
        {project.voice?.name && <span>{project.voice.name}配音</span>}
      </p>
    </div>
  );
}

export function Feed({ run, project, onSelectPage, selected }: { run: RunView; project: ProjectView; onSelectPage: (id: string) => void; selected?: string }) {
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => { if (stick.current) end.current?.scrollIntoView({ block: 'end' }); }, [run.feed.length, run.pages]);
  const working = Object.values(run.stages).some((s) => s.status === 'running') && !run.awaitingApproval;
  return (
    <div ref={box} className="h-full overflow-y-auto px-5 pb-6 pt-5" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
      role="log" aria-live="polite" aria-label="制作过程">
      <div className="space-y-3.5">
        <Brief project={project} />
        {run.feed.map((it) => <Item key={it.key} it={it} run={run} project={project} onSelectPage={onSelectPage} selected={selected} />)}
        {working && (
          <p className="flex items-center gap-2 pl-9 text-[12.5px] text-ink-3">
            <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-accent" aria-hidden />
            {STAGE_NAME[(Object.entries(run.stages).find(([, s]) => s.status === 'running')?.[0] ?? 'storyboard') as keyof typeof STAGE_NAME]}进行中
          </p>
        )}
      </div>
      <div ref={end} />
    </div>
  );
}
