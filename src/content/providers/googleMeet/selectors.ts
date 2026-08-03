/**
 * TODOS os seletores do DOM do Google Meet vivem aqui — este é o ponto frágil
 * da integração e o primeiro lugar a olhar quando o Meet mudar o layout.
 * Cada grupo é uma lista ordenada de fallbacks: o primeiro que casar, vence.
 */

/** Botão de sair — presença dele define "estou dentro de uma chamada". */
export const LEAVE_CALL_SELECTORS = [
  'button[aria-label*="leave call" i]',
  'button[aria-label*="sair da chamada" i]',
  'button[aria-label*="end call" i]',
  'button[aria-label*="encerrar chamada" i]',
  '[jsname="CQylAd"]',
];

/** Botão de ativar/desativar legendas. */
export const CAPTIONS_TOGGLE_SELECTORS = [
  'button[aria-label*="caption" i]',
  'button[aria-label*="legenda" i]',
  '[jsname="r8qRAd"]',
];

/** Região onde as legendas são renderizadas (só existe com legendas ligadas). */
export const CAPTION_REGION_SELECTORS = [
  'div[role="region"][aria-label*="caption" i]',
  'div[role="region"][aria-label*="legenda" i]',
  '.a4cQT',
];

/** Estruturas conhecidas de linha de legenda: { linha, nome do falante, texto }. */
export const CAPTION_LINE_SHAPES = [
  { line: '.nMcdL', speaker: '.KcIKyf', text: '.bh44bd' },
  { line: '.TBMuR', speaker: '.zs7s8d', text: '[jsname="tgaKEf"]' },
] as const;

/** Tiles de vídeo com participantes (nome quando o Meet expõe). */
export const PARTICIPANT_TILE_SELECTOR =
  '[data-participant-id], [role="listitem"][data-user-id], [role="listitem"][data-participant-name]';
export const PARTICIPANT_NAME_SELECTORS = [
  '[data-self-name]',
  '[data-participant-name]',
  '.zWGUib',
  '.XEazBc',
  '.notranslate',
];

/**
 * A PRÓPRIA pessoa: o Meet marca o tile/nó dela com `data-self-name`. O valor do
 * atributo (ou o texto do nó) é o nome real — a chave para trocar "Você" pelo
 * nome e para saber quem é o anfitrião ("Eu"). Lista de fallbacks: o 1º vence.
 */
export const SELF_NAME_SELECTORS = ['[data-self-name]', '[data-self-name] *'];

/** URL de reunião: meet.google.com/abc-defg-hij */
export const MEETING_CODE_PATTERN = /^\/([a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3})$/i;

export function queryFirst(
  root: ParentNode,
  selectors: readonly string[],
): Element | null {
  for (const selector of selectors) {
    const found = root.querySelector(selector);
    if (found) return found;
  }
  return null;
}
