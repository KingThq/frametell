import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CircleAlert, FileText, Image as ImageIcon, Loader2, Paperclip, Play, Settings2, Square, X } from 'lucide-react';
import { client, hosted, type ProjectView, type PublicSettings, type Voice } from '../lib/client';
import { go, useLoad } from '../lib/hooks';
import { STAGE_NAME, type Stage } from '../lib/run';
import { STYLE_SWATCH, styleName, styleSummary } from '../lib/styles';
import { intlTag, t, useT } from '../i18n';
import { ModelPicker } from '../components/ModelPicker';
import { VoicePicker } from '../components/VoicePicker';

const DURATIONS = [60, 120, 300, 600];
const ACCEPT = '.md,.markdown,.txt,.pdf,.docx,.pptx,.epub,.png,.jpg,.jpeg,.webp';
const READABLE = /\.(md|markdown|txt|pdf|docx|pptx|epub|png|jpe?g|webp)$/i;

function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return t('home.justNow'); if (d < 3600) return t('home.minutesAgo', { n: Math.floor(d / 60) }); if (d < 86400) return t('home.hoursAgo', { n: Math.floor(d / 3600) });
  return new Date(iso).toLocaleDateString(intlTag(), { month: 'long', day: 'numeric' });
}

/** what a project row says and the one thing you can do with it */
function rowState(p: ProjectView): { label: string; tone: string; action?: { text: string; icon: React.ReactNode; run?: () => Promise<void> } } {
  const at = p.stage && p.stage in STAGE_NAME ? t('home.stoppedAt', { stage: STAGE_NAME[p.stage as Stage] }) : '';
  switch (p.status) {
    case 'done': return { label: t('home.status.done'), tone: 'text-jade', action: { text: t('home.action.watch'), icon: <Play size={13} aria-hidden /> } };
    case 'awaiting_approval': return { label: t('home.status.awaiting'), tone: 'text-accent-ink', action: { text: t('home.action.review'), icon: <ArrowRight size={13} aria-hidden /> } };
    case 'running': return { label: t('home.status.running'), tone: 'text-accent-ink', action: { text: t('home.action.progress'), icon: <ArrowRight size={13} aria-hidden /> } };
    case 'stopped': return { label: at ? t('home.status.pausedAt', { at }) : t('home.status.paused'), tone: 'text-ink-2', action: { text: t('home.action.resume'), icon: <Play size={13} aria-hidden />, run: () => client.start(p.id) } };
    case 'failed': return { label: at ? t('home.status.failedAt', { at }) : t('home.status.failed'), tone: 'text-seal', action: { text: t('home.action.resume'), icon: <Play size={13} aria-hidden />, run: () => client.start(p.id) } };
    default: return { label: t('home.status.idle'), tone: 'text-ink-3', action: { text: t('home.action.start'), icon: <Play size={13} aria-hidden />, run: () => client.start(p.id) } };
  }
}

const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };

