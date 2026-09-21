/**
 * Config isolada do Vitest. A maior parte dos testes cobre lógica pura (máquina
 * de estados, agregação, identidade de falante, fluxo da oportunidade), mas o
 * parser das legendas do Meet só tem valor contra DOM de verdade — por isso o
 * ambiente é jsdom. Sem plugin crxjs: nada aqui depende do bundle da extensão.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  /*
   * Os testes rodam com o andaime de desenvolvimento LIGADO — é a configuração
   * em que ele existe, e portanto a única em que ele pode ser testado. A
   * `Sidebar.test.tsx` monta o `App` inteiro, e com a bandeira indefinida a
   * montagem quebraria num `ReferenceError` que não diz nada sobre o produto.
   */
  define: {
    __TAQCITI_DEV__: 'true',
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
});
