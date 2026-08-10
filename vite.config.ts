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
      // Entry points que nenhum campo do manifesto MV3 descobre sozinho, no
      // jeito padrão de app multi-página do Vite:
      // - document: página avulsa da extensão, sem campo de manifesto.
      // - sidepanel: era descoberto via a chave `side_panel` do manifesto: a
      //   janela principal migrou de side panel do Chrome pra
      //   `chrome.windows.create` (ver src/background/mainWindow.ts), então
      //   esse campo saiu do manifesto e o @crxjs parou de achar este HTML
      //   sozinho — precisa entrar aqui, senão some do build.
      input: {
        document: fileURLToPath(new URL('./src/document/index.html', import.meta.url)),
        sidepanel: fileURLToPath(new URL('./src/sidepanel/index.html', import.meta.url)),
      },
    },
  },
});
