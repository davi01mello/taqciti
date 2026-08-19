/**
 * O PDF de referência (`example.pdf`) como Buffer — a fonte do gráfico
 * sangrado da capa que `pdf.ts` embute de verdade via `pdf-lib`, em vez de
 * tentar redesenhá-lo à mão (a primeira tentativa foi um gradiente
 * aproximado; este arquivo é o que substitui aquilo pela arte real).
 *
 * `assets/example.pdf` é CÓPIA de
 * `public/assets-docs/ata-de-reuniao/example.pdf`, na raiz do repo — mesma
 * razão e o mesmo par que já existe pra `citi-30-anos.png`/`image.png` em
 * `brand.ts`: `server/` é projeto independente e não deve alcançar arquivo
 * de fora dele. Trocando o modelo, troque nos dois lugares.
 *
 * Falha ALTO se faltar, como a marca: todo documento gerado depende disto
 * pra capa, então um arquivo ausente precisa quebrar a geração na hora, não
 * produzir uma capa incompleta em silêncio.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let cache: Buffer | undefined;

export function modeloAtaBuffer(): Buffer {
  if (cache !== undefined) return cache;

  const caminho = join(process.cwd(), 'lib', 'render', 'assets', 'example.pdf');
  try {
    cache = readFileSync(caminho);
  } catch (error) {
    throw new Error(
      `PDF de referência não encontrado em ${caminho}. Causa: ${(error as Error).message}`,
    );
  }
  return cache;
}
