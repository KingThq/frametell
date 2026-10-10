import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, FileText, Image as ImageIcon, Loader2, Paperclip, Play, Square, X } from 'lucide-react';
import { client, type ProjectView, type Voice } from '../lib/client';
import { go, useLoad } from '../lib/hooks';
import { STAGE_NAME, type Stage } from '../lib/run';
import { STYLE_SWATCH } from '../lib/styles';

const DURATIONS = [{ s: 60, label: '1 分钟' }, { s: 120, label: '2 分钟' }, { s: 300, label: '5 分钟' }, { s: 600, label: '10 分钟' }];
const ACCEPT = '.md,.markdown,.txt,.pdf,.docx,.pptx,.epub,.png,.jpg,.jpeg,.webp';
const READABLE = /\.(md|markdown|txt|pdf|docx|pptx|epub|png|jpe?g|webp)$/i;

function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return '刚刚'; if (d < 3600) return `${Math.floor(d / 60)} 分钟前`; if (d < 86400) return `${Math.floor(d / 3600)} 小时前`;
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

/** what a project row says and the one thing you can do with it */
function rowState(p: ProjectView): { label: string; tone: string; action?: { text: string; icon: React.ReactNode; run?: () => Promise<void> } } {
  const at = p.stage && p.stage in STAGE_NAME ? `停在${STAGE_NAME[p.stage as Stage]}` : '';
  switch (p.status) {
    case 'done': return { label: '已完成', tone: 'text-jade', action: { text: '观看', icon: <Play size={13} aria-hidden /> } };
    case 'awaiting_approval': return { label: '等你确认分镜', tone: 'text-accent-ink', action: { text: '去确认分镜', icon: <ArrowRight size={13} aria-hidden /> } };
    case 'running': return { label: '制作中', tone: 'text-accent-ink', action: { text: '看进度', icon: <ArrowRight size={13} aria-hidden /> } };
    case 'stopped': return { label: at ? `已暂停 · ${at}` : '已暂停', tone: 'text-ink-2', action: { text: '继续制作', icon: <Play size={13} aria-hidden />, run: () => client.start(p.id) } };
    case 'failed': return { label: at ? `出错 · ${at}` : '出错了', tone: 'text-seal', action: { text: '继续制作', icon: <Play size={13} aria-hidden />, run: () => client.start(p.id) } };
    default: return { label: '未开始', tone: 'text-ink-3', action: { text: '开始', icon: <Play size={13} aria-hidden />, run: () => client.start(p.id) } };
  }
}

