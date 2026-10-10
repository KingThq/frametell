import { useState } from 'react';
import { useRoute } from './lib/hooks';
import { TopBar } from './components/TopBar';
import { Home } from './views/Home';
import { Workbench } from './views/Workbench';
import { Settings } from './views/Settings';

export function App() {
  const route = useRoute();
  const [settings, setSettings] = useState(false);
  const [epoch, setEpoch] = useState(0);   // bumps when settings change, so pickers reload
  return (
    <>
      {route.name === 'project'
        ? <Workbench key={route.id} id={route.id} openSettings={() => setSettings(true)} />
        : <div className="min-h-full"><TopBar onSettings={() => setSettings(true)} /><Home key={epoch} openSettings={() => setSettings(true)} /></div>}
      <Settings open={settings} onClose={() => setSettings(false)} onChanged={() => setEpoch((e) => e + 1)} />
    </>
  );
}
