import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // O repo tem package-lock.json na raiz E aqui em server/ (dois projetos
  // independentes) — sem isto o Turbopack detecta os dois e avisa "raiz
  // ambígua" a cada build.
  turbopack: {
    root: fileURLToPath(new URL('.', import.meta.url)),
  },
};

export default nextConfig;
