import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, AudioLines, Boxes, Check, CircleAlert, Globe, KeyRound, Monitor, SlidersHorizontal, Trash2, X, type LucideIcon } from 'lucide-react';
import { client, type ModelInfo, type PublicSettings, type SettingsPatch } from '../lib/client';
import { useLoad } from '../lib/hooks';
import { t, useT, type MessageKey, getLocale } from '../i18n';
import { ProviderLogo } from '../components/ProviderLogo';
import { AddVoice, PlayButton, usePreview } from '../components/VoicePicker';
import { CustomForm, ProviderDetail, ProviderList, type ProviderView } from './ProviderSettings';

// Settings: a centred dialog with the sections on the left. A section is one entry in SECTIONS — either a list with a
// detail beside it (model providers, voices), or a single page — so a new kind of setting is one more entry.

type Ctx = { s: PublicSettings; patch: (p: SettingsPatch) => Promise<void>; models: ModelInfo[]; modelsLoading: boolean; providers: ProviderView[] };
interface Item { id: string; name: string; logo: string; on: boolean }
interface Section {
  id: string;
  icon: LucideIcon;
  label: MessageKey;
  /** a list with a detail beside it */
  list?: (c: Ctx) => { items: Item[]; render?: (c: Ctx, open: string | undefined, setOpen: (id: string | undefined) => void) => React.ReactNode };
  detail: (c: Ctx, open: string | undefined, setOpen: (id: string | undefined) => void) => React.ReactNode;
}

// Volcengine first in Chinese; in English ElevenLabs first, Volcengine's voices speaking only Chinese
const VOICES = [
  { id: 'volcengine', key: 'volcengine' as const, url: 'https://console.volcengine.com/speech/app', hint: 'API Key / AppID:Token' },
  { id: 'elevenlabs', key: 'elevenlabs' as const, url: 'https://elevenlabs.io/app/settings/api-keys', hint: 'sk_…' },
];

const SECTIONS: Section[] = [
  {
    id: 'models', icon: Boxes, label: 'settings.nav.models',
    list: (c) => ({
      items: [],
      render: (c2, open, setOpen) => <ProviderList providers={c2.providers} s={c2.s} open={open} onOpen={setOpen} onAddCustom={() => setOpen('+custom')} />,
    }),
    detail: (c, open, setOpen) => {
      if (open === '+custom') return (
        <CustomForm onCancel={() => setOpen(undefined)} onSave={async (x) => {
          const id = `custom-${x.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || Date.now().toString(36)}`;
          await c.patch({ custom: [...(c.s.custom as never[]), { id, name: x.name, protocol: x.protocol, baseUrl: x.baseUrl, models: [], discover: x.protocol === 'openai' }], keys: x.key ? { [id]: x.key } : undefined });
          setOpen(id);
        }} />
      );
      const p = c.providers.find((x) => x.id === open) ?? c.providers[0];
      return p && (
        <ProviderDetail key={p.id} p={p} s={c.s} models={c.models} loading={c.modelsLoading} patch={c.patch}
          onRemoveCustom={p.group === 'custom' ? async () => { await c.patch({ custom: (c.s.custom as { id: string }[]).filter((x) => x.id !== p.id) as never[], keys: { [p.id]: '' } }); setOpen(undefined); } : undefined} />
      );
    },
  },
  {
    id: 'voice', icon: AudioLines, label: 'settings.nav.voice',
    list: (c) => ({ items: (getLocale() === 'en' ? [...VOICES].reverse() : VOICES).map((v) => ({ id: v.id, name: t(`settings.voice.${v.id}` as MessageKey), logo: v.id, on: !!c.s.tts[v.key] })) }),
    detail: (c, open) => { const v = VOICES.find((x) => x.id === open) ?? VOICES[0]; return <VoiceDetail key={v.id} v={v} c={c} />; },
  },
  { id: 'general', icon: SlidersHorizontal, label: 'settings.nav.general', detail: (c) => <General c={c} /> },
  { id: 'network', icon: Globe, label: 'settings.nav.network', detail: (c) => <Network c={c} /> },
  { id: 'machine', icon: Monitor, label: 'settings.nav.machine', detail: () => <Machine /> },
];

function Page({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-line pb-5 pl-7 pr-14 pt-6"><h3 className="text-[17px] font-semibold text-ink">{title}</h3>{desc && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{desc}</p>}</header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-7 py-6">{children}</div>
    </div>
  );
}

