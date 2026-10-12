import { useState } from 'react';
import { useRoute } from './lib/hooks';
import type { SettingsPatch } from './lib/client';
import { TopBar } from './components/TopBar';
import { Home } from './views/Home';
import { Workbench } from './views/Workbench';
import { Settings } from './views/Settings';

export function App() {
  const route = useRoute();
  const [settings, setSettings] = useState<{ section?: string } | null>(null);
  // a click handler may pass its event: only a string names a section to open on
  const openSettings = (section?: unknown) => setSettings({ section: typeof section === 'string' ? section : undefined });
  const [epoch, setEpoch] = useState(0);   // bumps when settings change, so pickers reload
  // 「创作偏好」 saves as it is typed: the home screen only re-reads it, and keeps what was being written there
  const [prefsStamp, setPrefsStamp] = useState(0);
  const changed = (p: SettingsPatch) => (Object.keys(p).every((k) => k === 'preferences') ? setPrefsStamp((x) => x + 1) : setEpoch((e) => e + 1));
  return (
    <>
      {route.name === 'project'
        ? <Workbench key={route.id} id={route.id} openSettings={openSettings} />
        : <div className="min-h-full"><TopBar onSettings={openSettings} /><Home key={epoch} openSettings={openSettings} prefsStamp={prefsStamp} /></div>}
      <Settings open={!!settings} section={settings?.section} onClose={() => setSettings(null)} onChanged={changed} />
    </>
  );
}