/** where this run's requests go, said only when it is not the provider's own endpoint: a relay, a proxy */
function route(s: PublicSettings | undefined, modelId: string | undefined) {
  if (!s || !modelId) return undefined;
  const relay = s.baseUrls?.[modelId.split('/')[0]];
  const parts = [relay ? t('home.via.relay', { host: host(relay) }) : '', s.proxy ? t('home.via.proxy', { host: host(s.proxy) }) : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

export function Home({ openSettings }: { openSettings: (section?: string) => void }) {
  const { t, locale } = useT();
  const projects = useLoad(() => client.projects());
  const models = useLoad(() => client.models());
  const styles = useLoad(() => client.styles());
  const voices = useLoad(() => client.voices());
  const settings = useLoad(() => client.settings());

  const [files, setFiles] = useState<File[]>([]);
  // ?topic= starts the box with an idea typed elsewhere (frametell.ai's landing page)
  const [topic, setTopic] = useState(() => new URLSearchParams(location.search).get('topic') || '');
  const [duration, setDuration] = useState(60);
  const [lang, setLang] = useState<'zh' | 'en'>();
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
  // hosted: only the voices the service can speak with
  const voiceList = (voices.data?.voices || []).filter((v) => !hosted || voices.data?.configured[v.provider]);
  const filmLang = lang ?? locale;
  // a voice speaks the film's language: Volcengine's are Chinese voices (lang 'zh'); ElevenLabs' speak many (no lang)
  const speaks = (v: { lang?: string }) => !v.lang || v.lang === filmLang;
  const defaultVoice = voiceList.find((v) => v.id === settings.data?.defaults.voice?.id && speaks(v)) ?? voiceList.find(speaks) ?? voiceList[0];
  const voiceId = voice ?? defaultVoice?.id;
  const picked = voiceList.find((v) => v.id === voiceId);
  // a voice of a service with no key can be heard, not used: the film would come out silent
  const voiceNoKey = !!picked && voices.data?.configured[picked.provider] === false;
  const voiceOtherLang = !!picked && !speaks(picked);
  const hasInput = !!topic.trim() || files.length > 0;
  const ready = hasInput && !!modelId && !voiceNoKey && !busy;
  const add = (list: FileList | null) => {
    if (!list) return;
    const ok = [...list].filter((f) => READABLE.test(f.name));
    setError(ok.length < list.length ? t('home.skipped') : undefined);
    setFiles((cur) => [...cur, ...ok.filter((f) => !cur.some((c) => c.name === f.name && c.size === f.size))]);
  };

  const start = async () => {
    if (!ready) return;
    setBusy(true); setError(undefined);
    try {
      const v = voiceList.find((x) => x.id === voiceId);
      const p = await client.createProject({ durationSec: duration, lang: filmLang, style: styleId, model: modelId, notes: topic.trim() || undefined, voice: v ? { provider: v.provider, id: v.id, name: v.name } : undefined }, files);
      go(`#/p/${p.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  const recent = useMemo(() => projects.data || [], [projects.data]);
  const current = (styles.data || []).find((s) => s.id === styleId);
  const via = route(settings.data, modelId);
  const addModel = async (provider: string, id: string) => {
    const cur = settings.data?.models?.[provider] ?? [];
    if (!cur.includes(id)) await client.updateSettings({ models: { [provider]: [...cur, id] } });
    settings.reload(); models.reload();
  };
  const hint = noModel ? null : !hasInput ? t('home.hintInput') : !modelId ? t('home.hintModel') : voiceNoKey ? t('home.hintVoiceKey') : null;

  return (
    <main className="mx-auto w-full max-w-[880px] px-6 pb-24 pt-14 sm:pt-20">
      <h1 className="text-balance font-display text-[34px] leading-[1.15] tracking-[-0.02em] text-ink sm:text-[42px]">
        {t('home.titleA')}<span className="text-accent-ink">{t('home.titleB')}</span>{t('home.titleC')}
      </h1>
      <p className="mt-3 max-w-[60ch] text-[14.5px] leading-relaxed text-ink-2">{t('home.intro')}</p>

      <section aria-label={t('home.newVideo')} className="fs-card mt-9"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>
        <div className={`relative rounded-t-2xl border-b border-line px-5 pb-4 pt-5 transition-colors duration-150 ${drag ? 'bg-accent-soft/60' : ''}`}>
          <label htmlFor="topic" className="sr-only">{t('home.topicLabel')}</label>
          <textarea id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} rows={3} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start(); }}
            placeholder={t('home.topicPlaceholder')}
            className="block w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-3" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {files.map((f) => (
              <span key={f.name + f.size} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-paper-2 pl-2.5 pr-1 text-[12.5px] text-ink-2">
                {/\.(png|jpe?g|webp)$/i.test(f.name) ? <ImageIcon size={13} aria-hidden /> : <FileText size={13} aria-hidden />}
                <span className="max-w-[220px] truncate">{f.name}</span>
                <button className="fs-icon-btn h-6 w-6" onClick={() => setFiles((c) => c.filter((x) => x !== f))} aria-label={t('home.remove', { name: f.name })}><X size={12} /></button>
              </span>
            ))}
            <button type="button" className="fs-chip" onClick={() => input.current?.click()}>
              <Paperclip size={13} aria-hidden /> {files.length ? t('home.addMore') : t('home.attach')}
            </button>
            {!files.length && <span className="text-[12px] text-ink-3">{t('home.formats')}</span>}
          </div>
          <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" aria-label={t('home.chooseFiles')} onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        </div>

        <div className="grid gap-x-6 gap-y-5 px-5 py-5 sm:grid-cols-2">
          <div className="flex flex-wrap gap-x-6 gap-y-5">
            <fieldset>
              <legend className="fs-label">{t('home.duration')}</legend>
              <div className="flex flex-wrap gap-1.5" role="radiogroup">
                {DURATIONS.map((s) => <button key={s} type="button" role="radio" aria-checked={duration === s} className="fs-chip" onClick={() => setDuration(s)}>{t('home.minutes', { n: s / 60 })}</button>)}
              </div>
            </fieldset>
            <fieldset>
              <legend className="fs-label">{t('home.lang')}</legend>
              <div className="flex flex-wrap gap-1.5" role="radiogroup">
                {(['zh', 'en'] as const).map((l) => <button key={l} type="button" role="radio" aria-checked={filmLang === l} className="fs-chip" onClick={() => { setLang(l); setVoice(undefined); }}>{t(l === 'zh' ? 'home.langZh' : 'home.langEn')}</button>)}
              </div>
            </fieldset>
          </div>
          <div>
            <label htmlFor="voice" className="fs-label">{t('home.voice.label')}</label>
            <VoicePicker voices={voiceList} value={voiceId} onChange={setVoice} unconfigured={voices.data && !hosted ? (['volcengine', 'elevenlabs'] as const).filter((p) => !voices.data!.configured[p]) : []} />
            {voiceOtherLang && !voiceNoKey && <p className="mt-1.5 text-[12px] text-ink-2">{t('home.voice.langMismatch')}</p>}
            {voiceNoKey && picked && (
              <p className="mt-1.5 text-[12px] text-ink-2">
                {t('home.voice.needKey', { service: picked.provider === 'volcengine' ? t('home.voice.volcengine') : 'ElevenLabs' })}
                <button type="button" className="ml-1 text-accent-ink underline-offset-2 hover:underline" onClick={() => openSettings('voice')}>{t('home.voice.needKeyLink')}</button>
              </p>
            )}
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="fs-label">{t('home.style')}</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {(styles.data || []).map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={styleId === s.id} className="fs-chip" onClick={() => setStyle(s.id)}>
                  <span className="flex -space-x-1" aria-hidden>{(STYLE_SWATCH[s.id] || []).map((c) => <span key={c} className="h-3 w-3 rounded-full ring-1 ring-black/15" style={{ background: c }} />)}</span>
                  {styleName(s.id) ?? s.name}
                </button>
              ))}
            </div>
            {current && <p className="mt-2 text-[12.5px] text-ink-3">{styleSummary(current.id) ?? current.summary}</p>}
          </fieldset>
          {!hosted && <div className="sm:col-span-2">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="model" className="fs-label">{t('home.model')}</label>
              <button type="button" onClick={() => openSettings()} className="-mr-1 inline-flex items-center gap-1 rounded-md px-1 text-[12px] text-ink-3 transition-colors hover:text-ink">
                <Settings2 size={13} aria-hidden /> {t('home.modelSettings')}
              </button>
            </div>
            <ModelPicker models={models.data?.models || []} value={modelId} onChange={setModel} onAdd={addModel} onManage={openSettings} disabled={!models.data} />
            {via && <p className="mt-2 text-[12px] text-ink-3">{via}</p>}
          </div>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-line bg-paper-2/50 px-5 py-3.5">
          {noModel ? (
            <p className="text-[12.5px] text-ink-2">{t('home.noModelA')}<button className="text-accent-ink underline-offset-2 hover:underline" onClick={() => openSettings()}>{t('home.noModelLink')}</button>{t('home.noModelB')}</p>
          ) : error ? (
            <p className="text-[12.5px] text-seal" role="alert">{error}</p>
          ) : hint ? (
            <p className="text-[12.5px] text-ink-3">{hint}</p>
          ) : (
            <p className="text-[12px] text-ink-3"><kbd className="fs-kbd">⌘</kbd> <kbd className="fs-kbd">↵</kbd> {t('home.startKey')}</p>
          )}
          <button className="fs-btn fs-btn-accent fs-btn-lg" disabled={!ready} onClick={start}>
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
            {busy ? t('home.creating') : t('home.create')}
            {!busy && <ArrowRight size={16} aria-hidden />}
          </button>
        </div>
      </section>

      <section aria-labelledby="recent" className="mt-14">
        <h2 id="recent" className="text-[13px] font-semibold text-ink-2">{t('home.recent')}</h2>
        {projects.loading && !projects.data ? (
          <div className="mt-4 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-ink/[0.05]" />)}</div>
        ) : recent.length === 0 ? (
          <p className="mt-4 text-[13px] leading-relaxed text-ink-3">{t('home.empty')}</p>
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
                      <span className="mt-0.5 block text-[12px] text-ink-3">{t('home.about', { n: Math.round(p.durationSec / 60) })} · {ago(p.updatedAt)} · <span className={st.tone}>{st.label}</span></span>
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
