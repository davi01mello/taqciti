/**
 * Um menu aberto fecha como a pessoa espera: Escape fecha e devolve o foco ao
 * botão que o abriu (sem isso o foco cai no `body` e a próxima tabulação
 * recomeça do topo), e um clique fora fecha.
 *
 * É o mesmo comportamento do `ConversasMenu`, para os menus pequenos de "Mais
 * ações" — que antes só fechavam clicando de novo no próprio botão.
 */
import { useEffect, type RefObject } from 'react';

export function useFecharAoSair(
  aberto: boolean,
  fechar: () => void,
  area: RefObject<HTMLElement | null>,
  botao: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      fechar();
      botao.current?.focus();
    };
    const aoApontar = (e: PointerEvent) => {
      if (area.current && e.composedPath().includes(area.current)) return;
      fechar();
    };
    document.addEventListener('keydown', aoTeclar);
    document.addEventListener('pointerdown', aoApontar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.removeEventListener('pointerdown', aoApontar);
    };
  }, [aberto, fechar, area, botao]);
}
