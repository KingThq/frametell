import { useMemo, useRef, useState } from 'react';
import { ArrowRight, FileText, Image as ImageIcon, Loader2, Plus, X } from 'lucide-react';
import { client, type ProjectView } from '../lib/client';
import { go, useLoad } from '../lib/hooks';

const DURATIONS = [{ s: 60, label: '1 分钟' }, { s: 120, label: '2 分钟' }, { s: 300, label: '5 分钟' }, { s: 600, label: '10 分钟' }];
const ACCEPT = '.md,.markdown,.txt,.png,.jpg,.jpeg,.webp';
const STATUS: Record<ProjectView['status'], { label: string; tone: string }> = {
  idle: { label: '未开始', tone: 'text-ink-3' }, running: { label: '制作中', tone: 'text-accent-ink' },
  awaiting_approval: { label: '等你确认分镜', tone: 'text-accent-ink' }, done: { label: '已完成', tone: 'text-jade' },
  failed: { label: '出错了', tone: 'text-seal' }, stopped: { label: '已暂停', tone: 'text-ink-2' },
};
const STYLE_SWATCH: Record<string, string[]> = { 'warm-story': ['#F4E7D3', '#C8603C', '#E0A23B', '#7E9F7A'], study: ['#F4EEE2', '#2B2520', '#3D6D93', '#C0782E'] };

function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return '刚刚'; if (d < 3600) return `${Math.floor(d / 60)} 分钟前`; if (d < 86400) return `${Math.floor(d / 3600)} 小时前`;
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

