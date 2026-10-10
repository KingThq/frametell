import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, ExternalLink, KeyRound, X } from 'lucide-react';
import { client, type PublicSettings, type SettingsPatch } from '../lib/client';
import { useLoad } from '../lib/hooks';

const PROVIDERS: { id: string; name: string; hint: string; url?: string }[] = [
  { id: 'anthropic', name: 'Anthropic', hint: 'sk-ant-…', url: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', name: 'OpenAI', hint: 'sk-…', url: 'https://platform.openai.com/api-keys' },
  { id: 'google', name: 'Google Gemini', hint: 'AIza…', url: 'https://aistudio.google.com/apikey' },
  { id: 'openrouter', name: 'OpenRouter', hint: 'sk-or-…', url: 'https://openrouter.ai/keys' },
  { id: 'vercel-ai-gateway', name: 'Vercel AI Gateway', hint: 'vck_…', url: 'https://vercel.com/docs/ai-gateway' },
  { id: 'deepseek', name: 'DeepSeek', hint: 'sk-…', url: 'https://platform.deepseek.com/api_keys' },
  { id: 'volcengine-ark', name: '火山方舟', hint: 'API Key', url: 'https://console.volcengine.com/ark' },
];
const RUNTIMES = [
  { id: 'pi', name: 'Studio Agent', desc: '默认。基于 Pi，任何模型都能用。' },
  { id: 'claude-agent-sdk', name: 'Claude Agent', desc: 'Claude Agent SDK，使用 Anthropic 或 Relay 的 key。' },
  { id: 'codex', name: 'Codex', desc: 'OpenAI Codex SDK，使用 OpenAI 或 Relay 的 key。' },
] as const;

/** a key field: shows the saved key masked; typing replaces it, clearing removes it */
function KeyField({ id, label, saved, placeholder, onSave }: { id: string; label: string; saved?: string; placeholder: string; onSave: (v: string) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const save = async (v: string) => { setBusy(true); try { await onSave(v); setValue(''); setDone(true); setTimeout(() => setDone(false), 1600); } finally { setBusy(false); } };
  return (
    <div>
      <label htmlFor={`key-${id}`} className="sr-only">{label} API key</label>
      <div className="flex gap-2">
        <input id={`key-${id}`} type="password" autoComplete="off" spellCheck={false} className="fs-input font-mono text-[12.5px]"
          placeholder={saved ? `已保存 ${saved}` : placeholder} value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && value && save(value)} />
        {value ? (
          <button className="fs-btn fs-btn-primary fs-btn-sm h-9" disabled={busy} onClick={() => save(value)}>保存</button>
        ) : saved ? (
          <button className="fs-btn fs-btn-ghost fs-btn-sm h-9" disabled={busy} onClick={() => save('')} aria-label={`移除 ${label} 的 key`}>移除</button>
        ) : null}
      </div>
      {done && <p className="mt-1.5 flex items-center gap-1 text-[12px] text-jade" role="status"><Check size={13} /> 已保存</p>}
    </div>
  );
}

export function Settings({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const settings = useLoad(() => client.settings(), [open]);
  const env = useLoad(() => client.env(), [open]);
  const models = useLoad(() => client.models(), [open, settings.data?.keys && JSON.stringify(settings.data.keys)]);
  const [local, setLocal] = useState<PublicSettings | undefined>();
  useEffect(() => { if (settings.data) setLocal(settings.data); }, [settings.data]);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);

  const patch = async (p: SettingsPatch) => { const next = await client.updateSettings(p); setLocal(next); models.reload(); onChanged?.(); };
  const s = local;

  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} aria-labelledby="settings-title"
      className="fixed inset-y-0 right-0 m-0 ml-auto h-full max-h-none w-full max-w-[480px] border-l border-line bg-paper p-0 text-ink shadow-[var(--fs-shadow-lg)] backdrop:bg-black/40 open:animate-[fade_200ms_ease-out]">
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id="settings-title" className="text-[15px] font-semibold">设置</h2>
          <button className="fs-icon-btn" onClick={onClose} aria-label="关闭设置"><X size={16} /></button>
        </header>
        {!s ? <div className="p-6 text-[13px] text-ink-3">读取设置…</div> : (
          <div className="flex-1 space-y-9 overflow-y-auto px-6 py-6">
            <section aria-labelledby="sec-models">
              <h3 id="sec-models" className="text-[13px] font-semibold text-ink">模型</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">至少连接一个。Key 只保存在这台电脑上，只发给它所属的服务商。</p>
              <div className="mt-4 rounded-2xl border border-accent/40 bg-accent-soft/60 p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] font-semibold">Relay</span>
                  <span className="fs-tag border-accent/40 bg-accent-soft text-accent-ink">推荐</span>
                </div>
                <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-ink-2">一个 key 用上 Claude、Gemini、GPT，人民币计价。推荐搭配 Claude Opus 5.5。</p>
                <KeyField id="relay" label="Relay" saved={s.keys.relay} placeholder="sk-flash-…" onSave={(v) => patch({ keys: { relay: v } })} />
                <a href="https://relay.example.com" target="_blank" rel="noreferrer" className="mt-2.5 inline-flex items-center gap-1 text-[12px] text-accent-ink hover:underline">获取 Relay key <ExternalLink size={12} /></a>
              </div>
              <details className="group mt-3">
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-1 py-2 text-[13px] text-ink-2 hover:text-ink">
                  <span>其他服务商 <span className="text-ink-3">· 已连接 {PROVIDERS.filter((p) => s.keys[p.id]).length}</span></span>
                  <span className="text-ink-3 transition-transform group-open:rotate-90" aria-hidden>›</span>
                </summary>
                <div className="mt-2 space-y-4">
                  {PROVIDERS.map((p) => (
                    <div key={p.id}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[12.5px] font-medium text-ink-2">{p.name}</span>
                        {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-[11.5px] text-ink-3 hover:text-ink">获取 key</a>}
                      </div>
                      <KeyField id={p.id} label={p.name} saved={s.keys[p.id]} placeholder={p.hint} onSave={(v) => patch({ keys: { [p.id]: v } })} />
                    </div>
                  ))}
                </div>
              </details>
            </section>

            <section aria-labelledby="sec-default">
              <h3 id="sec-default" className="text-[13px] font-semibold">默认模型与 Agent</h3>
              <label htmlFor="default-model" className="fs-label mt-4">模型</label>
              <select id="default-model" className="fs-input" value={s.defaults.model ?? ''} disabled={!models.data?.models.length}
                onChange={(e) => patch({ defaults: { model: e.target.value } })}>
                {!s.defaults.model && <option value="">{models.data?.default ? `自动（${models.data.default.name}）` : '先连接一个服务商'}</option>}
                {models.data?.models.map((m) => <option key={m.provider + m.id} value={`${m.provider}/${m.id}`}>{m.providerName} · {m.name}{m.recommended ? '（推荐）' : ''}{m.vision ? '' : ' · 不能看图'}</option>)}
              </select>
              <fieldset className="mt-5">
                <legend className="fs-label">Agent 运行时</legend>
                <div className="space-y-2">
                  {RUNTIMES.map((r) => (
                    <label key={r.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors ${s.defaults.runtime === r.id ? 'border-accent/60 bg-accent-soft/50' : 'border-line hover:border-line-2'}`}>
                      <input type="radio" name="runtime" className="mt-0.5 accent-[rgb(var(--fs-accent))]" checked={s.defaults.runtime === r.id} onChange={() => patch({ defaults: { runtime: r.id } })} />
                      <span><span className="block text-[13px] font-medium">{r.name}</span><span className="mt-0.5 block text-[12px] leading-relaxed text-ink-3">{r.desc}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>

            <section aria-labelledby="sec-voice">
              <h3 id="sec-voice" className="text-[13px] font-semibold">配音</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">不连接也能出片，只是没有声音。</p>
              <div className="mt-4 space-y-4">
                <div>
                  <div className="mb-1.5 flex items-center justify-between"><span className="text-[12.5px] font-medium text-ink-2">火山引擎 · 豆包语音</span><a href="https://console.volcengine.com/speech/app" target="_blank" rel="noreferrer" className="text-[11.5px] text-ink-3 hover:text-ink">获取 key</a></div>
                  <KeyField id="tts-volc" label="火山引擎语音" saved={s.tts.volcengine} placeholder="API Key" onSave={(v) => patch({ tts: { volcengine: v } })} />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between"><span className="text-[12.5px] font-medium text-ink-2">ElevenLabs</span><a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer" className="text-[11.5px] text-ink-3 hover:text-ink">获取 key</a></div>
                  <KeyField id="tts-11" label="ElevenLabs" saved={s.tts.elevenlabs} placeholder="sk_…" onSave={(v) => patch({ tts: { elevenlabs: v } })} />
                </div>
              </div>
            </section>

            <section aria-labelledby="sec-env" className="pb-4">
              <h3 id="sec-env" className="text-[13px] font-semibold">这台电脑</h3>
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                {(env.data || []).map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-3.5 py-3">
                    {c.ok ? <Check size={15} className="mt-0.5 shrink-0 text-jade" aria-label="正常" /> : <CircleAlert size={15} className="mt-0.5 shrink-0 text-seal" aria-label="需要处理" />}
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium">{({ chrome: '浏览器（用于渲染）', ffmpeg: '视频编码', git: '版本记录（撤销）', node: 'Node.js' } as const)[c.id]}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-ink-3" title={c.detail}>{c.ok ? c.detail : c.fix}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink-3"><KeyRound size={12} /> 设置保存在 ~/.frametell/config.json，仅本机用户可读。</p>
            </section>
          </div>
        )}
      </div>
    </dialog>
  );
}
