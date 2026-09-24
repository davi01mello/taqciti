/**
 * Há espaço para duas colunas?
 *
 * ── Por que uma consulta em JS, e não só um breakpoint no CSS ────────────
 *
 * Porque a diferença não é só visual. Em largura confortável as duas colunas
 * existem ao mesmo tempo e as duas são alcançáveis pelo teclado; em largura
 * estreita elas se alternam, e a que está escondida precisa sair do caminho do
 * Tab — o que exige `inert`, que é uma propriedade do DOM, não uma regra de
 * estilo. Um `@media` sozinho esconderia a coluna e deixaria o foco entrar
 * nela às cegas.
 *
 * O limiar é o mesmo do CSS de propósito: duas fontes com números diferentes
 * produziriam um intervalo em que a tela mostra uma coisa e o teclado acredita
 * noutra.
 */
import { useEffect, useState } from 'react';

/** Abaixo disto, a transcrição e as notas não cabem lado a lado sem sufocar. */
export const LARGURA_DE_DUAS_COLUNAS = 900;

export function useCabemDuasColunas(): boolean {
  const [cabem, setCabem] = useState(
    () => window.innerWidth >= LARGURA_DE_DUAS_COLUNAS,
  );

  useEffect(() => {
    const mq = matchMedia(`(min-width: ${LARGURA_DE_DUAS_COLUNAS}px)`);
    const aoMudar = () => setCabem(mq.matches);
    aoMudar();
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);

  return cabem;
}
