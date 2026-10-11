import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, CircleDashed, Clapperboard, Download, Loader2, Pause, Play, TriangleAlert } from 'lucide-react';
import { client, type ProjectView } from '../lib/client';
import { clock, film, finished, money, relPath, STAGE_NAME, STAGES, type FeedItem, type PageView, type RunView, type Stage, type Storyboard, isWorking } from '../lib/run';
import { pageName, stepText, summarizeTools } from '../lib/describe';
import { useNow } from '../lib/hooks';
import { Crest } from '../components/Logo';
import { STYLE_NAME } from '../lib/styles';
import { Composer, RefChip } from './Composer';
import { ExportControls } from './Export';
import type { Ref } from '../lib/refs';

// ── small pieces ────────────────────────────────────────────────────────────────────────────────────────────────────

/** **bold** and `code` only: the director writes plain sentences */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return <>{parts.map((p, i) => (p.startsWith('**') ? <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong> : p.startsWith('`') ? <code key={i} className="rounded bg-ink/[0.07] px-1 py-px font-mono text-[0.86em]">{p.slice(1, -1)}</code> : <span key={i}>{p}</span>))}</>;
}

/** the director's words; long reports fold to a few lines */
function Said({ text }: { text: string }) {
  const long = text.length > 220;
  const [open, setOpen] = useState(false);
  return (
    <div className="animate-rise">
      <p className={`whitespace-pre-wrap text-[13.5px] leading-[1.75] text-ink-2 ${long && !open ? 'line-clamp-5' : ''}`}><Rich text={text} /></p>
      {long && <button className="mt-1 text-[12.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline" onClick={() => setOpen(!open)}>{open ? '收起' : '展开全文'}</button>}
    </div>
  );
}

/** a stage's work in plain words, folded: 「过程 · 读资料《番茄工作法》、写分镜、检查分镜 2 次」 */
function Process({ items }: { items: FeedItem[] }) {
  const [open, setOpen] = useState(false);
  const steps = useMemo(() => summarizeTools(items.flatMap((i) => (i.kind === 'tools' ? i.calls : []))), [items]);
  const thoughts = items.filter((i): i is Extract<FeedItem, { kind: 'think' }> => i.kind === 'think');
  if (!steps.length && !thoughts.length) return null;
  const preview = steps.slice(0, 3).map(stepText).join('、') + (steps.length > 3 ? ` 等 ${steps.length} 步` : '');
  return (
    <div>
      <button className="group flex max-w-full items-center gap-1.5 text-left text-[12.5px] text-ink-3 hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={13} className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} aria-hidden />
        <span className="truncate">过程{preview ? ` · ${preview}` : ''}</span>
      </button>
      {open && (
        <ol className="mt-2 space-y-1.5 animate-fade pl-5">
          {steps.map((s, i) => <li key={i} className="text-[12.5px] text-ink-2">{s.text}{s.count > 1 && <span className="ml-1 text-ink-3">{s.count} 次</span>}</li>)}
          {thoughts.map((t) => <li key={t.key} className="line-clamp-3 border-l border-line pl-2.5 text-[12px] italic leading-relaxed text-ink-3">{t.text}</li>)}
        </ol>
      )}
    </div>
  );
}

/** stage detail in people's words: "pages=5 cues=16 duration=01:05.7" → "5 页 · 16 句 · 约 1 分 06 秒" */
function humanDetail(stage: Stage, detail?: string, sb?: Storyboard) {
  if (!detail) return stage === 'storyboard' && sb ? `${sb.pages.length} 页` : undefined;
  const m = /pages=(\d+) cues=(\d+) duration=(\d+):([\d.]+)/.exec(detail);
  if (m) return `${m[1]} 页 · ${m[2]} 句 · 约 ${+m[3] ? `${+m[3]} 分 ` : ''}${Math.round(+m[4])} 秒`;
  const s = /^([\d.]+)s/.exec(detail);
  if (s && stage === 'narrate') return `配音 ${Math.round(+s[1])} 秒`;
  return detail.length > 40 ? undefined : detail;
}

