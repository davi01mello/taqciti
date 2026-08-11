/**
 * Onde a janela flutuante do TaqCITi fica, e como ela se move.
 *
 * ── O que mudou em relação ao encaixe em borda ─────────────────────────────
 *
 * Até aqui a cápsula grudava numa das três bordas (esquerda, direita, baixo) e
 * a única liberdade era deslizar ao longo dela. Era uma boa regra enquanto o
 * painel era um acessório do Meet: encostado na borda, ele não competia com o
 * vídeo. Agora que a janela é o produto, a borda vira uma jaula — não dá para
 * deixá-la no centro, nem no canto de cima, que é justamente o que se pede de
 * uma janela.
 *
 * Então a posição virou livre, e o que sobrou de disciplina é o CLAMP: a caixa
 * nunca sai da área visível. Sem isso, arrastar para baixo com a janela do
 * navegador grande e depois reduzi-la deixaria o painel inalcançável, com a
 * barra de título fora da tela — que é o jeito clássico de perder uma janela
 * flutuante para sempre.
 *
 * ── Por que a posição é fração, e do ESPAÇO LIVRE ──────────────────────────
 *
 * Guardar pixels quebra na primeira mudança de tamanho da janela. Guardar
 * fração do viewport quase resolve, mas ainda erra na borda: `x = 1` colocaria
 * o canto esquerdo da caixa no canto direito da tela, ou seja, a caixa inteira
 * para fora.
 *
 * Por isso a fração é do espaço DISPONÍVEL — viewport menos a caixa, menos as
 * margens. Aí `x = 1` significa "encostado à direita" em qualquer tela, e o
 * mesmo par de números vale para a cápsula e para o painel, que têm caixas de
 * tamanhos bem diferentes. É o que faz o painel abrir onde a cápsula estava,
 * em vez de saltar.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

/** Respiro entre a janela e a borda do viewport. */
const MARGIN = 16;
/** Movimento a partir do qual um clique vira arraste. */
const DRAG_THRESHOLD_PX = 5;

interface Box {
  width: number;
  height: number;
}

interface Placement {
  left: number;
  top: number;
}

export interface FloatingGeometry {
  capsule: Placement;
  panel: Placement & Box & { origin: string };
}

interface UseFloatingOptions {
  /** Canto superior esquerdo, fração 0..1 do espaço disponível. */
  x: number;
  y: number;
  /**
   * Tamanho pedido para o painel; o hook grampeia ao que cabe na tela.
   *
   * Precisa ser ESTÁVEL entre renders (um `useMemo` do lado de quem chama):
   * este objeto entra nas dependências do reposicionamento, e um literal novo a
   * cada render recalcularia a geometria em laço.
   */
  panel: Box;
  onMove: (x: number, y: number) => void;
}

export interface UseFloatingResult {
  capsuleRef: React.RefObject<HTMLElement>;
  geometry: FloatingGeometry;
  dragging: boolean;
  /**
   * Espalhe num elemento para torná-lo alça de arraste. Serve tanto na cápsula
   * quanto no cabeçalho do painel — o que a alça move é a JANELA, não ela
   * mesma, então o mesmo conjunto vale para os dois.
   */
  dragHandlers: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  };
  /** true quando o ponteiro só clicou, sem arrastar: o clique vale. */
  wasClick: () => boolean;
}

/** Onde uma caixa deste tamanho cai, dada a fração guardada. */
function place(fx: number, fy: number, box: Box, viewport: Box): Placement {
  const freeX = Math.max(0, viewport.width - box.width - 2 * MARGIN);
  const freeY = Math.max(0, viewport.height - box.height - 2 * MARGIN);
  return {
    left: Math.round(MARGIN + fx * freeX),
    top: Math.round(MARGIN + fy * freeY),
  };
}

/** O caminho inverso: de pixels de volta para a fração que os reproduz. */
function toFraction(left: number, top: number, box: Box, viewport: Box) {
  const freeX = Math.max(1, viewport.width - box.width - 2 * MARGIN);
  const freeY = Math.max(1, viewport.height - box.height - 2 * MARGIN);
  return {
    x: Math.min(1, Math.max(0, (left - MARGIN) / freeX)),
    y: Math.min(1, Math.max(0, (top - MARGIN) / freeY)),
  };
}

