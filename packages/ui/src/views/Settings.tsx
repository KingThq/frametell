import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, ExternalLink, KeyRound, X } from 'lucide-react';
import { client, type PublicSettings, type SettingsPatch } from '../lib/client';
import { useLoad } from '../lib/hooks';
import { useT, type LocalePref, type MessageKey } from '../i18n';

/** the official APIs the Claude Agent and Codex runtimes run on; each can also point at the user's own relay */
const OFFICIAL: { id: 'anthropic' | 'openai'; name: MessageKey; desc: MessageKey; hint: string; url: string; base: string }[] = [
  { id: 'anthropic', name: 'settings.models.anthropicName', desc: 'settings.models.anthropicDesc', hint: 'sk-ant-…', url: 'https://console.anthropic.com/settings/keys', base: 'https://api.anthropic.com' },
  { id: 'openai', name: 'settings.models.openaiName', desc: 'settings.models.openaiDesc', hint: 'sk-…', url: 'https://platform.openai.com/api-keys', base: 'https://api.openai.com/v1' },
];
/** name: a brand name, or a key when the name is translated */
const PROVIDERS: { id: string; name: string; nameKey?: MessageKey; hint: string; url?: string }[] = [
  { id: 'google', name: 'Google Gemini', hint: 'AIza…', url: 'https://aistudio.google.com/apikey' },
  { id: 'openrouter', name: 'OpenRouter', hint: 'sk-or-…', url: 'https://openrouter.ai/keys' },
  { id: 'vercel-ai-gateway', name: 'Vercel AI Gateway', hint: 'vck_…', url: 'https://vercel.com/docs/ai-gateway' },
  { id: 'deepseek', name: 'DeepSeek', hint: 'sk-…', url: 'https://platform.deepseek.com/api_keys' },
  { id: 'volcengine-ark', name: 'Volcengine Ark', nameKey: 'settings.models.ark', hint: 'API Key', url: 'https://console.volcengine.com/ark' },
];
const RUNTIMES = [
  { id: 'pi', name: 'Studio Agent', desc: 'settings.defaults.piDesc' },
  { id: 'claude-agent-sdk', name: 'Claude Agent', desc: 'settings.defaults.claudeDesc' },
  { id: 'codex', name: 'Codex', desc: 'settings.defaults.codexDesc' },
] as const;

/** a key field: shows the saved key masked; typing replaces it, clearing removes it */
function KeyField({ id, label, saved, placeholder, onSave }: { id: string; label: string; saved?: string; placeholder: string; onSave: (v: string) => Promise<void> }) {
  const { t } = useT();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const save = async (v: string) => { setBusy(true); try { await onSave(v); setValue(''); setDone(true); setTimeout(() => setDone(false), 1600); } finally { setBusy(false); } };
  return (
    <div>
      <label htmlFor={`key-${id}`} className="sr-only">{label} API key</label>
      <div className="flex gap-2">
        <input id={`key-${id}`} type="password" autoComplete="off" spellCheck={false} className="fs-input font-mono text-[12.5px]"
          placeholder={saved ? t('settings.savedAs', { key: saved }) : placeholder} value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && value && save(value)} />
        {value ? (
          <button className="fs-btn fs-btn-primary fs-btn-sm h-9" disabled={busy} onClick={() => save(value)}>{t('settings.save')}</button>
        ) : saved ? (
          <button className="fs-btn fs-btn-ghost fs-btn-sm h-9" disabled={busy} onClick={() => save('')} aria-label={t('settings.removeKey', { name: label })}>{t('settings.remove')}</button>
        ) : null}
      </div>
      {done && <p className="mt-1.5 flex items-center gap-1 text-[12px] text-jade" role="status"><Check size={13} /> {t('settings.saved')}</p>}
    </div>
  );
}