function StageMark({ n, status }: { n: number; status: RunView['stages'][Stage]['status'] }) {
  const base = 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular';
  if (status === 'done' || status === 'skipped') return <span className={`${base} bg-jade-soft text-jade`} aria-hidden><Check size={12} strokeWidth={3} /></span>;
  if (status === 'running') return <span className={`${base} bg-accent-soft text-accent-ink`} aria-hidden><Loader2 size={12} className="animate-spin" /></span>;
  if (status === 'failed') return <span className={`${base} bg-seal-soft text-seal`} aria-hidden><TriangleAlert size={11} /></span>;
  return <span className={`${base} border border-line-2 text-ink-3`} aria-hidden>{n}</span>;
}

const STAGE_DOING: Record<Stage, string> = { storyboard: '正在构思分镜', script: '正在写口播', narrate: '正在配音', pages: '正在逐页作画', review: '正在检查全片', render: '正在渲染成片' };

// ── cards ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function Approval({ sb, project, active }: { sb: Storyboard; project: ProjectView; active: boolean }) {
  const [sent, setSent] = useState(false);
  const live = active && !sent;
  return (
    <div className={`rounded-2xl border bg-surface transition-shadow duration-300 ${live ? 'border-accent/50 shadow-[0_0_0_4px_rgb(var(--fs-accent)/0.07)]' : 'border-line'}`}>
      <div className="px-4 pb-3 pt-3.5">
        <h4 className="text-balance text-[14.5px] font-semibold leading-snug">{sb.title}</h4>
        {sb.summary && sb.summary !== sb.title && <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{sb.summary}</p>}
      </div>
      <ol className="divide-y divide-line border-t border-line">
        {sb.pages.map((p, i) => (
          <li key={p.id} className="grid grid-cols-[22px_1fr] gap-2 px-4 py-2.5">
            <span className="pt-px font-mono text-[12px] text-ink-3 tabular">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium leading-snug">{p.section}</span>
              {p.say && <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-relaxed text-ink-3">{p.say}</span>}
            </span>
          </li>
        ))}
      </ol>
      {live ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <span className="text-[12.5px] text-ink-3">要改哪里，直接在下面说</span>
          <button className="fs-btn fs-btn-accent" onClick={async () => { setSent(true); await client.approve(project.id); }}>确认分镜，开始制作</button>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 border-t border-line px-4 py-3 text-[12.5px] text-jade"><Check size={14} aria-hidden /> 已确认</p>
      )}
    </div>
  );
}

const PAGE_STATE: Record<PageView['status'], { text: (p?: PageView) => string; icon: React.ReactNode; tone: string }> = {
  queued: { text: () => '排队', icon: <CircleDashed size={14} />, tone: 'text-ink-3' },
  drawing: { text: (p) => `正在画${p?.progress ? ` · ${p.progress}` : ''}`, icon: <Loader2 size={14} className="animate-spin" />, tone: 'text-accent-ink' },
  checking: { text: (p) => `自己检查${p?.round ? `（第 ${p.round} 遍）` : ''}`, icon: <Loader2 size={14} className="animate-spin" />, tone: 'text-accent-ink' },
  ok: { text: () => '画好了', icon: <Check size={14} />, tone: 'text-jade' },
  flagged: { text: () => '画好了，有一处要你看看', icon: <TriangleAlert size={14} />, tone: 'text-seal' },
  failed: { text: () => '没画出来', icon: <TriangleAlert size={14} />, tone: 'text-seal' },
};