export function Home({ openSettings }: { openSettings: () => void }) {
  const projects = useLoad(() => client.projects());
  const models = useLoad(() => client.models());
  const styles = useLoad(() => client.styles());
  const voices = useLoad(() => client.voices());
  const settings = useLoad(() => client.settings());

  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState(60);
  const [style, setStyle] = useState<string>();
  const [model, setModel] = useState<string>();
  const [voice, setVoice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const noModel = models.data && !models.data.models.length;
  const modelId = model ?? settings.data?.defaults.model ?? (models.data?.default ? `${models.data.default.provider}/${models.data.default.id}` : undefined);
  const styleId = style ?? settings.data?.defaults.style ?? 'warm-story';
  const voiceList = voices.data?.voices || [];
  const voiceId = voice ?? settings.data?.defaults.voice?.id ?? voiceList[0]?.id;
  const ready = files.length > 0 && !!modelId && !busy;
  const add = (list: FileList | null) => {
    if (!list) return;
    const ok = [...list].filter((f) => /\.(md|markdown|txt|png|jpe?g|webp)$/i.test(f.name));
    if (ok.length < list.length) setError('这一版先支持 Markdown、文本和图片；PDF、Word、PPT 马上就来');
    setFiles((cur) => [...cur, ...ok.filter((f) => !cur.some((c) => c.name === f.name && c.size === f.size))]);
  };

  const start = async () => {
    if (!ready) return;
    setBusy(true); setError(undefined);
    try {
      const v = voiceList.find((x) => x.id === voiceId);
      const p = await client.createProject({ durationSec: duration, style: styleId, model: modelId, notes: notes.trim() || undefined, voice: v ? { provider: v.provider, id: v.id, name: v.name } : undefined }, files);
      go(`#/p/${p.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  const recent = useMemo(() => projects.data || [], [projects.data]);

  return (
    <main className="mx-auto w-full max-w-[880px] px-6 pb-24 pt-14 sm:pt-20">
      <h1 className="text-balance font-display text-[34px] leading-[1.15] tracking-[-0.02em] text-ink sm:text-[42px]">
        把资料，讲成一条<span className="text-accent-ink">好看的</span>视频
      </h1>
      <p className="mt-3 max-w-[60ch] text-[14.5px] leading-relaxed text-ink-2">导演 Agent 先出分镜给你确认，再写口播、配音、逐页画面并自己检查，最后交给你一条 1080p 成片和字幕。</p>

      <section aria-label="新建视频" className="fs-card mt-9 overflow-hidden">
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
          className={`relative border-b border-line px-5 pb-4 pt-5 transition-colors duration-150 ${drag ? 'bg-accent-soft/60' : ''}`}>
          {files.length === 0 ? (
            <button type="button" onClick={() => input.current?.click()} className="group flex w-full items-center gap-4 rounded-xl border border-dashed border-line-2 px-4 py-5 text-left transition-colors hover:border-accent/60">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper-2 text-ink-2 transition-colors group-hover:text-accent-ink"><Plus size={18} /></span>
              <span>
                <span className="block text-[14px] font-medium text-ink">拖入资料，或<span className="text-accent-ink">选择文件</span></span>
                <span className="mt-0.5 block text-[12.5px] text-ink-3">Markdown、文本、图片 · PDF、Word、PPT 即将支持</span>
              </span>
            </button>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label="已选资料">
              {files.map((f) => (
                <li key={f.name + f.size} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-paper-2 pl-2.5 pr-1 text-[12.5px] text-ink-2">
                  {/\.(png|jpe?g|webp)$/i.test(f.name) ? <ImageIcon size={13} /> : <FileText size={13} />}
                  <span className="max-w-[220px] truncate">{f.name}</span>
                  <button className="fs-icon-btn h-6 w-6" onClick={() => setFiles((c) => c.filter((x) => x !== f))} aria-label={`移除 ${f.name}`}><X size={12} /></button>
                </li>
              ))}
              <li><button className="fs-chip h-8" onClick={() => input.current?.click()}><Plus size={13} /> 再加</button></li>
            </ul>
          )}
          <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          <label htmlFor="notes" className="sr-only">补充要求</label>
          <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start(); }}
            placeholder="想讲给谁听、重点讲什么？（可以不写）"
            className="mt-4 block w-full resize-none bg-transparent text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-3" />
        </div>

        <div className="grid gap-x-6 gap-y-5 px-5 py-5 sm:grid-cols-2">
          <fieldset>
            <legend className="fs-label">时长（参考）</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {DURATIONS.map((d) => <button key={d.s} role="radio" aria-checked={duration === d.s} className="fs-chip" onClick={() => setDuration(d.s)}>{d.label}</button>)}
            </div>
          </fieldset>
          <fieldset>
            <legend className="fs-label">风格</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {(styles.data || []).map((s) => (
                <button key={s.id} role="radio" aria-checked={styleId === s.id} className="fs-chip" onClick={() => setStyle(s.id)} title={s.summary}>
                  <span className="flex -space-x-1" aria-hidden>{(STYLE_SWATCH[s.id] || []).map((c) => <span key={c} className="h-3 w-3 rounded-full ring-1 ring-black/10" style={{ background: c }} />)}</span>
                  {s.name}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="voice" className="fs-label">配音</label>
            <select id="voice" className="fs-input" value={voiceId ?? ''} onChange={(e) => setVoice(e.target.value)} disabled={!voiceList.length}>
              {!voiceList.length && <option value="">没有配音（在设置里连接火山或 ElevenLabs）</option>}
              {voiceList.map((v) => <option key={v.provider + v.id} value={v.id}>{v.name}{v.provider === 'elevenlabs' ? ' · ElevenLabs' : ''}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="model" className="fs-label">模型</label>
            <select id="model" className="fs-input" value={modelId ?? ''} onChange={(e) => setModel(e.target.value)} disabled={!models.data?.models.length}>
              {!models.data?.models.length && <option value="">先连接一个模型</option>}
              {models.data?.models.map((m) => <option key={m.provider + m.id} value={`${m.provider}/${m.id}`}>{m.providerName} · {m.name}{m.recommended ? '（推荐）' : ''}</option>)}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-paper-2/50 px-5 py-3.5">
          {noModel ? (
            <p className="text-[12.5px] text-ink-2">还没有连接模型。<button className="text-accent-ink underline-offset-2 hover:underline" onClick={openSettings}>连接 Relay（推荐）</button>或其他服务商。</p>
          ) : error ? (
            <p className="text-[12.5px] text-seal" role="alert">{error}</p>
          ) : (
            <p className="text-[12px] text-ink-3"><kbd className="fs-kbd">⌘</kbd> <kbd className="fs-kbd">↵</kbd> 开始</p>
          )}
          <button className="fs-btn fs-btn-accent fs-btn-lg" disabled={!ready} onClick={start}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {busy ? '正在创建' : '开始制作'}
            {!busy && <ArrowRight size={16} />}
          </button>
        </div>
      </section>

      <section aria-labelledby="recent" className="mt-14">
        <h2 id="recent" className="text-[13px] font-semibold text-ink-2">最近的视频</h2>
        {projects.loading && !projects.data ? (
          <div className="mt-4 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-ink/[0.05]" />)}</div>
        ) : recent.length === 0 ? (
          <p className="mt-4 text-[13px] leading-relaxed text-ink-3">做好的视频会出现在这里。先从一份你熟悉的资料开始：一篇文章、一份笔记，或者一页 PPT 的截图。</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {recent.map((p) => (
              <li key={p.id}>
                <a href={`#/p/${p.id}`} className="group flex items-center gap-4 py-3.5 transition-colors hover:bg-ink/[0.025]">
                  <span className="flex -space-x-1" aria-hidden>{(STYLE_SWATCH[p.style] || STYLE_SWATCH.study).slice(0, 3).map((c) => <span key={c} className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10" style={{ background: c }} />)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{p.title}</span>
                    <span className="mt-0.5 block text-[12px] text-ink-3">{Math.round(p.durationSec / 60)} 分钟 · {p.model.split('/').pop()} · {ago(p.updatedAt)}</span>
                  </span>
                  <span className={`text-[12.5px] ${STATUS[p.status].tone}`}>{STATUS[p.status].label}</span>
                  <ArrowRight size={15} className="text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
