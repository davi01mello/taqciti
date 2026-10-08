/**
 * Arquivos que a variante editorial desenha: artes de fundo, marca branca e a
 * fonte dos rótulos técnicos.
 *
 * Mesma regra de `render/brand.ts` e `render/fonts.ts`: leitura por `fs` com
 * caminho a partir de `process.cwd()`, e FALHA ALTO quando o arquivo não está
 * lá — sem ele o PDF sairia com um fundo branco ou a fonte padrão, sem erro
 * nenhum. Uma build `output: 'standalone'` precisa copiar `lib/documentos/
 * assets/` explicitamente.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FONTE_MONO = 'JetBrainsMono';
export const FONTE_MONO_NEGRITO = 'JetBrainsMono-Bold';

const cache = new Map<string, Buffer>();

function ler(...partes: string[]): Buffer {
  const caminho = join(process.cwd(), 'lib', 'documentos', 'assets', 'editorial', ...partes);
  const emCache = cache.get(caminho);
  if (emCache) return emCache;
  try {
    const buffer = readFileSync(caminho);
    cache.set(caminho, buffer);
    return buffer;
  } catch (error) {
    throw new Error(`Recurso não encontrado em ${caminho}. Causa: ${(error as Error).message}`);
  }
}

/** Uma das imagens de `assets/editorial/`, pelo nome do arquivo. */
export const imagemEditorial = (arquivo: string): Buffer => ler(arquivo);

/** Registra a fonte dos rótulos técnicos. Chame DEPOIS de `registrarFontes`. */
export function registrarFontesEditorial(doc: PDFKit.PDFDocument): void {
  doc.registerFont(FONTE_MONO, ler('fonts', 'JetBrainsMono-Regular.woff'));
  doc.registerFont(FONTE_MONO_NEGRITO, ler('fonts', 'JetBrainsMono-Bold.woff'));
}
