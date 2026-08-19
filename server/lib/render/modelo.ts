/**
 * O gráfico sangrado da capa — a onda verde/azul do modelo institucional —
 * como Buffer de JPEG.
 *
 * ── Por que o arquivo, e não mais o `example.pdf` inteiro ────────────────
 *
 * A versão anterior carregava `example.pdf` em runtime, embutia a PÁGINA
 * inteira do modelo como fundo da capa e cobria a metade de cima com um
 * retângulo branco. Funcionava visualmente, mas arrastava dois defeitos:
 *
 *  1. o texto placeholder do modelo ("Ata de reunião", "[Nome do Projeto] -
 *     [Data da Ata]") continuava DENTRO do PDF gerado, invisível sob o
 *     retângulo mas presente pra qualquer cópia/colagem ou extração de texto
 *     — quem selecionasse a capa levava junto o placeholder;
 *  2. 214KB de PDF de referência entravam no bundle do servidor pra render
 *     usar só uma imagem de 90KB.
 *
 * `assets/capa-grafico.jpg` é o XObject `/X9` da primeira página do modelo,
 * extraído direto do stream `DCTDecode` (portanto os MESMOS pixels, sem
 * recompressão, sem redesenho). Fonte:
 * `public/assets-docs/ata-de-reuniao/example.pdf`.
 *
 * ── Ele é a capa INTEIRA achatada, e por isso precisa da máscara ─────────
 *
 * `/X9` não é só a onda: é um rasterizado da capa completa, com a marca e o
 * título "Ata de reunião" queimados nos pixels. O modelo resolve isso
 * RECORTANDO a imagem na faixa de baixo (`-1 470.45288 598 372.54712 re`) e
 * desenhando por cima a marca e o texto de verdade, vetoriais. `pdf.ts`
 * reproduz o mesmo recorte — ver `CAPA_GRAFICO_*` lá. Desenhar esta imagem
 * sem o recorte faria aparecer um segundo título, em pixel, embaixo do
 * nosso.
 *
 * Falha ALTO se faltar, como a marca: toda capa depende disto, então um
 * arquivo ausente precisa quebrar a geração na hora, não produzir uma capa
 * incompleta em silêncio.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let cache: Buffer | undefined;

export function capaGraficoBuffer(): Buffer {
  if (cache !== undefined) return cache;

  const caminho = join(process.cwd(), 'lib', 'render', 'assets', 'capa-grafico.jpg');
  try {
    cache = readFileSync(caminho);
  } catch (error) {
    throw new Error(
      `Gráfico da capa não encontrado em ${caminho}. Causa: ${(error as Error).message}`,
    );
  }
  return cache;
}
