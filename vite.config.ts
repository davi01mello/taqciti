import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { fileURLToPath, URL } from 'node:url';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Terceiro entry point, além de popup/side panel: nenhum campo do
      // manifesto MV3 cobre "página avulsa da extensão", então ela entra
      // direto aqui, no jeito padrão de app multi-página do Vite.
      input: {
        document: fileURLToPath(new URL('./src/document/index.html', import.meta.url)),
      },
    },
  },
});
