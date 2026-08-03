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
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
});