/** a narrator picker with a play button: the sample is synthesized once with your key, then kept on this machine */
function VoicePicker({ voices, value, onChange }: { voices: Voice[]; value?: string; onChange: (id: string) => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [error, setError] = useState<string>();
  const audio = useRef<HTMLAudioElement | null>(null);
  const v = voices.find((x) => x.id === value);
  useEffect(() => () => { audio.current?.pause(); }, []);
  useEffect(() => { audio.current?.pause(); setState('idle'); setError(undefined); }, [value]);
  const toggle = async () => {
    if (!v) return;
    if (state === 'playing') { audio.current?.pause(); setState('idle'); return; }
    setError(undefined); setState('loading');
    const a = new Audio(client.voicePreviewUrl(v));
    audio.current = a;
    a.onended = () => setState('idle');
    a.onerror = () => { setState('idle'); setError('试听失败：检查设置里的配音 key'); };
    try { await a.play(); setState('playing'); } catch { setState('idle'); setError('试听失败：检查设置里的配音 key'); }
  };
  return (
    <div>
      <label htmlFor="voice" className="fs-label">配音</label>
      <div className="flex gap-2">
        <select id="voice" className="fs-input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={!voices.length}>
          {!voices.length && <option value="">没有配音（在设置里连接火山或 ElevenLabs）</option>}
          {voices.map((x) => <option key={x.provider + x.id} value={x.id}>{x.name}{x.gender ? (x.gender === 'female' ? ' · 女声' : ' · 男声') : ''}{x.provider === 'elevenlabs' ? ' · ElevenLabs' : ''}</option>)}
        </select>
        <button type="button" className="fs-btn fs-btn-secondary h-9 w-[76px] shrink-0 px-0" onClick={toggle} disabled={!v} aria-label={state === 'playing' ? `停止试听 ${v?.name ?? ''}` : `试听 ${v?.name ?? ''}`}>
          {state === 'loading' ? <Loader2 size={14} className="animate-spin" aria-hidden /> : state === 'playing' ? <Square size={12} aria-hidden /> : <Play size={14} aria-hidden />}
          {state === 'playing' ? '停止' : '试听'}
        </button>
      </div>
      {error && <p className="mt-1.5 text-[12px] text-seal" role="alert">{error}</p>}
    </div>
  );
}

export function Home({ openSettings }: { openSettings: () => void }) {
  const projects = useLoad(() => client.projects());
  const models = useLoad(() => client.models());
  const styles = useLoad(() => client.styles());
  const voices = useLoad(() => client.voices());
  const settings = useLoad(() => client.settings());

  const [files, setFiles] = useState<File[]>([]);
  const [topic, setTopic] = useState('');
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
  const voiceId = voice ?? (voiceList.some((v) => v.id === settings.data?.defaults.voice?.id) ? settings.data?.defaults.voice?.id : voiceList[0]?.id);
  const hasInput = !!topic.trim() || files.length > 0;
  const ready = hasInput && !!modelId && !busy;
  const add = (list: FileList | null) => {
    if (!list) return;
    const ok = [...list].filter((f) => READABLE.test(f.name));
    setError(ok.length < list.length ? '有些文件格式还不支持，已跳过' : undefined);
    setFiles((cur) => [...cur, ...ok.filter((f) => !cur.some((c) => c.name === f.name && c.size === f.size))]);
  };

  const start = async () => {
    if (!ready) return;
    setBusy(true); setError(undefined);
    try {
      const v = voiceList.find((x) => x.id === voiceId);
      const p = await client.createProject({ durationSec: duration, style: styleId, model: modelId, notes: topic.trim() || undefined, voice: v ? { provider: v.provider, id: v.id, name: v.name } : undefined }, files);
      go(`#/p/${p.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  const recent = useMemo(() => projects.data || [], [projects.data]);
  const current = (styles.data || []).find((s) => s.id === styleId);
  const hint = noModel ? null : !hasInput ? '说一句想讲什么，或者附上资料' : !modelId ? '先选一个模型' : null;

  return (
    <main className="mx-auto w-full max-w-[880px] px-6 pb-24 pt-14 sm:pt-20">
      <h1 className="text-balance font-display text-[34px] leading-[1.15] tracking-[-0.02em] text-ink sm:text-[42px]">
        把一个想法，讲成一条<span className="text-accent-ink">好看的</span>视频
      </h1>
      <p className="mt-3 max-w-[60ch] text-[14.5px] leading-relaxed text-ink-2">说一句想讲什么，或者附上资料。导演 Agent 先出分镜给你确认，再写口播、配音、逐页作画并自己检查，最后交给你一条 1080p 成片和字幕。</p>

      <section aria-label="新建视频" className="fs-card mt-9 overflow-hidden"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>
        <div className={`relative border-b border-line px-5 pb-4 pt-5 transition-colors duration-150 ${drag ? 'bg-accent-soft/60' : ''}`}>
          <label htmlFor="topic" className="sr-only">想讲什么</label>
          <textarea id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} rows={3} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start(); }}
            placeholder="想讲什么？一句话就够，比如「讲讲番茄工作法为什么有用，讲给总是拖延的上班族」"
            className="block w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-3" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {files.map((f) => (
              <span key={f.name + f.size} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-paper-2 pl-2.5 pr-1 text-[12.5px] text-ink-2">
                {/\.(png|jpe?g|webp)$/i.test(f.name) ? <ImageIcon size={13} aria-hidden /> : <FileText size={13} aria-hidden />}
                <span className="max-w-[220px] truncate">{f.name}</span>
                <button className="fs-icon-btn h-6 w-6" onClick={() => setFiles((c) => c.filter((x) => x !== f))} aria-label={`移除 ${f.name}`}><X size={12} /></button>
              </span>
            ))}
            <button type="button" className="fs-chip" onClick={() => input.current?.click()}>
              <Paperclip size={13} aria-hidden /> {files.length ? '再加资料' : '附上资料（可选）'}
            </button>
            {!files.length && <span className="text-[12px] text-ink-3">PDF、Word、PPT、EPUB、Markdown、图片，也可以直接拖进来</span>}
          </div>
          <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" aria-label="选择资料文件" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        </div>

        <div className="grid gap-x-6 gap-y-5 px-5 py-5 sm:grid-cols-2">
          <fieldset>
            <legend className="fs-label">时长（参考）</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {DURATIONS.map((d) => <button key={d.s} type="button" role="radio" aria-checked={duration === d.s} className="fs-chip" onClick={() => setDuration(d.s)}>{d.label}</button>)}
            </div>
          </fieldset>
          <VoicePicker voices={voiceList} value={voiceId} onChange={setVoice} />
          <fieldset className="sm:col-span-2">
            <legend className="fs-label">风格</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {(styles.data || []).map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={styleId === s.id} className="fs-chip" onClick={() => setStyle(s.id)}>
                  <span className="flex -space-x-1" aria-hidden>{(STYLE_SWATCH[s.id] || []).map((c) => <span key={c} className="h-3 w-3 rounded-full ring-1 ring-black/15" style={{ background: c }} />)}</span>
                  {s.name}
                </button>
              ))}
            </div>
            {current && <p className="mt-2 text-[12.5px] text-ink-3">{current.summary}</p>}
          </fieldset>
          <div className="sm:col-span-2">
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
          ) : hint ? (
            <p className="text-[12.5px] text-ink-3">{hint}</p>
          ) : (
            <p className="text-[12px] text-ink-3"><kbd className="fs-kbd">⌘</kbd> <kbd className="fs-kbd">↵</kbd> 开始</p>
          )}
          <button className="fs-btn fs-btn-accent fs-btn-lg" disabled={!ready} onClick={start}>
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
            {busy ? '正在创建' : '开始制作'}
            {!busy && <ArrowRight size={16} aria-hidden />}
          </button>
        </div>
      </section>

      <section aria-labelledby="recent" className="mt-14">
        <h2 id="recent" className="text-[13px] font-semibold text-ink-2">最近的视频</h2>
        {projects.loading && !projects.data ? (
          <div className="mt-4 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-ink/[0.05]" />)}</div>
        ) : recent.length === 0 ? (
          <p className="mt-4 text-[13px] leading-relaxed text-ink-3">做好的视频会出现在这里。可以从一句话开始，比如「讲讲复利为什么要趁早」。</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {recent.map((p) => {
              const st = rowState(p);
              return (
                <li key={p.id} className="flex items-center gap-4 py-3.5">
                  <a href={`#/p/${p.id}`} className="group flex min-w-0 flex-1 items-center gap-4 rounded-lg">
                    <span className="flex -space-x-1" aria-hidden>{(STYLE_SWATCH[p.style] || STYLE_SWATCH.study).slice(0, 3).map((c) => <span key={c} className="h-3.5 w-3.5 rounded-full ring-1 ring-black/15" style={{ background: c }} />)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-ink group-hover:underline group-hover:underline-offset-4">{p.title}</span>
                      <span className="mt-0.5 block text-[12px] text-ink-3">约 {Math.round(p.durationSec / 60)} 分钟 · {ago(p.updatedAt)} · <span className={st.tone}>{st.label}</span></span>
                    </span>
                  </a>
                  {st.action && (
                    <button className={`fs-btn fs-btn-sm shrink-0 ${st.action.run ? 'fs-btn-secondary' : 'fs-btn-ghost'}`}
                      onClick={async () => { await st.action!.run?.(); go(`#/p/${p.id}`); }}>
                      {st.action.icon}{st.action.text}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