function viewportSize(): Box {
  return { width: window.innerWidth, height: window.innerHeight };
}

function computeGeometry(
  fx: number,
  fy: number,
  wanted: Box,
  capsuleBox: Box,
  viewport: Box,
): FloatingGeometry {
  // O painel nunca é maior do que a tela: um `tall` de 780px numa janela de
  // 600px de altura sairia pela borda de baixo levando os controles junto.
  const panelBox: Box = {
    width: Math.min(wanted.width, viewport.width - 2 * MARGIN),
    height: Math.min(wanted.height, viewport.height - 2 * MARGIN),
  };

  const capsule = place(fx, fy, capsuleBox, viewport);
  const panel = place(fx, fy, panelBox, viewport);

  /*
   * A animação de abrir/fechar cresce a partir da cápsula, e é isso que liga
   * visualmente as duas caixas. Como elas têm tamanhos diferentes, a mesma
   * fração as coloca em cantos diferentes — então a origem é calculada, não
   * fixada: é o centro da cápsula, expresso em coordenadas do painel.
   */
  const originX = capsule.left + capsuleBox.width / 2 - panel.left;
  const originY = capsule.top + capsuleBox.height / 2 - panel.top;

  return {
    capsule,
    panel: { ...panel, ...panelBox, origin: `${Math.round(originX)}px ${Math.round(originY)}px` },
  };
}

export function useFloating({ x, y, panel, onMove }: UseFloatingOptions): UseFloatingResult {
  const capsuleRef = useRef<HTMLElement>(null);
  /** Medida real da cápsula; o palpite inicial serve só ao primeiro quadro. */
  const capsuleBox = useRef<Box>({ width: 132, height: 44 });

  const [geometry, setGeometry] = useState<FloatingGeometry>(() =>
    computeGeometry(x, y, panel, capsuleBox.current, viewportSize()),
  );
  const [dragging, setDragging] = useState(false);

  const drag = useRef({ startX: 0, startY: 0, left: 0, top: 0, box: panel, moved: false });

  const reposition = useCallback(() => {
    const rect = capsuleRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0) capsuleBox.current = { width: rect.width, height: rect.height };
    setGeometry(computeGeometry(x, y, panel, capsuleBox.current, viewportSize()));
  }, [x, y, panel]);

  useEffect(() => {
    reposition();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [reposition]);

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      // Qual caixa está sendo arrastada decide a conversão de volta para
      // fração: a mesma posição em pixels dá frações diferentes para a cápsula
      // e para o painel, porque o espaço livre depende do tamanho da caixa.
      box: { width: rect.width, height: rect.height },
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - drag.current.startX;
    const dy = event.clientY - drag.current.startY;
    if (!drag.current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    if (!drag.current.moved) {
      drag.current.moved = true;
      setDragging(true);
    }

    const viewport = viewportSize();
    const box = drag.current.box;
    const left = Math.min(
      Math.max(drag.current.left + dx, MARGIN),
      Math.max(MARGIN, viewport.width - box.width - MARGIN),
    );
    const top = Math.min(
      Math.max(drag.current.top + dy, MARGIN),
      Math.max(MARGIN, viewport.height - box.height - MARGIN),
    );

    /*
     * A fração é a fonte da verdade, inclusive durante o gesto: converter a
     * posição em pixels de volta para fração e recompor as DUAS caixas a
     * partir dela é o que mantém a cápsula e o painel coerentes enquanto se
     * arrasta um deles. Mover só a caixa arrastada seria mais direto e deixaria
     * a outra para trás — visível no instante em que se abre ou recolhe o
     * painel logo depois de soltar.
     */
    const fraction = toFraction(left, top, box, viewport);
    setGeometry(computeGeometry(fraction.x, fraction.y, panel, capsuleBox.current, viewport));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.current.moved) return;

    setDragging(false);
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = toFraction(rect.left, rect.top, drag.current.box, viewportSize());
    onMove(fraction.x, fraction.y);
  };

  return {
    capsuleRef,
    geometry,
    dragging,
    dragHandlers: { onPointerDown, onPointerMove, onPointerUp },
    wasClick: () => !drag.current.moved,
  };
}
