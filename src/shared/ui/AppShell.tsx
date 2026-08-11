/**
 * O contrato de layout das telas da TaqCITi — popup, janela principal e
 * painel do Meet montam a geometria AQUI, e não cada uma do seu jeito.
 *
 * ── Por que isto existe ────────────────────────────────────────────────────
 *
 * O painel dentro do Meet abria com `max-height` e nenhuma altura. Toda a
 * cadeia abaixo era `flex-1 min-h-0`, e a caixa de rolagem da transcrição
 * pedia `height: 100%`. Altura percentual contra pai de altura INDEFINIDA
 * resolve para `auto`: a caixa crescia até o tamanho da transcrição inteira,
 * `overflow-y` nunca engatava, o `overflow-hidden` do painel cortava o resto e
 * os controles eram empurrados para fora da tela.
 *
 * A regra que evita isso é curta e vale para as quatro superfícies:
 *
 *   1. o shell tem altura DEFINIDA (ou um teto definido, no caso do popup);
 *   2. as linhas são `auto minmax(0, 1fr) auto` — `minmax(0, …)` é o que
 *      impede a faixa do meio de crescer com o conteúdo, sem depender de cada
 *      nível intermediário lembrar do `min-h-0`;
 *   3. exatamente UMA região rola, e é a do meio.
 *
 * ── O piso, e por que ele não pode ser `min-height` no <body> ──────────────
 *
 * A janela é redimensionável, e abaixo de uma certa altura o conteúdo não
 * cabe de jeito nenhum. O `min-height: 480px` morava no <body>, que também
 * tinha `overflow: hidden` — a combinação RECORTAVA: encolher a janela abaixo
 * do piso escondia a faixa de baixo (a barra de controles inteira) sem
 * nenhuma forma de alcançá-la, porque o documento não podia rolar.
 *
 * Agora o piso mora aqui e o documento é a válvula de escape: acima do piso o
 * shell tem exatamente a altura da janela e só a faixa do meio rola; abaixo do
 * piso o shell fica maior que a janela e quem rola é o documento. Em nenhum
 * momento existem duas barras ao mesmo tempo, e nunca há área inalcançável.
 */
import type { CSSProperties, ReactNode } from 'react';

/** Abaixo disto o conteúdo não cabe; o documento passa a rolar. */
const VIEWPORT_MIN_HEIGHT = 460;

interface AppShellProps {
  /** Faixa fixa do topo: marca, título, status. */
  header?: ReactNode;
  /** A ÚNICA região que rola. */
  children: ReactNode;
  /** Faixa fixa do rodapé: controles, ação principal. */
  footer?: ReactNode;
  /**
   * Altura do shell:
   * - `'viewport'` — ocupa a janela (janela principal). Ganha o piso acima.
   * - `'auto'` — cresce com o conteúdo (popup, que é dimensionado pelo Chrome
   *   a partir da altura da página). O TETO vem por `className`, não daqui:
   *   um `max-height` inline venceria a classe do consumidor, e um teto
   *   percentual contra um pai de altura automática resolve para `none`.
   * - número em pixels — o painel flutuante no Meet, que recebe a altura já
   *   calculada pelo dock.
   */
  height?: 'viewport' | 'auto' | number;
  className?: string;
}

export function AppShell({
  header,
  children,
  footer,
  height = 'viewport',
  className = '',
}: AppShellProps) {
  const style: CSSProperties = {
    display: 'grid',
    gridTemplateRows: 'auto minmax(0, 1fr) auto',
  };

  if (height === 'viewport') {
    style.height = '100%';
    style.minHeight = VIEWPORT_MIN_HEIGHT;
  } else if (height === 'auto') {
    style.height = 'auto';
  } else {
    style.height = height;
  }

  return (
    <div style={style} className={`overflow-hidden ${className}`}>
      {/* As faixas fixas nunca encolhem: era daí que vinha o rodapé de
          controles somindo quando a transcrição crescia. */}
      <div className="min-h-0 shrink-0">{header}</div>
      <div className="flex min-h-0 flex-col">{children}</div>
      <div className="min-h-0 shrink-0">{footer}</div>
    </div>
  );
}
