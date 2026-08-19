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

let cacheBuffer: Buffer | undefined;
let cacheDataUri: string | undefined;

/** Lido uma vez: são ~23KB de PNG, e reler por documento seria I/O à toa. */
function lerMarca(): Buffer {
  if (cacheBuffer !== undefined) return cacheBuffer;

  const caminho = join(process.cwd(), 'lib', 'render', 'assets', 'citi-30-anos.png');
  try {
    cacheBuffer = readFileSync(caminho);
  } catch (error) {
    // Falha ALTO. Uma ata sem a marca sai parecendo documento de outra
    // instituição, e o defeito só apareceria com o arquivo já na mão do
    // cliente.
    throw new Error(
      `Marca do documento não encontrada em ${caminho}. Causa: ${(error as Error).message}`,
    );
  }
  return cacheBuffer;
}

/** Pro `<img src="data:...">` do HTML — autocontido, ver o porquê no topo. */
export function marcaDataUri(): string {
  cacheDataUri ??= `data:image/png;base64,${lerMarca().toString('base64')}`;
  return cacheDataUri;
}

/** Pro `doc.image(...)` do `pdfkit`, que consome Buffer de PNG direto — sem
 *  motivo pra decodificar de volta um base64 que a gente acabou de codificar. */
export function marcaBuffer(): Buffer {
  return lerMarca();
}

// ---------------------------------------------------------------------------
// Gráfico sangrado da capa
// ---------------------------------------------------------------------------

let cacheFundoCapa: Buffer | null | undefined;

/**
 * O gráfico ondulado azul/verde que sangra até a borda na capa do modelo
 * (`example.pdf`). Ao contrário da marca, esta é uma imagem OPCIONAL — o
 * repo ainda não tem o arquivo (`assets/fundo-capa.png`, cópia de
 * `public/assets-docs/ata-de-reuniao/fundo-capa.png`, mesmo par que
 * `citi-30-anos.png`/`image.png`).
 *
 * `null` em vez de lançar: diferente da marca, faltar isto não faz o
 * documento parecer de outra instituição — só uma capa mais simples. Não
 * vale derrubar a geração inteira por um gráfico decorativo ausente,
 * enquanto ninguém tiver exportado o arquivo.
 */
export function fundoCapaBuffer(): Buffer | null {
  if (cacheFundoCapa !== undefined) return cacheFundoCapa;

  const caminho = join(process.cwd(), 'lib', 'render', 'assets', 'fundo-capa.png');
  try {
    cacheFundoCapa = readFileSync(caminho);
  } catch {
    cacheFundoCapa = null;
  }
  return cacheFundoCapa;
}
