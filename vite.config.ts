import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { fileURLToPath, URL } from 'node:url';
import manifest from './manifest.config';

/**
 * Trava: os chunks do painel são legíveis SÓ no Meet — e em todo o Meet.
 *
 * ── A armadilha ────────────────────────────────────────────────────────────
 *
 * O @crxjs não injeta o content script direto: injeta um loader que busca o
 * módulo real com `import(chrome.runtime.getURL(...))`. Essa busca é barrada
 * quando a origem da página não casa com o `matches` da entrada de
 * `web_accessible_resources` que lista o chunk.
 *
 * Essa entrada o @crxjs monta sozinho, no build, copiando o `matches` do
 * content script declarado. Este plugin fixa o resultado em um valor só, para
 * que nenhuma entrada gerada fique mais larga (expondo a extensão a
 * fingerprinting por qualquer site) nem mais estreita (o painel morrendo no
 * import, com o build passando e o `dist/` parecendo correto — só apareceria
 * carregando no Chrome).
 *
 * Até 21/10/2026 o valor era `<all_urls>`, porque o painel existia em toda
 * página. Ele hoje só existe no Meet (ver `src/content/index.ts`), e expor os
 * arquivos a todo site só servia para qualquer página detectar a extensão pelo
 * ID fixo.
 *
 * Não dá para escrever isto em `manifest.config.ts`: a entrada não existe lá,
 * nasce depois, com os nomes de chunk já hasheados. Daí o retoque ser aqui.
 */
const ONDE_O_PAINEL_VIVE = ['https://meet.google.com/*'];

function panelResourcesOnlyOnMeet(): Plugin {
  return {
    name: 'taqciti:panel-resources-only-on-meet',
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
          entry.matches = [...ONDE_O_PAINEL_VIVE];
        }
        asset.source = JSON.stringify(parsed, null, 2);
      },
    },
  };
}

/**
 * Trava: uma build de PRODUÇÃO não sai apontando para `http://` nem com a chave
 * de desenvolvimento.
 *
 * O CI já recusa isso (`.github/scripts/check-release-env.sh`), mas a build
 * local — a que vai por robocopy para o Chrome de quem desenvolve — não passava
 * por ele: sem o `.env`, ela caía em `http://localhost:3000` e na chave pública
 * de dev, em silêncio. Sem TLS, a transcrição e o token do Google viajariam em
 * claro; com a chave de dev, nada funcionaria e nada diria por quê.
 */
function servidorDeProducaoSeguro(mode: string): Plugin {
  return {
    name: 'taqciti:servidor-de-producao-seguro',
    config() {
      if (mode !== 'production') return;
      const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
      const url = env.VITE_DOCCITI_SERVER_URL ?? '';
      const chave = env.VITE_DOCCITI_SHARED_KEY ?? '';
      const problemas: string[] = [];
      if (!/^https:\/\//.test(url)) problemas.push(`VITE_DOCCITI_SERVER_URL precisa ser https (está "${url || 'vazia'}")`);
      if (!chave || chave === 'taqciti-dev-local') problemas.push('VITE_DOCCITI_SHARED_KEY ausente ou com o valor de desenvolvimento');
      if (problemas.length > 0) {
        throw new Error(
          `Build de produção recusada: ${problemas.join('; ')}. ` +
            'Para testar contra o servidor local, use `npm run build:dev`.',
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), crx({ manifest }), panelResourcesOnlyOnMeet(), servidorDeProducaoSeguro(mode)],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  /*
   * A bandeira do andaime de desenvolvimento. Literal em tempo de build, para
   * o ramo inteiro poder ser eliminado quando ela é falsa — ver
   * `src/ambiente.d.ts` para o porquê de não ser `import.meta.env.DEV`.
   */
  define: {
    __TAQCITI_DEV__: JSON.stringify(mode !== 'production'),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Pastas separadas: carregar a extensão de desenvolvimento no Chrome não
    // pode exigir rebuildar a de produção depois, e vice-versa.
    outDir: mode === 'production' ? 'dist' : 'dist-dev',
    emptyOutDir: true,
    rollupOptions: {
      // Entry points que nenhum campo do manifesto MV3 descobre sozinho: são
      // páginas avulsas, abertas por URL, sem chave de manifesto que as
      // aponte. O painel lateral NÃO precisa estar aqui — `side_panel` voltou
      // ao manifesto e o @crxjs acha o HTML por ele.
      input: {
        document: fileURLToPath(new URL('./src/document/index.html', import.meta.url)),
        home: fileURLToPath(new URL('./src/home/index.html', import.meta.url)),
      },
    },
  },
}));