function SecretField({ id, label, saved, hint, onSave }: { id: string; label: string; saved?: string; hint?: string; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  const save = async (x: string) => { try { await onSave(x); setV(''); setErr(''); } catch (e) { setErr((e as Error).message); } };
  return (
    <div>
      <label htmlFor={id} className="fs-label">{label}</label>
      <div className="flex gap-2">
        <input id={id} type="password" autoComplete="off" spellCheck={false} className="fs-input h-10 font-mono text-[12.5px]" value={v} onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && v.trim() && void save(v)} placeholder={saved ? t('providers.keySaved', { key: saved }) : hint} />
        {v.trim() ? <button type="button" className="fs-btn fs-btn-primary h-10" onClick={() => void save(v)}>{t('providers.save')}</button>
          : saved ? <button type="button" className="fs-btn fs-btn-ghost h-10" onClick={() => void save('')}>{t('providers.remove')}</button> : null}
      </div>
      {err && <p className="mt-1.5 flex items-center gap-1 text-[12px] text-seal" role="alert"><CircleAlert size={13} aria-hidden /> {err}</p>}
    </div>
  );
}

function VoiceDetail({ v, c }: { v: (typeof VOICES)[number]; c: Ctx }) {
  const on = !!c.s.tts[v.key];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3.5 border-b border-line pb-5 pl-7 pr-14 pt-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-paper"><ProviderLogo id={v.id} size={24} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[17px] font-semibold leading-tight text-ink">
            {t(`settings.voice.${v.id}` as MessageKey)}
            <span className={`inline-flex items-center gap-1.5 text-[12px] font-normal ${on ? 'text-jade' : 'text-ink-3'}`}><span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-jade' : 'bg-line-2'}`} aria-hidden />{on ? t('providers.connected') : t('providers.notConnected')}</span>
          </h3>
          <p className="mt-1 text-[12.5px] text-ink-3">{t(`settings.voice.${v.id}Blurb` as MessageKey)}</p>
        </div>
      </header>
      <div className="space-y-4 px-7 py-6">
        <SecretField id={`tts-${v.id}`} label={t('providers.key')} saved={c.s.tts[v.key]} hint={v.hint} onSave={(x) => c.patch({ tts: { [v.key]: x } })} />
        {!on && <a href={v.url} target="_blank" rel="noreferrer" className="inline-flex text-[12.5px] text-accent-ink hover:underline">{t('providers.getKey', { name: t(`settings.voice.${v.id}` as MessageKey) })} ↗</a>}
        <p className="text-[12.5px] leading-relaxed text-ink-3">{t('settings.voice.desc')}</p>
      </div>
      {v.id === 'volcengine' && on && <MyVoices c={c} />}
    </div>
  );
}

