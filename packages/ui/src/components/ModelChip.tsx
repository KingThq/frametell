import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu, Settings2 } from 'lucide-react';
import { client, type ModelInfo, type ProjectView } from '../lib/client';
import { modelKey, nameOf } from './ModelPicker';
import { ProviderLogo } from './ProviderLogo';
import { useT } from '../i18n';

// The model a film is made with, in the project's top bar: switching saves it to the film at once. A run already going
// is stopped with it (it would keep the model it started with), so the panel says so and 继续制作 goes on with the new one.

export function ModelChip({ project, openSettings, onChanged }: {
  project: ProjectView;
  openSettings?: (section?: string) => void;
  /** the film's own record changed: read it again */
  onChanged?: () => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // the film's model as last saved: the label follows a switch at once, without waiting for the page to reload
  const [current, setCurrent] = useState(project.model);
  const root = useRef<HTMLDivElement>(null);
  const short = current.split('/').slice(1).join('/');
  // a host that runs the models itself (Frametell Cloud) leaves the model out of the panel
  const setModel = client.setProjectModel;

  useEffect(() => { setCurrent(project.model); }, [project.model]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('mousedown', away);
    return () => removeEventListener('mousedown', away);
  }, [open]);
  // read the models the first time the panel opens: most films are never switched
  useEffect(() => {
    if (!open || models) return;
    client.models().then(({ models }) => setModels(models), (e: Error) => setError(t('conversation.model.failed', { msg: e.message })));
  }, [open, models]);

  const choose = async (key: string) => {
    if (!setModel || key === current) { setOpen(false); return; }
    setBusy(true); setError(undefined);
    try {
      await setModel(project.id, key);
      setCurrent(key);
      setOpen(false);
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!setModel) return null;

  // the connected providers in the order the catalog lists them, like the picker on the home screen
  const groups = models ? [...models.reduce((by, m) => {
    const g = by.get(m.provider) ?? { provider: m.provider, name: nameOf(m), items: [] as ModelInfo[] };
    g.items.push(m);
    return by.set(m.provider, g);
  }, new Map<string, { provider: string; name: string; items: ModelInfo[] }>()).values()] : [];

  return (
    <div ref={root} className="relative min-w-0">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}
        title={t('conversation.model.title')}
        className={`flex h-7 max-w-[150px] min-w-0 items-center gap-1.5 rounded-lg border px-2 text-[12px] transition-colors duration-150 sm:max-w-[190px] ${open ? 'border-accent/60 bg-accent-soft/50 text-ink' : 'border-line text-ink-2 hover:border-line-2 hover:text-ink'}`}>
        <Cpu size={13} className={`shrink-0 ${busy ? 'animate-pulse text-accent-ink' : 'text-ink-3'}`} aria-hidden />
        <span className="sr-only">{t('conversation.model.title')}</span>
        {/* on a phone the bar has no room for the name: the chip is the icon alone, and the panel marks the one in use */}
        <span className="hidden min-w-0 flex-1 truncate text-left sm:block">{short}</span>
        <ChevronDown size={12} className={`hidden shrink-0 text-ink-3 transition-transform duration-200 sm:block ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div role="dialog" aria-label={t('conversation.model.title')}
          className="fixed inset-x-2 top-[52px] z-40 overflow-hidden rounded-xl border border-line bg-surface shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35),0_2px_6px_rgb(0_0_0/0.12)] animate-fade sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-[340px]">
          <p className="border-b border-line px-3 py-2 text-[11.5px] leading-relaxed text-ink-3">{t('conversation.model.hint')}</p>
          <div className="max-h-[300px] overflow-y-auto overscroll-contain py-1.5">
            {!models && !error && <p className="px-3 py-4 text-center text-[12.5px] text-ink-3" role="status">{t('conversation.model.loading')}</p>}
            {error && <p className="px-3 py-2 text-[12px] text-seal" role="alert">{error}</p>}
            {groups.map((g) => (
              <section key={g.provider}>
                <p className="flex items-center gap-1.5 px-3 pb-0.5 pt-2 text-[11px] text-ink-3"><ProviderLogo id={g.provider} name={g.name} size={12} />{g.name}</p>
                {g.items.map((m) => {
                  const on = modelKey(m) === current;
                  return (
                    <button key={m.id} type="button" disabled={busy} onClick={() => void choose(modelKey(m))}
                      className={`mx-1.5 flex w-[calc(100%-12px)] items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-ink/[0.05] disabled:opacity-60 ${on ? 'text-ink' : 'text-ink-2'}`}>
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      {on && <Check size={13} className="shrink-0 text-accent-ink" aria-hidden />}
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
          {openSettings && (
            <button type="button" onClick={() => { setOpen(false); openSettings('models'); }}
              className="flex w-full items-center gap-2 border-t border-line px-3.5 py-2.5 text-left text-[12.5px] text-ink-2 transition-colors hover:bg-ink/[0.04] hover:text-ink">
              <Settings2 size={13} aria-hidden /> {t('conversation.model.manage')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
