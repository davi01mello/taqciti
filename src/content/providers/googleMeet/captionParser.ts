/**
 * Parser das legendas do Meet — o ponto onde a identificação de falante vive
 * ou morre.
 *
 * O Meet troca as classes ofuscadas do DOM sem aviso. Quando isso acontece, um
 * parser preso a `.nMcdL/.KcIKyf` para de casar e a captura desaba num
 * fallback. O fallback antigo devolvia a região INTEIRA como uma linha só: um
 * segmento gigante que se reescrevia a cada mutação e encolhia quando o Meet
 * rolava a janela. Era a pior falha possível, porque parecia funcionar.
 *
 * Estratégia em camadas, da mais precisa à mais defensiva:
 *   1. Shapes conhecidos de classe (rápido, exato quando o Meet não mudou).
 *   2. Parser ESTRUTURAL: cada linha de legenda tem um avatar; o nome fica
 *      colado nele e o texto vem depois. Sobrevive à troca de classe porque o
 *      avatar é parte da experiência, não um detalhe de implementação.
 *   3. Degradado: a região é fatiada nos blocos visuais que ela já tem, cada
 *      fatia vira uma linha sem falante, e o resultado é MARCADO como
 *      degradado para a UI poder avisar em vez de fingir que está tudo bem.
 */
import { CAPTION_LINE_SHAPES } from './selectors';

export interface ParsedLine {
  /** Nó estável do DOM — vira o captionId (WeakMap) no provider. */
  node: Element;
  /** Nome cru do falante (ainda não normalizado); `null` quando desconhecido. */
  speaker: string | null;
  /** Texto cru da fala (o provider sanitiza). */
  text: string;
}

/** De onde veio a leitura — a UI usa para avisar quando a captura degrada. */
export type ParseSource = 'shapes' | 'structural' | 'degraded' | 'empty';

export interface ParsedRegion {
  lines: ParsedLine[];
  source: ParseSource;
}

const DIACRITICS = /[\u0300-\u036f]/g;
const ICON_LIGATURE = /(?:arrow_downward|expand_more|keyboard_arrow_down|unfold_more)/gi;

/**
 * Rótulos acessíveis do controle "voltar ao vivo". A comparação é exata
 * depois de normalizar caixa, acento, pontuação e espaços: uma fala que apenas
 * CONTÉM estas palavras não é descartada.
 */
const UI_CHROME_LABELS = [
  'arrow downward',
  'expand more',
  'keyboard arrow down',
  'unfold more',
  'ir para o final',
  'ir para a parte inferior',
  'ir até o fim',
  'ir até o final',
  'pular para o final',
  'jump to bottom',
  'jump to latest',
  'jump to end',
  'go to bottom',
  'go to latest',
  'ir al final',
  'saltar al final',
  'más reciente',
  'aller à la fin',
  'accéder à la fin',
] as const;

const INTERACTIVE_SELECTOR = [
  'button',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="scrollbar"]',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[aria-hidden="true"]',
].join(',');

