/**
 * Tokens tipográficos compartilhados por `html.ts` e `pdf.ts`.
 *
 * As duas saídas vêm do MESMO `documentData`, mas são desenhadas por motores
 * diferentes (CSS inline vs. `pdfkit`) — sem uma fonte única de números, um
 * ajuste de tamanho num arquivo silenciosamente para de bater com o outro.
 *
 * ── De onde vêm os números ────────────────────────────────────────────────
 *
 * De `public/assets-docs/ata-de-reuniao/example.pdf`, extraídas do CONTEÚDO
 * REAL do arquivo (stream de página decodificado — `Tf`/`Tj`/`cm`/`rg`), não
 * de leitura visual. Um detalhe que uma primeira leitura perdeu: o modelo
 * envolve cada bloco de texto num `cm` de escala `.75 0 0 .75` antes de
 * desenhar — o arquivo foi originalmente montado a 96dpi (pixel) e
 * convertido pra ponto (72dpi) nesse `cm`, e 72/96 = 0,75 exatamente. O
 * valor bruto do operador `Tf` é o tamanho em PIXEL do desenho original; o
 * tamanho REAL em pt, o que efetivamente aparece na página impressa, é esse
 * valor × 0,75. As constantes abaixo já são o valor final em pt — não
 * multiplique de novo.
 *
 * ── A hierarquia é só tamanho, peso e espaço ─────────────────────────────
 *
 * Não há cor decorativa, caixa, fundo, régua sob título nem ícone em lugar
 * nenhum do modelo: o documento inteiro é preto sobre branco, com um único
 * cinza no subtítulo da capa e outro na linha do rodapé. Se um dia parecer
 * que falta destaque em algum ponto, o recurso é tamanho/peso/espaçamento —
 * acrescentar cor ou moldura tira o documento do modelo institucional.
 */

/** Preto do texto — `0 0 0 rg` em absolutamente todo bloco do modelo,
 *  inclusive o rodapé. */
export const TINTA = '#000000';

/** Cinza da linha fina acima do rodapé, e SÓ dela: o modelo desenha esse
 *  traço com `.5333 .5333 .5333 RG` e escreve o texto do rodapé logo abaixo
 *  em preto. Uma leitura anterior tinha pintado o texto de cinza também. */
export const CINZA_LINHA = '#888888';

/** Cor do subtítulo da capa ("[Projeto] - [Data]") — o modelo usa
 *  `.6 .6 .6 rg`, um cinza próprio, mais claro que o da linha do rodapé.
 *  Dois cinzas diferentes, papéis diferentes. */
export const COR_SUBTITULO_CAPA = '#999999';

/** Título da capa — `/F8 44 Tf` (o negrito do modelo) × 0,75. A FONTE não
 *  vem do modelo, só os tamanhos: ver `./fonts.ts`. */
export const TAMANHO_TITULO_PT = 33;
/** Subtítulo da capa — `/F8 26.666666 Tf`, também negrito. */
export const TAMANHO_SUBTITULO_CAPA_PT = 20;
/** Título de seção ("Tópicos discutidos", "Decisões tomadas") — `17.333334`
 *  em negrito, alinhado à ESQUERDA. Só a identidade da capa é centralizada. */
export const TAMANHO_SECAO_PT = 13;
/** Corpo: parágrafo e linha rotulada ("DATA:", "TÓPICO:", "ANDAMENTO:",
 *  "PARTICIPANTES – CARGO:") — `16 Tf`, o rótulo em `/F8` (negrito) e o valor
 *  em `/F7` (regular). */
export const TAMANHO_CORPO_PT = 12;
/** Item de lista e texto auxiliar — `14.666667 Tf`, o tamanho mais frequente
 *  das páginas internas. É MENOR que o corpo, não igual; os dois já foram
 *  confundidos numa leitura anterior. */
export const TAMANHO_ITEM_PT = 11;
/** Rodapé institucional — `10.666667 Tf`. */
export const TAMANHO_RODAPE_PT = 8;

/**
 * Entrelinha: cada linha avança 1,3225× o tamanho da fonte.
 *
 * Não é chute nem "o que costuma ficar bom" — sai da distância entre blocos
 * consecutivos do modelo, resolvendo o sistema de dois blocos de tamanhos
 * diferentes: um parágrafo de 12pt com N linhas ocupa `N × 15,87pt` e um item
 * de 11pt ocupa `N × 14,55pt`, e 15,87/12 = 14,55/11 = 1,3225. É essa folga
 * que dá ao documento o ar arejado do original; apertar a entrelinha é o
 * jeito mais rápido de ele parar de parecer o mesmo modelo.
 */
export const ENTRELINHA = 1.3225;

/** Espaço entre blocos: parágrafo → parágrafo, e fim de lista → o que vier. */
export const GAP_PARAGRAFO_PT = 12;
/** Espaço menor: de um rótulo ou título de seção até o primeiro item da
 *  lista que ele abre — eles são um bloco só, e o modelo os aproxima. */
export const GAP_ANTES_DA_LISTA_PT = 6;

/** Recuo do marcador da lista a partir da margem, e da coluna de TEXTO do
 *  item — o modelo põe o marcador em x=90 e deixa a linha quebrada alinhada
 *  sob o texto, não sob o marcador (recuo pendente). */
export const LISTA_MARCADOR_RECUO_PT = 18;
export const LISTA_TEXTO_RECUO_PT = 32.5;
