import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode single` emits one self-contained HTML file (used for the hosted preview).
export default defineConfig(({ mode }) => ({
  // A port of our own, so nothing else on the machine collides with it. Test scripts pass --port explicitly and still win.
  server: { port: 9710, strictPort: true },
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: mode === 'single' ? { outDir: 'dist-single', assetsInlineLimit: 100_000_000 } : {},
}));
