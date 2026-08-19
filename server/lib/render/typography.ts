/**
 * Tokens tipográficos compartilhados por `html.ts` e `pdf.ts`.
 *
 * As duas saídas vêm do MESMO `documentData`, mas são desenhadas por motores
 * diferentes (CSS inline vs. `pdfkit`) — sem uma fonte única de números, um
 * ajuste de tamanho num arquivo silenciosamente para de bater com o outro.
 *
 * Os valores em pt vêm de `public/assets-docs/ata-de-reuniao/example.pdf`,
 * extraídos do arquivo (ver o comentário no topo de `html.ts`), não
 * estimados.
 */

export const TINTA = '#000000';
export const TINTA_FRACA = '#888888';

/** Escala tipográfica do modelo: título / seção / subtítulo / corpo / rodapé. */
export const TAMANHO_TITULO_PT = 44;
export const TAMANHO_SECAO_PT = 26.7;
export const TAMANHO_SUBTITULO_PT = 17.3;
export const TAMANHO_CORPO_PT = 14.7;
export const TAMANHO_RODAPE_PT = 10.7;
