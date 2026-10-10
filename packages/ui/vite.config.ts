import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the panel runs on Vite and talks to a local core: `frametell --port 5317 --no-open`,
// then open http://localhost:5173/?token=… (the token printed by the CLI).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { proxy: { '/api': 'http://127.0.0.1:5317', '/p/': 'http://127.0.0.1:5317' } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
});
