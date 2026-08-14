/**
 * A marca CITi como `data:` URI, para o documento ser AUTOCONTIDO.
 *
 * `assets/citi-30-anos.png` é CÓPIA de
 * `public/assets-docs/ata-de-reuniao/image.png`, na raiz do repo. A cópia é
 * deliberada: `server/` é um projeto independente e não deve alcançar
 * arquivos de fora dele. Trocando a marca, troque nos dois lugares — as duas
 * cópias divergindo produziriam uma ata com marca diferente da do modelo, e
 * ninguém notaria até um cliente comparar.
 *
 * Um `<img src="https://...">` faria a ata depender de o servidor estar no ar
 * no momento em que alguém abre o arquivo — e o arquivo é justamente o que
 * sobrevive ao servidor. Pior: a conversão do Drive buscaria a imagem no
 * momento do upload, e uma falha ali produziria uma ata sem marca, em
 * silêncio.
 *
 * Deliberadamente `fs` e não `import`: transformar `.png` em módulo exigiria
 * plugin de bundler, o que amarraria o documento à ferramenta de build. É a
 * mesma decisão, e a mesma ressalva, dos prompts em `lib/prompts/index.ts` —
 * uma build `output: 'standalone'` precisa copiar `lib/render/assets/`
 * explicitamente.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Dimensões reais do arquivo, para a proporção não depender de palpite. */
export const MARCA_LARGURA_PX = 420;
export const MARCA_ALTURA_PX = 120;

/**
 * Largura de exibição, em pontos.
 *
 * 160pt é a medida que o modelo usa (`example.pdf` desenha a marca em
 * 160,5 × 36,75pt). Manter o número do modelo é o que faz o documento gerado
 * e o modelo impresso parecerem o mesmo produto.
 */
export const MARCA_LARGURA_PT = 160;
export const MARCA_ALTURA_PT = Math.round((MARCA_LARGURA_PT * MARCA_ALTURA_PX) / MARCA_LARGURA_PX);

let cache: string | undefined;

/** Lido uma vez: são ~23KB de base64, e reler por documento seria I/O à toa. */
export function marcaDataUri(): string {
  if (cache !== undefined) return cache;

  const caminho = join(process.cwd(), 'lib', 'render', 'assets', 'citi-30-anos.png');
  try {
    cache = `data:image/png;base64,${readFileSync(caminho).toString('base64')}`;
  } catch (error) {
    // Falha ALTO. Uma ata sem a marca sai parecendo documento de outra
    // instituição, e o defeito só apareceria com o arquivo já na mão do
    // cliente.
    throw new Error(
      `Marca do documento não encontrada em ${caminho}. Causa: ${(error as Error).message}`,
    );
  }
  return cache;
}
