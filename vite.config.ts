import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { fileURLToPath, URL } from 'node:url';
import manifest from './manifest.config';

/**
 * Deixa os chunks do painel legíveis em qualquer aba.
 *
 * ── A armadilha ────────────────────────────────────────────────────────────
 *
 * O @crxjs não injeta o content script direto: injeta um loader que busca o
 * módulo real com `import(chrome.runtime.getURL(...))`. Essa busca é barrada
 * quando a origem da página não casa com o `matches` da entrada de
 * `web_accessible_resources` que lista o chunk.
 *
 * E essa entrada o @crxjs monta sozinho, no build, copiando o `matches` do
 * content script declarado — `https://meet.google.com/*`. Está certo para a
 * injeção declarativa e errado para a sob demanda: o painel aberto pelo ícone
 * numa aba qualquer morreria no import, com o build passando e o `dist/`
 * parecendo correto. Só apareceria carregando no Chrome.
 *
 * Não dá para corrigir em `manifest.config.ts`: a entrada não existe lá: nasce
 * depois, com os nomes de chunk já hasheados. Daí o retoque ser aqui.
 *
 * ── E não, isto não amplia permissão ───────────────────────────────────────
 *
 * `web_accessible_resources` responde "quem pode LER estes arquivos meus",
 * nunca "onde eu posso agir". Não gera aviso de instalação, e sem o clique no
 * ícone (activeTab) não há injeção nenhuma para ler coisa alguma.
 */
function panelResourcesEverywhere(): Plugin {
  return {
    name: 'taqciti:panel-resources-everywhere',
    generateBundle: {
      // Depois do @crxjs: antes dele a entrada gerada ainda nem existe.
      order: 'post',
      handler(_options, bundle) {
        const asset = bundle['manifest.json'];
        if (!asset || asset.type !== 'asset' || typeof asset.source !== 'string') {
          // Ruído alto de propósito. O modo de falhar em silêncio deste retoque
          // é um painel que nunca abre fora do Meet — caro de diagnosticar.
          throw new Error(
            'manifest.json nao encontrado no bundle: o @crxjs mudou de forma, ' +
              'e os chunks do painel podem ter ficado restritos ao Meet.',
          );
        }

        const parsed = JSON.parse(asset.source) as {
          web_accessible_resources?: Array<{ matches: string[] }>;
        };
        for (const entry of parsed.web_accessible_resources ?? []) {
          entry.matches = ['<all_urls>'];
        }
        asset.source = JSON.stringify(parsed, null, 2);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), crx({ manifest }), panelResourcesEverywhere()],
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