/** 「我的音色」: Volcengine voices added by id — heard, renamed, removed, and added here as well as from any voice list */
function MyVoices({ c }: { c: Ctx }) {
  const p = usePreview();
  const mine = c.s.myVoices ?? [];
  const rename = (id: string, name: string) => { if (name.trim() && name.trim() !== mine.find((x) => x.id === id)?.name) void c.patch({ myVoices: mine.map((x) => (x.id === id ? { ...x, name: name.trim() } : x)) }); };
  return (
    <section aria-labelledby="my-voices" className="border-t border-line px-7 py-6">
      <h4 id="my-voices" className="text-[13px] font-semibold text-ink">{t('picker.mine')}</h4>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{t('settings.voice.mineDesc')}</p>
      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
        {mine.map((x) => (
          <div key={x.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
            <PlayButton v={{ provider: x.provider, id: x.id, name: x.name || x.id }} p={p} size="sm" />
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor={`mv-${x.id}`}>{t('settings.voice.rename', { id: x.id })}</label>
              <input id={`mv-${x.id}`} defaultValue={x.name || x.id} maxLength={40} onBlur={(e) => rename(x.id, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className="-ml-1.5 h-7 w-full rounded-md bg-transparent px-1.5 text-[13px] text-ink outline-none transition-colors hover:bg-ink/[0.04] focus:bg-paper focus:ring-2 focus:ring-accent/40" />
              <p className="truncate px-0 font-mono text-[11px] text-ink-3" title={x.id}>{x.id}</p>
            </div>
            <button type="button" onClick={() => void c.patch({ myVoices: mine.filter((y) => y.id !== x.id) })} aria-label={t('settings.voice.remove', { name: x.name || x.id })} title={t('settings.voice.remove', { name: x.name || x.id })}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-seal/10 hover:text-seal"><Trash2 size={13} aria-hidden /></button>
          </div>
        ))}
        {p.failed && <p className="border-t border-line px-3.5 py-2 text-[12px] text-seal" role="alert">{t('home.voice.previewFailed')}</p>}
        <div className={mine.length ? '' : '[&>button]:border-t-0 [&>form]:border-t-0'}>
          <AddVoice needsKey={false} onAdded={() => void c.patch({})} />
        </div>
      </div>
    </section>
  );
}

function General({ c }: { c: Ctx }) {
  const { pref, setPref } = useT();
  return (
    <Page title={t('settings.nav.general')}>
      <section aria-labelledby="sec-lang">
        <h4 id="sec-lang" className="text-[13px] font-semibold text-ink">{t('settings.language.title')}</h4>
        <p className="mt-1 text-[12.5px] text-ink-3">{t('settings.language.desc')}</p>
        <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="sec-lang">
          {(['auto', 'zh', 'en'] as const).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={(c.s.locale ?? pref) === p} className="fs-chip" onClick={() => { setPref(p); void c.patch({ locale: p }); }}>{t(`settings.language.${p}`)}</button>
          ))}
        </div>
      </section>
    </Page>
  );
}

function Network({ c }: { c: Ctx }) {
  const [v, setV] = useState(c.s.proxy ?? '');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  useEffect(() => setV(c.s.proxy ?? ''), [c.s.proxy]);
  const commit = async () => { if (v.trim() === (c.s.proxy ?? '')) return; try { await c.patch({ proxy: v.trim() }); setErr(''); setOk(true); setTimeout(() => setOk(false), 1400); } catch (e) { setErr((e as Error).message); } };
  return (
    <Page title={t('settings.net.title')} desc={t('settings.net.desc')}>
      <div>
        <label htmlFor="proxy" className="fs-label">{t('settings.net.proxy')}</label>
        <div className="relative">
          <input id="proxy" type="url" spellCheck={false} className="fs-input h-10 pr-8 font-mono text-[12.5px]" value={v} placeholder="http://127.0.0.1:7890" onChange={(e) => setV(e.target.value)} onBlur={() => void commit()} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          {ok && <Check size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-jade" aria-label={t('providers.saved')} />}
        </div>
        {err && <p className="mt-1.5 flex items-center gap-1 text-[12px] text-seal" role="alert"><CircleAlert size={13} aria-hidden /> {err}</p>}
      </div>
    </Page>
  );
}

function Machine() {
  const env = useLoad(() => client.env(), []);
  return (
    <Page title={t('settings.env.title')}>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {(env.data || []).map((x) => (
          <li key={x.id} className="flex items-start gap-3 px-4 py-3">
            {x.ok ? <Check size={15} className="mt-0.5 shrink-0 text-jade" aria-label={t('settings.env.ok')} /> : <CircleAlert size={15} className="mt-0.5 shrink-0 text-seal" aria-label={t('settings.env.fix')} />}
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">{t(`settings.env.${x.id}` as MessageKey)}</span>
              <span className="mt-0.5 block truncate text-[12px] text-ink-3" title={x.detail}>{x.ok ? x.detail : x.fix}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-1.5 text-[12px] text-ink-3"><KeyRound size={12} aria-hidden /> {t('settings.env.where')}</p>
    </Page>
  );
}

export function Settings({ open, onClose, onChanged, section: initial }: { open: boolean; onClose: () => void; onChanged?: () => void; section?: string }) {
  useT();   // re-render on a language change
  const ref = useRef<HTMLDialogElement>(null);
  const settings = useLoad(() => client.settings(), [open]);
  const [s, setS] = useState<PublicSettings>();
  const [keysStamp, setKeysStamp] = useState(0);
  const models = useLoad(() => client.models(), [open, keysStamp]);
  const catalog = useLoad(() => client.providers(), [open]);
  const [section, setSection] = useState(initial ?? 'models');
  const [opened, setOpened] = useState<Record<string, string | undefined>>({});
  const [narrowDetail, setNarrowDetail] = useState(false);
  useEffect(() => { if (settings.data) setS(settings.data); }, [settings.data]);
  useEffect(() => { if (open && initial) setSection(initial); }, [open, initial]);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);

  const patch = async (p: SettingsPatch) => {
    const next = await client.updateSettings(p);
    setS(next);
    if (p.keys || p.baseUrls || p.models || p.custom) setKeysStamp((k) => k + 1);   // the model list follows the keys
    onChanged?.();
  };
  const providers: ProviderView[] = useMemo(() => [
    ...(catalog.data || []),
    ...((s?.custom as { id: string; name: string; baseUrl: string; protocol: string }[] | undefined) || []).map((c) => ({ id: c.id, name: c.name, group: 'custom' as const, baseUrl: c.baseUrl, protocol: c.protocol })),
  ], [catalog.data, s?.custom]);

  const sec = SECTIONS.find((x) => x.id === section) ?? SECTIONS[0];
  const ctx: Ctx | undefined = s && { s, patch, models: models.data?.models || [], modelsLoading: models.loading, providers };
  const list = ctx && sec.list?.(ctx);
  const cur = opened[sec.id];
  const setCur = (id: string | undefined) => { setOpened((o) => ({ ...o, [sec.id]: id })); setNarrowDetail(!!id); };

  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} aria-labelledby="settings-title" onMouseDown={(e) => { if (e.target === ref.current) ref.current?.close(); }}
      className="m-auto h-[min(720px,calc(100dvh-48px))] w-[min(1080px,calc(100vw-32px))] max-w-none overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink shadow-[0_24px_64px_-16px_rgb(0_0_0/0.5),0_4px_12px_rgb(0_0_0/0.18)] backdrop:bg-black/50 backdrop:backdrop-blur-[2px] open:animate-pop max-md:h-[calc(100dvh-24px)] max-md:w-[calc(100vw-16px)]">
      <div className="flex h-full min-h-0 max-md:flex-col">
        {/* sections */}
        <nav className="flex w-[196px] shrink-0 flex-col gap-0.5 border-r border-line bg-paper-2 p-3 max-md:w-full max-md:flex-row max-md:gap-1 max-md:overflow-x-auto max-md:border-b max-md:border-r-0 max-md:p-2 max-md:pr-12" aria-label={t('settings.title')}>
          <h2 id="settings-title" className="px-2.5 pb-3 pt-2 text-[15px] font-semibold max-md:sr-only">{t('settings.title')}</h2>
          {SECTIONS.map((x) => {
            const on = x.id === sec.id;
            return (
              <button key={x.id} type="button" onClick={() => { setSection(x.id); setNarrowDetail(false); }} aria-current={on || undefined}
                className={`flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors duration-150 ${on ? 'bg-surface text-ink shadow-[var(--fs-shadow-sm)]' : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink'}`}>
                <x.icon size={15} className={on ? 'text-accent-ink' : 'text-ink-3'} aria-hidden />{t(x.label)}
              </button>
            );
          })}
        </nav>

        {!ctx ? <div className="flex flex-1 items-center justify-center text-[13px] text-ink-3">{t('settings.loading')}</div> : (
          <div className="flex min-h-0 min-w-0 flex-1">
            {list && (
              <div className={`w-[248px] shrink-0 overflow-y-auto border-r border-line p-2.5 max-md:w-full max-md:border-r-0 ${narrowDetail ? 'max-md:hidden' : ''}`}>
                {list.render ? list.render(ctx, cur ?? (sec.id === 'models' ? providers[0]?.id : undefined), setCur) : (
                  <ul className="space-y-px">
                    {list.items.map((it) => {
                      const on = (cur ?? list.items[0]?.id) === it.id;
                      return (
                        <li key={it.id}>
                          <button type="button" onClick={() => setCur(it.id)} aria-current={on || undefined}
                            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors ${on ? 'bg-ink/[0.07] text-ink' : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink'}`}>
                            <ProviderLogo id={it.logo} name={it.name} size={18} /><span className="min-w-0 flex-1 truncate">{it.name}</span>
                            {it.on && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-jade" aria-label={t('providers.connected')} />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            <div className={`relative min-h-0 min-w-0 flex-1 ${list && !narrowDetail ? 'max-md:hidden' : ''}`}>
              {list && <button type="button" className="fs-btn fs-btn-ghost fs-btn-sm absolute left-3 top-3 z-10 md:hidden" onClick={() => setNarrowDetail(false)}><ArrowLeft size={14} aria-hidden /> {t('settings.back')}</button>}
              <div className="h-full max-md:pt-8">{sec.detail(ctx, cur, setCur)}</div>
            </div>
          </div>
        )}
        <button type="button" className="fs-icon-btn absolute right-3 top-3 z-20 max-md:right-2 max-md:top-2 max-md:bg-paper-2" onClick={() => ref.current?.close()} aria-label={t('settings.close')}><X size={16} /></button>
      </div>
    </dialog>
  );
}
