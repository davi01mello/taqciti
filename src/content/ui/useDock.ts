/**
 * A cápsula flutuante dentro do Meet: posição, arraste e encaixe na borda.
 *
 * A lógica é a mesma que já funcionava no painel antigo em DOM puro, agora
 * como hook para o React usar. Nada aqui sabe o que o painel mostra — só onde
 * ele fica.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DockEdge, PanelPrefs } from '@/shared/types/domain';

/** Respiro entre a cápsula e a borda da janela. */
const MARGIN = 16;
/** Movimento a partir do qual um clique vira arraste. */
const DRAG_THRESHOLD_PX = 5;

const PANEL_MAX_WIDTH = 392;
const PANEL_MAX_HEIGHT = 588;

export interface DockGeometry {
  dock: { left: number; top: number };
  panel: {
    left: number;
    top: number;
    width: number;
    /**
     * TETO de altura, para as telas CURTAS.
     *
     * Com altura fixa, um passo curto do fluxo (uma pergunta e duas opções)
     * abria a mesma caixa de 588px de uma transcrição inteira, e sobravam
     * ~400px de vidro vazio embaixo da última opção. Essas telas crescem com o
     * que têm dentro e param aqui.
     */
    maxHeight: number;
    /**
     * Altura DEFINIDA, para as telas que ROLAM (transcrição ao vivo, resumo).
     *
     * Não é preciosismo: é o que faz a rolagem existir. Altura percentual
     * (`h-full`) contra um pai de altura indefinida resolve para `auto`, e aí
     * a caixa de rolagem cresce até o tamanho do texto inteiro — `overflow-y`
     * nunca engata, nada rola, e o `overflow-hidden` do painel corta o resto.
     * Era daí que vinha a transcrição congelada nas primeiras palavras, com os
     * controles empurrados para fora da tela.
     *
     * Mesmo valor que `maxHeight`; nomes separados porque o que muda é o
     * COMPROMISSO: uma tela que rola precisa de altura, uma tela curta não.
     */
    height: number;
    origin: string;
  };
}

interface UseDockOptions {
  prefs: PanelPrefs;
  onDockChange: (edge: DockEdge, offset: number) => void;
}

interface UseDockResult {
  dockRef: React.RefObject<HTMLButtonElement>;
  geometry: DockGeometry;
  dragging: boolean;
  /** Handlers para o elemento da cápsula. */
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  /** true quando o ponteiro só clicou (sem arrastar): o painel abre/fecha. */
  wasClick: () => boolean;
}

function computeGeometry(
  edge: DockEdge,
  offset: number,
  dockSize: { width: number; height: number },
): DockGeometry {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const dw = dockSize.width || 132;
  const dh = dockSize.height || 44;

  let dx: number;
  let dy: number;
  if (edge === 'bottom') {
    dy = vh - dh - MARGIN;
    dx = MARGIN + offset * Math.max(0, vw - dw - 2 * MARGIN);
  } else {
    dx = edge === 'left' ? MARGIN : vw - dw - MARGIN;
    dy = MARGIN + offset * Math.max(0, vh - dh - 2 * MARGIN);
  }

  const pw = Math.min(PANEL_MAX_WIDTH, vw - 2 * MARGIN);
  const ph = Math.min(PANEL_MAX_HEIGHT, vh - 2 * MARGIN);

  let px: number;
  let py: number;
  let origin: string;
  if (edge === 'bottom') {
    py = vh - ph - MARGIN;
    px = Math.min(Math.max(dx + dw / 2 - pw / 2, MARGIN), vw - pw - MARGIN);
    origin = `${dx + dw / 2 - px}px calc(100% - 20px)`;
  } else {
    px = edge === 'left' ? MARGIN : vw - pw - MARGIN;
    py = Math.min(Math.max(dy + dh / 2 - ph * 0.72, MARGIN), vh - ph - MARGIN);
    origin = `${edge === 'left' ? '22px' : 'calc(100% - 22px)'} ${dy + dh / 2 - py}px`;
  }

  return {
    dock: { left: Math.round(dx), top: Math.round(dy) },
    panel: {
      left: Math.round(px),
      top: Math.round(py),
      width: pw,
      maxHeight: ph,
      height: ph,
      origin,
    },
  };
}

export function useDock({ prefs, onDockChange }: UseDockOptions): UseDockResult {
  const dockRef = useRef<HTMLButtonElement>(null);
  const [geometry, setGeometry] = useState<DockGeometry>(() =>
    computeGeometry(prefs.edge, prefs.offset, { width: 132, height: 44 }),
  );
  const [dragging, setDragging] = useState(false);

  const drag = useRef({ startX: 0, startY: 0, left: 0, top: 0, moved: false });
  /** Posição durante o arraste (fora do estado: muda a cada frame). */
  const livePosition = useRef<{ left: number; top: number } | null>(null);

  const reposition = useCallback(() => {
    const rect = dockRef.current?.getBoundingClientRect();
    setGeometry(
      computeGeometry(prefs.edge, prefs.offset, {
        width: rect?.width ?? 132,
        height: rect?.height ?? 44,
      }),
    );
  }, [prefs.edge, prefs.offset]);

  useEffect(() => {
    reposition();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [reposition]);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - drag.current.startX;
    const dy = event.clientY - drag.current.startY;
    if (!drag.current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    if (!drag.current.moved) {
      drag.current.moved = true;
      setDragging(true);
    }
    const left = drag.current.left + dx;
    const top = drag.current.top + dy;
    livePosition.current = { left, top };
    setGeometry((current) => ({ ...current, dock: { left, top } }));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.current.moved) return;

    setDragging(false);
    const rect = event.currentTarget.getBoundingClientRect();
    const { edge, offset } = nearestEdge(rect);
    livePosition.current = null;
    onDockChange(edge, offset);
    setGeometry(computeGeometry(edge, offset, { width: rect.width, height: rect.height }));
  };

  return {
    dockRef,
    geometry,
    dragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    wasClick: () => !drag.current.moved,
  };
}

/** Solta a cápsula: ela gruda na borda mais próxima (esquerda, direita ou baixo). */
function nearestEdge(rect: DOMRect): { edge: DockEdge; offset: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const candidates: Array<{ edge: DockEdge; distance: number }> = [
    { edge: 'left', distance: cx },
    { edge: 'right', distance: vw - cx },
    { edge: 'bottom', distance: vh - cy },
  ];
  candidates.sort((a, b) => a.distance - b.distance);
  const edge = candidates[0]?.edge ?? 'right';

  const track =
    edge === 'bottom'
      ? Math.max(1, vw - rect.width - 2 * MARGIN)
      : Math.max(1, vh - rect.height - 2 * MARGIN);
  const raw = edge === 'bottom' ? (rect.left - MARGIN) / track : (rect.top - MARGIN) / track;

  return { edge, offset: Math.min(1, Math.max(0, raw)) };
}
