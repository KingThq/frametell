import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/playfair-display/400-italic.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/jetbrains-mono/400.css';
import './index.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
