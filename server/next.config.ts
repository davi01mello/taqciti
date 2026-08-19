import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // O repo tem package-lock.json na raiz E aqui em server/ (dois projetos
  // independentes) — sem isto o Turbopack detecta os dois e avisa "raiz
  // ambígua" a cada build.
  turbopack: {
    root: fileURLToPath(new URL('.', import.meta.url)),
  },

  /**
   * `pdfkit` PRECISA ficar fora do bundle, e isto não é ajuste fino.
   *
   * Ele lê arquivos de dentro do próprio pacote (`js/data/*.afm`, as métricas
   * das 14 fontes padrão do PDF) usando caminho relativo ao módulo. Ao empacotá-lo,
   * o Turbopack reescreve esse caminho e ele vira `C:\ROOT\node_modules\pdfkit\...`,
   * que não existe em lugar nenhum. O efeito era só em BUILD DE PRODUÇÃO — em
   * `next dev` e no vitest o pacote é carregado normalmente e tudo funciona —,
   * e `generateDocument` engole a falha do PDF de propósito (o HTML continua
   * saindo), então a rota respondia 200, sem PDF e sem erro visível. Ou seja:
   * o download saía sem o arquivo, em silêncio, só no ambiente que importa.
   *
   * Descoberto chamando `POST /api/generate` contra `next start` — nenhum
   * teste unitário pegaria, porque nenhum deles passa pelo bundler.
   */
  serverExternalPackages: ['pdfkit'],
};

export default nextConfig;