/** a plain setting saved on Enter or blur (a relay URL, the proxy); clearing it removes the setting */
function TextField({ id, label, saved, placeholder, onSave }: { id: string; label: string; saved: string; placeholder: string; onSave: (v: string) => Promise<void> }) {
  const { t } = useT();
  const [value, setValue] = useState(saved);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => setValue(saved), [saved]);
  const save = async () => {
    if (value.trim() === saved) return;
    try { await onSave(value.trim()); setError(''); setDone(true); setTimeout(() => setDone(false), 1600); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12px] text-ink-3">{label}</label>
      <input id={id} type="url" autoComplete="off" spellCheck={false} className="fs-input font-mono text-[12.5px]" placeholder={placeholder}
        value={value} onChange={(e) => setValue(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-invalid={!!error || undefined} aria-describedby={error ? `${id}-err` : undefined} />
      {error && <p id={`${id}-err`} className="mt-1.5 flex items-center gap-1 text-[12px] text-seal" role="alert"><CircleAlert size={13} /> {error}</p>}
      {done && <p className="mt-1.5 flex items-center gap-1 text-[12px] text-jade" role="status"><Check size={13} /> {t('settings.saved')}</p>}
    </div>
  );
}

export function Settings({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged?: () => void }) {
  const { t, pref, setPref } = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const settings = useLoad(() => client.settings(), [open]);
  const env = useLoad(() => client.env(), [open]);
  const models = useLoad(() => client.models(), [open, settings.data?.keys && JSON.stringify(settings.data.keys)]);
  const [local, setLocal] = useState<PublicSettings | undefined>();
  useEffect(() => { if (settings.data) setLocal(settings.data); }, [settings.data]);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);

  const patch = async (p: SettingsPatch) => { const next = await client.updateSettings(p); setLocal(next); models.reload(); onChanged?.(); };
  const s = local;
  // the provider of the model new videos use; a card for it is "in use", any other card with a key offers itself
  const current = s?.defaults.model ?? (models.data?.default ? `${models.data.default.provider}/${models.data.default.id}` : undefined);
  const inUse = current?.split('/')[0];
  const use = (provider: string) => {
    const list = (models.data?.models || []).filter((m) => m.provider === provider);
    const m = list.find((x) => x.recommended) ?? list.find((x) => x.vision) ?? list[0];
    if (!m || !s) return;
    // a runtime that cannot talk to this provider moves to the one that can
    const runtime = provider === 'anthropic' && s.defaults.runtime === 'codex' ? 'claude-agent-sdk'
      : provider === 'openai' && s.defaults.runtime === 'claude-agent-sdk' ? 'codex'
      : !['relay', 'anthropic', 'openai'].includes(provider) && s.defaults.runtime !== 'pi' ? 'pi' : s.defaults.runtime;
    return patch({ defaults: { model: `${m.provider}/${m.id}`, runtime } });
  };
  const card = (id: string) => `rounded-2xl border p-4 transition-colors ${inUse === id ? 'border-accent/60 bg-accent-soft/50' : 'border-line'}`;
  const UseButton = ({ id }: { id: string }) => inUse === id
    ? <span className="fs-tag border-accent/40 bg-accent-soft text-accent-ink"><Check size={11} aria-hidden /> {t('settings.inUse')}</span>
    : s?.keys[id] && models.data?.models.some((m) => m.provider === id)
      ? <button type="button" className="fs-btn fs-btn-ghost fs-btn-sm" onClick={() => use(id)}>{t('settings.useThis')}</button>
      : null;

  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} aria-labelledby="settings-title"
      className="fixed inset-y-0 right-0 m-0 ml-auto h-full max-h-none w-full max-w-[480px] border-l border-line bg-paper p-0 text-ink shadow-[var(--fs-shadow-lg)] backdrop:bg-black/40 open:animate-[fade_200ms_ease-out]">
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id="settings-title" className="text-[15px] font-semibold">{t('settings.title')}</h2>
          <button className="fs-icon-btn" onClick={onClose} aria-label={t('settings.close')}><X size={16} /></button>
        </header>
        {!s ? <div className="p-6 text-[13px] text-ink-3">{t('settings.loading')}</div> : (
          <div className="flex-1 space-y-9 overflow-y-auto px-6 py-6">
            <section aria-labelledby="sec-lang">
              <h3 id="sec-lang" className="text-[13px] font-semibold text-ink">{t('settings.language.title')}</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{t('settings.language.desc')}</p>
              <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="sec-lang">
                {(['auto', 'zh', 'en'] as LocalePref[]).map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={(s.locale ?? pref) === p} className="fs-chip"
                    onClick={() => { setPref(p); patch({ locale: p }); }}>{t(`settings.language.${p}`)}</button>
                ))}
              </div>
            </section>

            <section aria-labelledby="sec-models">
              <h3 id="sec-models" className="text-[13px] font-semibold text-ink">{t('settings.models.title')}</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{t('settings.models.desc')}</p>
              <div className={`mt-4 ${card('relay')}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[14px] font-semibold">Relay <span className="fs-tag border-accent/40 text-accent-ink">{t('settings.recommended')}</span></span>
                  <UseButton id="relay" />
                </div>
                <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-ink-2">{t('settings.models.relayDesc')}</p>
                <KeyField id="relay" label="Relay" saved={s.keys.relay} placeholder="sk-flash-…" onSave={(v) => patch({ keys: { relay: v } })} />
                <a href="https://relay.example.com" target="_blank" rel="noreferrer" className="mt-2.5 inline-flex items-center gap-1 text-[12px] text-accent-ink hover:underline">{t('settings.models.getRelay')} <ExternalLink size={12} /></a>
              </div>
              <div className="mt-3 space-y-3">
                {OFFICIAL.map((p) => (
                  <div key={p.id} className={card(p.id)}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13.5px] font-semibold">{t(p.name)}</span>
                      <span className="flex items-center gap-3">
                        {!s.keys[p.id] && <a href={p.url} target="_blank" rel="noreferrer" className="text-[11.5px] text-ink-3 hover:text-ink">{t('settings.getKey')}</a>}
                        <UseButton id={p.id} />
                      </span>
                    </div>
                    <p className="mb-3 mt-1 text-[12px] leading-relaxed text-ink-3">{t(p.desc)}</p>
                    <KeyField id={p.id} label={t(p.name)} saved={s.keys[p.id]} placeholder={p.hint} onSave={(v) => patch({ keys: { [p.id]: v } })} />
                    <details className="group/relay mt-2.5" open={!!s.baseUrls?.[p.id]}>
                      <summary className="cursor-pointer list-none text-[12px] text-ink-3 hover:text-ink">
                        {s.baseUrls?.[p.id] ? t('settings.models.baseUrl', { url: s.baseUrls[p.id] }) : t('settings.models.changeBase')}
                      </summary>
                      <div className="mt-2">
                        <TextField id={`base-${p.id}`} label={t('settings.models.baseDefault', { url: p.base })} saved={s.baseUrls?.[p.id] ?? ''} placeholder={p.base}
                          onSave={(v) => patch({ baseUrls: { [p.id]: v } })} />
                      </div>
                    </details>
                  </div>
                ))}
              </div>
              <details className="group mt-3">
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-1 py-2 text-[13px] text-ink-2 hover:text-ink">
                  <span>{t('settings.models.others')} <span className="text-ink-3">{t('settings.models.connected', { n: PROVIDERS.filter((p) => s.keys[p.id]).length })}</span></span>
                  <span className="text-ink-3 transition-transform group-open:rotate-90" aria-hidden>›</span>
                </summary>
                <div className="mt-2 space-y-4">
                  {PROVIDERS.map((p) => (
                    <div key={p.id}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[12.5px] font-medium text-ink-2">{p.nameKey ? t(p.nameKey) : p.name}</span>
                        {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-[11.5px] text-ink-3 hover:text-ink">{t('settings.getKey')}</a>}
                      </div>
                      <KeyField id={p.id} label={p.nameKey ? t(p.nameKey) : p.name} saved={s.keys[p.id]} placeholder={p.hint} onSave={(v) => patch({ keys: { [p.id]: v } })} />
                    </div>
                  ))}
                </div>
              </details>
            </section>

            <section aria-labelledby="sec-default">
              <h3 id="sec-default" className="text-[13px] font-semibold">{t('settings.defaults.title')}</h3>
              <label htmlFor="default-model" className="fs-label mt-4">{t('settings.defaults.model')}</label>
              <select id="default-model" className="fs-input" value={s.defaults.model ?? ''} disabled={!models.data?.models.length}
                onChange={(e) => patch({ defaults: { model: e.target.value } })}>
                {!s.defaults.model && <option value="">{models.data?.default ? t('settings.defaults.auto', { name: models.data.default.name }) : t('settings.defaults.connectFirst')}</option>}
                {models.data?.models.map((m) => <option key={m.provider + m.id} value={`${m.provider}/${m.id}`}>{m.providerName} · {m.name}{m.recommended ? t('settings.defaults.recommended') : ''}{m.vision ? '' : t('settings.defaults.noVision')}</option>)}
              </select>
              <fieldset className="mt-5">
                <legend className="fs-label">{t('settings.defaults.runtime')}</legend>
                <div className="space-y-2">
                  {RUNTIMES.map((r) => (
                    <label key={r.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors ${s.defaults.runtime === r.id ? 'border-accent/60 bg-accent-soft/50' : 'border-line hover:border-line-2'}`}>
                      <input type="radio" name="runtime" className="mt-0.5 accent-[rgb(var(--fs-accent))]" checked={s.defaults.runtime === r.id} onChange={() => patch({ defaults: { runtime: r.id } })} />
                      <span><span className="block text-[13px] font-medium">{r.name}</span><span className="mt-0.5 block text-[12px] leading-relaxed text-ink-3">{t(r.desc)}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>

            <section aria-labelledby="sec-voice">
              <h3 id="sec-voice" className="text-[13px] font-semibold">{t('settings.voice.title')}</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{t('settings.voice.desc')}</p>
              <div className="mt-4 space-y-4">
                <div>
                  <div className="mb-1.5 flex items-center justify-between"><span className="text-[12.5px] font-medium text-ink-2">{t('settings.voice.volc')}</span><a href="https://console.volcengine.com/speech/app" target="_blank" rel="noreferrer" className="text-[11.5px] text-ink-3 hover:text-ink">{t('settings.getKey')}</a></div>
                  <KeyField id="tts-volc" label={t('settings.voice.volcLabel')} saved={s.tts.volcengine} placeholder="API Key" onSave={(v) => patch({ tts: { volcengine: v } })} />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between"><span className="text-[12.5px] font-medium text-ink-2">ElevenLabs</span><a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer" className="text-[11.5px] text-ink-3 hover:text-ink">{t('settings.getKey')}</a></div>
                  <KeyField id="tts-11" label="ElevenLabs" saved={s.tts.elevenlabs} placeholder="sk_…" onSave={(v) => patch({ tts: { elevenlabs: v } })} />
                </div>
              </div>
            </section>

            <section aria-labelledby="sec-net">
              <h3 id="sec-net" className="text-[13px] font-semibold">{t('settings.net.title')}</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{t('settings.net.desc')}</p>
              <div className="mt-3">
                <TextField id="proxy" label={t('settings.net.proxy')} saved={s.proxy ?? ''} placeholder="http://127.0.0.1:7890" onSave={(v) => patch({ proxy: v })} />
              </div>
            </section>

            <section aria-labelledby="sec-env" className="pb-4">
              <h3 id="sec-env" className="text-[13px] font-semibold">{t('settings.env.title')}</h3>
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                {(env.data || []).map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-3.5 py-3">
                    {c.ok ? <Check size={15} className="mt-0.5 shrink-0 text-jade" aria-label={t('settings.env.ok')} /> : <CircleAlert size={15} className="mt-0.5 shrink-0 text-seal" aria-label={t('settings.env.fix')} />}
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium">{t(`settings.env.${c.id}`)}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-ink-3" title={c.detail}>{c.ok ? c.detail : c.fix}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink-3"><KeyRound size={12} /> {t('settings.env.where')}</p>
            </section>
          </div>
        )}
      </div>
    </dialog>
  );
}