function Pages({ run, onSelect, selected }: { run: RunView; onSelect: (id: string) => void; selected?: string }) {
  const ids = run.pageOrder.length ? run.pageOrder : run.storyboard?.pages.map((p) => p.id) || [];
  return (
    <ul className="space-y-0.5" aria-label="逐页进度">
      {ids.map((id) => {
        const p = run.pages[id], st = PAGE_STATE[p?.status ?? 'queued'];
        const section = run.storyboard?.pages.find((x) => x.id === id)?.section;
        return (
          <li key={id}>
            <button onClick={() => onSelect(id)} aria-pressed={selected === id}
              className={`-mx-2 flex w-[calc(100%+16px)] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink/[0.04] ${selected === id ? 'bg-accent-soft/50' : ''}`}>
              <span className={`shrink-0 ${st.tone}`} aria-hidden>{st.icon}</span>
              <span className="w-[42px] shrink-0 text-[12.5px] text-ink-3 tabular">{pageName(id)}</span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{section}</span>
              <span className={`shrink-0 text-[12px] ${st.tone}`}>{st.text(p)}</span>
            </button>
            {p?.status === 'flagged' && p.issues[0] && <p className="ml-[54px] pb-1 text-[12px] leading-relaxed text-seal">{p.issues[0]}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function PausedCard({ item, run, project, latest }: { item: Extract<FeedItem, { kind: 'paused' }>; run: RunView; project: ProjectView; latest: boolean }) {
  const where = item.stage ? `「${STAGE_NAME[item.stage]}」这一步` : '这里';
  const text = item.reason === 'user' ? `已在${where}暂停。` : item.reason === 'interrupted' ? `上次在${where}停下了：应用被关闭或中断。` : `在${where}出错停下了：${item.message ?? '未知错误'}`;
  const canContinue = latest && !!run.paused;
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3.5">
      <p className="flex items-start gap-2 text-[13.5px] leading-relaxed text-ink">
        {item.reason === 'error' ? <TriangleAlert size={15} className="mt-0.5 shrink-0 text-seal" aria-hidden /> : <Pause size={15} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />}
        <span>{text}</span>
      </p>
      <p className="ml-[23px] mt-1 text-[12.5px] leading-relaxed text-ink-3">已经做好的部分都保留着，继续不会重做，也不会重复花钱。</p>
      {canContinue && <button className="fs-btn fs-btn-accent ml-[23px] mt-3" onClick={() => client.start(project.id)}><Play size={14} aria-hidden /> 继续制作</button>}
    </div>
  );
}

function DoneCard({ run, project, onPlay }: { run: RunView; project: ProjectView; onPlay: () => void }) {
  const ids = run.pageOrder;
  const poster = ids.map((id) => run.pages[id]?.thumb).find(Boolean);
  const took = run.startedAt && run.activeAt ? clock((run.ready?.at ?? run.activeAt) - run.startedAt) : undefined;
  const seconds = run.ready?.duration ?? run.video?.duration;
  return (
    <div className="overflow-hidden rounded-2xl border border-jade/30 bg-surface animate-rise">
      {poster && (
        <button onClick={onPlay} className="group relative block aspect-video w-full overflow-hidden" aria-label="播放">
          <img src={client.fileUrl(project, relPath(poster, project.id))} alt="" className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.02]" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/30">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-paper/90 text-ink shadow-lg"><Play size={20} className="translate-x-px" aria-hidden /></span>
          </span>
        </button>
      )}
      <div className="px-4 py-4">
        <p className="font-display text-[22px] leading-tight text-ink">你的视频好了</p>
        <p className="mt-1.5 text-[12.5px] text-ink-3 tabular">{seconds ? `${Math.round(seconds)} 秒` : ''}{took ? ` · 做了 ${took}` : ''} · 花费 {money(run.cost)}</p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          <button className="fs-btn fs-btn-accent" onClick={onPlay}><Clapperboard size={14} aria-hidden /> 播放</button>
          <ExportControls run={run} project={project} />
        </div>
        <p className="mt-3 text-[12.5px] text-ink-3">想改哪里？直接在下面说，只重画要改的那几页，改完马上能看；要发出去时再导出 mp4。</p>
      </div>
    </div>
  );
}

/** an export in the conversation: one line, with the files when it is done */
function ExportLine({ it, project }: { it: Extract<FeedItem, { kind: 'export' }>; project: ProjectView }) {
  const now = useNow(it.status === 'running');
  const took = clock((it.endedAt ?? now) - it.at);
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[12.5px] animate-rise">
      {it.status === 'running' ? <Loader2 size={14} className="animate-spin text-accent-ink" aria-hidden /> : it.status === 'done' ? <Check size={14} className="text-jade" aria-hidden /> : <TriangleAlert size={14} className="text-seal" aria-hidden />}
      <span className={it.status === 'failed' ? 'text-seal' : 'text-ink-2'}>{it.status === 'running' ? '正在导出 mp4' : it.status === 'done' ? '导出好了' : it.detail ?? '导出没成功'}</span>
      <span className="text-ink-3 tabular">{took}</span>
      {it.status === 'done' && it.video && (
        <span className="flex gap-1.5">
          <a className="fs-btn fs-btn-ghost fs-btn-sm" href={client.fileUrl(project, relPath(it.video, project.id))} download><Download size={13} aria-hidden /> 带字幕</a>
          {it.noSubs && <a className="fs-btn fs-btn-ghost fs-btn-sm" href={client.fileUrl(project, relPath(it.noSubs, project.id))} download><Download size={13} aria-hidden /> 无字幕</a>}
        </span>
      )}
    </div>
  );
}

// ── the conversation ────────────────────────────────────────────────────────────────────────────────────────────────

type Block = { kind: 'chapter'; stage: Stage; items: FeedItem[]; key: string; latest?: boolean } | { kind: 'work'; items: FeedItem[]; key: string } | { kind: 'item'; item: FeedItem };

/** group the feed into stage chapters; user messages, notes and outcomes stay in the flow between them */
function blocks(feed: FeedItem[]): Block[] {
  const out: Block[] = [];
  for (const it of feed) {
    const loose = it.kind === 'user' || it.kind === 'paused' || it.kind === 'done' || it.kind === 'ready' || it.kind === 'export' || (it.kind === 'stage' && it.status === 'running');
    const stage = it.kind === 'stage' ? it.stage : it.stage;
    const last = out[out.length - 1];
    // the director working outside a stage (planning a change to the finished film) gets a chapter of its own
    if (!loose && !stage && (it.kind === 'say' || it.kind === 'think' || it.kind === 'tools')) {
      if (last?.kind === 'work') last.items.push(it); else out.push({ kind: 'work', items: [it], key: `w-${it.key}` });
      continue;
    }
    if (loose || !stage) { out.push({ kind: 'item', item: it }); continue; }
    if (last?.kind === 'chapter' && last.stage === stage) last.items.push(it);
    else out.push({ kind: 'chapter', stage, items: [it], key: `c-${it.key}` });
  }
  // a stage can run again (a revision redraws pages): only its latest chapter is live, earlier ones are history
  const seen = new Set<Stage>();
  for (let i = out.length - 1; i >= 0; i--) { const b = out[i]; if (b.kind === 'chapter' && !seen.has(b.stage)) { b.latest = true; seen.add(b.stage); } }
  return out;
}

/** the director planning a change: what it read and decided, folded like a stage */
function WorkChapter({ b, live }: { b: Extract<Block, { kind: 'work' }>; live: boolean }) {
  return (
    <section aria-label="修改计划">
      <header className="flex items-center gap-2.5">
        <StageMark n={0} status={live ? 'running' : 'done'} />
        <h3 className="text-[13.5px] font-semibold text-ink">修改计划</h3>
        <span className={`truncate text-[12.5px] ${live ? 'text-accent-ink' : 'text-ink-3'}`}>{live ? '在看要改哪几页' : ''}</span>
      </header>
      <div className="ml-2.5 mt-2.5 space-y-3 border-l border-line pb-1 pl-[22px]">
        {b.items.filter((i): i is Extract<FeedItem, { kind: 'say' }> => i.kind === 'say').map((it) => <Said key={it.key} text={it.text} />)}
        <Process items={b.items} />
      </div>
    </section>
  );
}

/** the last line of the conversation while something is being made: who is doing what, right now, for how long */
function LiveLine({ run }: { run: RunView }) {
  const now = useNow(true);
  const a = run.activity;
  // thinking that has gone quiet, with nothing done yet: the model is writing an answer it hands over only when whole
  const writing = !!a?.updated && /在想$/.test(a.text) && now - a.updated > 4000;
  const text = writing ? a!.text.replace(/在想$/, a!.text.includes('页 · ') ? '在写画面' : '在写') : a?.text ?? (run.revising ? '在看要改哪几页' : run.current ? STAGE_DOING[run.current] : '准备中');
  const since = writing ? a!.updated : a?.at ?? run.revising ?? (run.current ? run.stages[run.current].startedAt : undefined);
  const secs = since ? Math.max(0, Math.round((now - since) / 1000)) : 0;
  return (
    <div className="flex items-start gap-2.5 animate-fade" role="status">
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
        <span className="absolute inset-0 rounded-full bg-accent/40 motion-safe:animate-halo" />
        <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-paper ring-1 ring-accent/50"><Crest size={11} /></span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2.5">
          <span className="fs-shimmer min-w-0 truncate text-[13px]">{text}…</span>
          {secs > 2 && <span className="shrink-0 text-[12px] text-ink-3 tabular">{secs < 60 ? `${secs} 秒` : clock(secs * 1000)}</span>}
        </span>
        {/* the line it is writing right now, so a long write is seen growing */}
        {/在写(画面)?$/.test(text) && !a?.detail && secs > 8 && <span className="mt-0.5 block text-[11.5px] text-ink-3">模型会一次写完再交出来，写好前看不到内容</span>}
        {a?.detail && <code key={a.detail} className="mt-1 block truncate font-mono text-[11.5px] leading-5 text-ink-3 animate-fade">{a.detail}</code>}
      </span>
    </div>
  );
}

function Chapter({ b, run, project, onSelectPage, selected }: { b: Extract<Block, { kind: 'chapter' }>; run: RunView; project: ProjectView; onSelectPage: (id: string) => void; selected?: string }) {
  const live = run.stages[b.stage];
  const st = b.latest ? live : { ...live, status: 'done' as const, startedAt: undefined, endedAt: undefined };
  const n = STAGES.indexOf(b.stage) + 1;
  const now = useNow(st.status === 'running');
  const took = st.startedAt ? clock((st.endedAt ?? now) - st.startedAt) : undefined;
  const statusText = st.status === 'running' ? `${STAGE_DOING[b.stage]} · ${took}` : st.status === 'done' ? [took, humanDetail(b.stage, st.detail, run.storyboard)].filter(Boolean).join(' · ') : st.status === 'skipped' ? '这一步不需要' : st.status === 'stopped' ? '停在这里' : st.status === 'failed' ? '没完成' : '';
  const approvals = b.items.filter((i) => i.kind === 'approval');
  return (
    <section aria-label={`第 ${n} 步 ${STAGE_NAME[b.stage]}`} className="relative">
      <header className="flex items-center gap-2.5">
        <StageMark n={n} status={st.status} />
        <h3 className="text-[13.5px] font-semibold text-ink">{STAGE_NAME[b.stage]}</h3>
        <span className={`truncate text-[12.5px] ${st.status === 'running' ? 'text-accent-ink' : 'text-ink-3'}`}>{statusText}</span>
      </header>
      <div className="ml-2.5 mt-2.5 space-y-3 border-l border-line pb-1 pl-[22px]">
        {b.items.map((it) => {
          if (it.kind === 'say') return <Said key={it.key} text={it.text} />;
          if (it.kind === 'note') return <p key={it.key} className="text-[13px] leading-relaxed text-ink-2 animate-rise">{it.text}</p>;
          if (it.kind === 'check') return it.reds + it.yellows === 0
            ? <p key={it.key} className="flex items-center gap-1.5 text-[12.5px] text-jade"><Check size={13} aria-hidden /> 分镜检查通过</p>
            : <p key={it.key} className="text-[12.5px] leading-relaxed text-ink-3">检查出 {it.reds} 处要改{it.yellows ? `、${it.yellows} 处提醒` : ''}，导演正在修改</p>;
          if (it.kind === 'approval') return <Approval key={it.key} sb={it.storyboard} project={project} active={run.awaitingApproval && approvals.at(-1) === it} />;
          if (it.kind === 'pages' && !b.latest) return <p key={it.key} className="text-[12.5px] text-ink-3">{run.pageOrder.length} 页都画好了</p>;
          if (it.kind === 'pages') return <Pages key={it.key} run={run} onSelect={onSelectPage} selected={selected} />;
          if (it.kind === 'error') return <p key={it.key} className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-seal"><TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />{it.message}</p>;
          return null;
        })}
        <Process items={b.items} />
      </div>
    </section>
  );
}

const ESTIMATE: Record<Stage, (pages: number) => number> = { storyboard: () => 100, script: () => 80, narrate: () => 20, pages: (n) => Math.ceil(Math.max(n, 1) / 3) * 240, review: () => 60, render: () => 120 };

/** the line above the composer: what is happening now, how long it has taken, about how long is left */
function NowBar({ run }: { run: RunView }) {
  const running = isWorking(run);
  const now = useNow(running);
  const todo = run.pageOrder.filter((id) => !['ok', 'flagged', 'failed'].includes(run.pages[id]?.status ?? 'queued')).length;
  const pages = finished(run) ? Math.max(todo, 1) : run.pageOrder.length || run.storyboard?.pages.length || 5;
  let left = 0;
  if (running && run.current && !run.exporting) {
    const i = STAGES.indexOf(run.current!);
    const cur = run.stages[run.current!];
    left = Math.max(30, ESTIMATE[run.current!](pages) - (cur.startedAt ? (now - cur.startedAt) / 1000 : 0)) + STAGES.slice(i + 1).reduce((a, s) => a + ESTIMATE[s](pages), 0);
  }
  const busyPage = run.pageOrder.find((id) => run.pages[id]?.status === 'checking' || run.pages[id]?.status === 'drawing');
  if (running && !run.current) left = 0;
  const seconds = Math.round(run.ready?.duration ?? run.video?.duration ?? 0);
  const text = run.revising ? '导演在看要改哪几页'
    : run.exporting ? '正在导出 mp4'
    : finished(run) && !running ? `片子好了 · ${seconds} 秒${run.stale ? ' · 改过之后还没导出' : ''}`
    : run.awaitingApproval ? '等你确认分镜'
    : run.paused ? '已暂停'
    : running ? `${STAGE_DOING[run.current!]}${run.current === 'pages' && busyPage ? ` · ${pageName(busyPage)}${run.pages[busyPage].status === 'checking' ? '在自己检查' : '在画'}` : ''}`
    : '准备开始';
  return (
    <div className="flex items-center gap-2.5 px-5 py-2.5 text-[12.5px]" aria-live="polite">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? 'animate-breathe bg-accent' : run.awaitingApproval ? 'bg-accent' : finished(run) ? 'bg-jade' : 'bg-line-2'}`} aria-hidden />
      <span className={`min-w-0 flex-1 truncate ${run.awaitingApproval ? 'text-accent-ink' : 'text-ink-2'}`}>{text}</span>
      {running && left > 0 && <span className="shrink-0 text-ink-3 tabular">约还需 {left < 90 ? '1 分钟' : `${Math.round(left / 60)} 分钟`}</span>}
      <span className="shrink-0 font-mono text-ink-3 tabular" title="本项目已花费">{money(run.cost)}</span>
    </div>
  );
}

export function Conversation({ run, project, onSelectPage, selected, onPlay }: { run: RunView; project: ProjectView; onSelectPage: (id: string) => void; selected?: string; onPlay: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [run.feed.length, run.pages, run.stages, run.activity, run.revising]);
  const list = useMemo(() => blocks(run.feed), [run.feed]);
  const lastPaused = [...run.feed].reverse().find((f) => f.kind === 'paused');
  // the page open on the workbench, offered to the composer as a one-click reference
  const viewing = useMemo<Ref | undefined>(() => {
    if (!selected) return undefined;
    const ids = run.pageOrder.length ? run.pageOrder : run.storyboard?.pages.map((x) => x.id) || [];
    const n = ids.indexOf(selected) + 1, sec = run.storyboard?.pages.find((x) => x.id === selected)?.section;
    const thumb = run.pages[selected]?.thumb;
    return n ? { kind: 'page', page: selected, label: `第 ${n} 页${sec ? `「${sec}」` : ''}`, thumb: thumb ? relPath(thumb, project.id) : undefined } : undefined;
  }, [selected, run.pageOrder, run.storyboard, run.pages[selected ?? '']?.thumb]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={box} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-5" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        <div className="space-y-6">
          {/* the user's request opens the conversation, on the user's side */}
          <div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-md bg-accent-soft/70 px-4 py-3 ring-1 ring-accent/15">
            <p className="text-[13.5px] leading-relaxed text-ink">{project.topic || project.notes || '把资料做成一条讲解视频'}</p>
            <p className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1 text-[12px] text-ink-2">
              {project.materials.filter((m) => !/\.(md)$/.test(m) || !project.materials.some((o) => o !== m && o.startsWith(m.replace(/\.md$/, '')))).map((m) => <span key={m} className="max-w-[200px] truncate" title={m}>{m}</span>)}
              <span>约 {Math.round(project.durationSec / 60)} 分钟</span>
              <span>{STYLE_NAME[project.style] ?? project.style}</span>
              {project.voice?.name && <span>{project.voice.name}配音</span>}
            </p>
          </div>
          {list.map((b) => {
            if (b.kind === 'work') return <WorkChapter key={b.key} b={b} live={!!run.revising && b === list.filter((x) => x.kind === 'work').at(-1)} />;
            if (b.kind === 'chapter') return <Chapter key={b.key} b={b} run={run} project={project} onSelectPage={onSelectPage} selected={selected} />;
            const it = b.item;
            if (it.kind === 'user') return (
              <div key={it.key} className="ml-auto flex w-fit max-w-[88%] flex-col items-end gap-1.5 animate-rise">
                {!!it.refs?.length && <div className="flex flex-wrap justify-end gap-1.5">{it.refs.map((r, j) => <RefChip key={j} r={r} project={project} />)}</div>}
                {it.text && <p className="whitespace-pre-wrap rounded-2xl rounded-tr-md bg-accent-soft/70 px-4 py-2.5 text-[13.5px] leading-relaxed text-ink ring-1 ring-accent/15">{it.text}</p>}
              </div>
            );
            if (it.kind === 'paused') return it === lastPaused && run.paused
              ? <PausedCard key={it.key} item={it} run={run} project={project} latest />
              : <p key={it.key} className="flex items-center gap-2 text-[12.5px] text-ink-3"><Pause size={13} aria-hidden />{it.reason === 'error' ? '出错停过一次' : '停过一次'}{it.stage ? `（${STAGE_NAME[it.stage]}）` : ''}，之后接着做了</p>;
            if (it.kind === 'done' || it.kind === 'ready') return run.feed.filter((f) => f.kind === 'done' || f.kind === 'ready').at(-1) === it ? <DoneCard key={it.key} run={run} project={project} onPlay={onPlay} /> : null;
            if (it.kind === 'export') return <ExportLine key={it.key} it={it} project={project} />;
            if (it.kind === 'note') return <p key={it.key} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-ink-2"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-paper ring-1 ring-line"><Crest size={11} /></span>{it.text}</p>;
            return null;
          })}
          {isWorking(run) && <LiveLine run={run} />}
        </div>
      </div>
      <div className="border-t border-line bg-paper-2">
        <NowBar run={run} />
        <Composer run={run} project={project} viewing={viewing} />
      </div>
    </div>
  );
}
