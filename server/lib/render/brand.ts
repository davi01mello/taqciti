/**
 * A marca CITi como Buffer e como `data:` URI, para o documento ser
 * AUTOCONTIDO.
 *
 * ── É a marca PRETA, e ela foi EXTRAÍDA do modelo ────────────────────────
 *
 * `assets/citi-preto.png` não é uma versão da marca escolhida a gosto: são os
 * pixels do XObject `/X4` de `public/assets-docs/ata-de-reuniao/example.pdf`,
 * o documento institucional que este render reproduz — o mesmo `/X4` aparece
 * na capa e no cabeçalho das três páginas do modelo. Extraído do stream
 * (`FlateDecode` RGB 2500×593 + o `SMask` de alfa ao lado), recomposto em PNG
 * RGBA e reamostrado para 1000px de largura, que já é ~5× a resolução em que
 * ele é impresso.
 *
 * A versão VERDE ("citi 30 anos") que ficava aqui foi REMOVIDA. Ela era outra
 * marca — comemorativa, colorida, com outro texto ao lado —, e usá-la fazia o
 * documento gerado parecer de outra campanha institucional. Não converta esta
 * para verde, não a tinja, não a recolora por tema: o documento é preto,
 * branco e cinza, e a marca é a âncora disso.
 *
 * ── Por que uma cópia dentro de `server/` ────────────────────────────────
 *
 * `server/` é projeto independente e não deve alcançar arquivo de fora dele.
 * Diferente da cópia manual que existia antes, esta não pode divergir em
 * silêncio: é DERIVADA de `example.pdf` por um procedimento reprodutível
 * (descrito acima), então trocando o modelo basta reextrair.
 *
 * Um `<img src="https://...">` faria a ata depender de o servidor estar no ar
 * no momento em que alguém abre o arquivo — e o arquivo é justamente o que
 * sobrevive ao servidor.
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
export const MARCA_LARGURA_PX = 1000;
export const MARCA_ALTURA_PX = 237;

/** Toda medida de exibição deriva daqui — a marca NUNCA é distorcida. */
const PROPORCAO = MARCA_ALTURA_PX / MARCA_LARGURA_PX;

/**
 * Marca da CAPA, em pontos.
 *
 * 160,5pt é a largura que o modelo usa (`example.pdf`, página 1: o clip
 * `231 21.596458 160.5 36.75 re` em volta do `/X4 Do`). A ALTURA sai da
 * proporção do arquivo, não dos 36,75pt do modelo: o modelo estica a arte
 * em ~3%, e reproduzir o esticamento seria copiar um defeito.
 */
export const MARCA_CAPA_LARGURA_PT = 160.5;
export const MARCA_CAPA_ALTURA_PT = MARCA_CAPA_LARGURA_PT * PROPORCAO;

/**
 * Distância do topo da página até o topo da marca da capa — 21,6pt, do mesmo
 * clip. Fica ACIMA da margem de 1in: a marca mora na faixa de cabeçalho, não
 * no corpo do texto.
 */
export const MARCA_CAPA_TOPO_PT = 21.596458;

/**
 * Marca do CABEÇALHO das páginas internas — menor, e é o mesmo desenho: o
 * modelo embute o mesmo `/X4` em 90,75pt de largura, no clip
 * `253.5 12.5964355 90.75 21 re` das páginas 2 e 3. Altura pela proporção,
 * pelo mesmo motivo da capa.
 */
export const MARCA_CABECALHO_LARGURA_PT = 90.75;
export const MARCA_CABECALHO_ALTURA_PT = MARCA_CABECALHO_LARGURA_PT * PROPORCAO;
/** Topo da página até o topo da marca do cabeçalho, do mesmo clip. */
export const MARCA_CABECALHO_TOPO_PT = 12.5964355;

let cacheBuffer: Buffer | undefined;
let cacheDataUri: string | undefined;

/** Lido uma vez: são ~17KB de PNG, e reler por documento seria I/O à toa. */
function lerMarca(): Buffer {
  if (cacheBuffer !== undefined) return cacheBuffer;

  const caminho = join(process.cwd(), 'lib', 'render', 'assets', 'citi-preto.png');
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
