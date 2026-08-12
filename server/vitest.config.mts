/**
 * Runner de testes do servidor. Existe por dois motivos concretos:
 *
 * 1. A lógica pura da camada de IA (validador de schema, laço de reparo)
 *    tinha sido só exercitada à mão num diretório temporário. Verificação
 *    descartável não pega regressão.
 * 2. `lib/templates/templates.test.ts` nunca rodou de verdade — era um
 *    script que dependia de `node arquivo.ts` resolver import ESM sem
 *    extensão, o que não acontece. Com nove seções na Ata, ele deixou de
 *    ser decorativo.
 *
 * O alias `@/` é declarado aqui à mão em vez de puxar `vite-tsconfig-paths`:
 * é uma linha, e uma dependência a menos no servidor.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
