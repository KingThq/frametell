import { useState } from 'react';
import { useRoute } from './lib/hooks';
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
  return (
    <>
      {route.name === 'project'
        ? <Workbench key={route.id} id={route.id} openSettings={openSettings} />
        : <div className="min-h-full"><TopBar onSettings={openSettings} /><Home key={epoch} openSettings={openSettings} /></div>}
      <Settings open={!!settings} section={settings?.section} onClose={() => setSettings(null)} onChanged={() => setEpoch((e) => e + 1)} />
    </>
  );
}