function normalizeUiText(text: string): string {
  return text
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UI_CHROME_NORMALIZED = new Set(UI_CHROME_LABELS.map(normalizeUiText));

/** Um nó de texto que é SÓ chrome do Meet (some da transcrição). */
export function isUiChromeText(text: string): boolean {
  return UI_CHROME_NORMALIZED.has(normalizeUiText(text));
}

/**
 * Fallback para layouts que concatenam a ligature do ícone ao rótulo. Só a
 * ligature isolada é retirada; frases de interface só somem quando o restante
 * INTEIRO é uma delas.
 */
export function stripUiChrome(raw: string): string {
  const withoutLigatures = raw.replace(ICON_LIGATURE, ' ').replace(/\s+/g, ' ').trim();
  return isUiChromeText(withoutLigatures) ? '' : withoutLigatures;
}

function belongsToInteractiveControl(node: Node, root: Element): boolean {
  const parent = node.parentElement;
  if (!parent) return false;
  const control = parent.closest(INTERACTIVE_SELECTOR);
  return control !== null && root.contains(control);
}

/** Textos visíveis de fala, sem filhos interativos ou chrome exato. */
function textChunks(root: Element | null): string[] {
  if (!root || root.matches(INTERACTIVE_SELECTOR)) return [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chunks: string[] = [];
  let node = walker.nextNode();
  while (node) {
    const value = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (
      value.length > 0 &&
      !belongsToInteractiveControl(node, root) &&
      !isUiChromeText(value)
    ) {
      chunks.push(value);
    }
    node = walker.nextNode();
  }
  return chunks;
}

function textContent(node: Element | null): string {
  return stripUiChrome(textChunks(node).join(' '));
}

function hasSpeaker(line: ParsedLine): boolean {
  return (line.speaker ?? '').trim().length > 0;
}

function hasText(line: ParsedLine): boolean {
  return line.text.trim().length > 0;
}

/** Quando nome e fala vêm no mesmo nó, corta o prefixo do nome do começo. */
function textWithoutSpeaker(line: Element, speaker: string): string {
  const chunks = textChunks(line);
  if (speaker && chunks[0]?.trim() === speaker.trim()) chunks.shift();
  return stripUiChrome(chunks.join(' '));
}

/** Camada 1: shapes de classe conhecidos. */
function parseByShapes(region: Element): ParsedLine[] {
  for (const shape of CAPTION_LINE_SHAPES) {
    const lines = region.querySelectorAll(shape.line);
    if (lines.length === 0) continue;
    const out: ParsedLine[] = [];
    for (const line of lines) {
      const speaker = textContent(line.querySelector(shape.speaker)) || null;
      const textNode = line.querySelector(shape.text);
      const text = textNode
        ? textContent(textNode)
        : textWithoutSpeaker(line, speaker ?? '').trim();
      out.push({ node: line, speaker, text });
    }
    return out;
  }
  return [];
}

/**
 * Os "avatares" de uma região de legenda. O Meet usa <img> quando a pessoa tem
 * foto e um nó com background-image (ou o próprio tile marcado) quando não tem
 * — exigir <img> derrubava a camada estrutural em reunião sem foto de perfil.
 */
function avatarsIn(region: Element): Element[] {
  const found = new Set<Element>();
  for (const img of region.querySelectorAll('img')) found.add(img);
  for (const marked of region.querySelectorAll('[data-participant-id], [data-self-name]')) {
    found.add(marked);
  }
  // Nós redondos com imagem de fundo: o avatar sem foto do Meet.
  for (const node of region.querySelectorAll('div, span')) {
    if (found.has(node)) continue;
    const style = (node as HTMLElement).style;
    if (style?.backgroundImage && style.backgroundImage !== 'none') found.add(node);
  }
  return [...found];
}

/**
 * Sobe do avatar até a "linha" da legenda: o ancestral cujo PAI já contém mais
 * de um avatar (o pai é a lista; o filho é a linha de um falante). Com um só
 * falante, sobe até o filho direto da região.
 */
function rowFor(node: Element, region: Element, avatarCount: number): Element | null {
  let current: Element = node;
  while (current.parentElement && current.parentElement !== region) {
    const parent = current.parentElement;
    if (avatarsIn(parent).length > 1 && avatarCount > 1) return current;
    current = parent;
  }
  return current === region ? null : current;
}

/** Dentro de uma linha, o 1º pedaço de texto é o nome; o resto é a fala. */
function splitNameAndText(row: Element): ParsedLine | null {
  const chunks = textChunks(row);
  if (chunks.length === 0) return null;
  if (chunks.length === 1) {
    // Só um pedaço: ou é o nome (ninguém falou ainda) ou é fala sem nome. Sem
    // como separar — devolve como fala sem falante; o provider ignora se vazio.
    return { node: row, speaker: null, text: chunks[0]! };
  }
  return { node: row, speaker: chunks[0]!, text: chunks.slice(1).join(' ') };
}

/** Camada 2: estrutural, ancorada nos avatares. */
function parseStructural(region: Element): ParsedLine[] {
  const avatars = avatarsIn(region);
  const out: ParsedLine[] = [];
  const seen = new Set<Element>();
  for (const avatar of avatars) {
    const row = rowFor(avatar, region, avatars.length);
    if (!row || seen.has(row)) continue;
    seen.add(row);
    const parsed = splitNameAndText(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * Camada 3: nem shape nem avatar casaram. Em vez de devolver a região inteira
 * como UMA fala (que sobrescreveria a si mesma para sempre), fatia pelos
 * blocos que o DOM já tem: cada filho com texto vira uma linha independente,
 * com nó próprio e, portanto, captionId próprio.
 */
function parseDegraded(region: Element): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const child of region.children) {
    const text = textContent(child);
    if (text.length > 0) out.push({ node: child, speaker: null, text });
  }
  if (out.length > 0) return out;

  const blob = textContent(region);
  return blob.length > 0 ? [{ node: region, speaker: null, text: blob }] : [];
}

/**
 * Devolve uma linha por fala visível, com o falante correto sempre que
 * possível, e de que camada veio a leitura. Prefere o resultado que tem
 * falante; só cai no texto sem nome como último recurso.
 */
export function parseCaptionRegion(region: Element): ParsedRegion {
  const byShapes = parseByShapes(region);
  if (byShapes.some(hasSpeaker) && byShapes.some(hasText)) {
    return { lines: byShapes, source: 'shapes' };
  }

  const structural = parseStructural(region);
  if (structural.some(hasSpeaker) && structural.some(hasText)) {
    return { lines: structural, source: 'structural' };
  }

  // Nenhuma camada trouxe falante — fica com a que ao menos tem fala. Sem nome
  // não é degradação da captura: numa reunião de uma pessoa só o Meet às vezes
  // simplesmente não rotula.
  if (byShapes.some(hasText)) return { lines: byShapes, source: 'shapes' };
  if (structural.some(hasText)) return { lines: structural, source: 'structural' };

  const degraded = parseDegraded(region);
  return {
    lines: degraded,
    source: degraded.length > 0 ? 'degraded' : 'empty',
  };
}
