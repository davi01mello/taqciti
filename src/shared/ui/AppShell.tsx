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
 * os controles eram empurrados para fora da tela. A transcrição ficava
 * congelada nas primeiras palavras porque `scrollTop` só podia ser 0.
 *
 * O side panel não tinha o problema por um detalhe: declarava `h-[100dvh]`.
 * Mesma transcrição, mesmo componente, uma tela funcionando e a outra não.
 *
 * A regra que evita isso é curta e vale para as três telas:
 *
 *   1. o shell tem altura DEFINIDA;
 *   2. as linhas são `auto minmax(0, 1fr) auto` — `minmax(0, …)` é o que
 *      impede a faixa do meio de crescer com o conteúdo, sem depender de cada
 *      nível intermediário lembrar do `min-h-0`;
 *   3. exatamente UMA região rola, e é a do meio.
 *
 * Enquanto a geometria morar aqui, nenhuma tela nova reintroduz o defeito.
 */
import type { ReactNode } from 'react';

interface AppShellProps {
  /** Faixa fixa do topo: marca, título, status. */
  header?: ReactNode;
  /** A ÚNICA região que rola. */
  children: ReactNode;
  /** Faixa fixa do rodapé: controles, ação principal. */
  footer?: ReactNode;
  /**
   * Altura do shell. `'viewport'` para telas que ocupam a janela (janela
   * principal, popup); um número em pixels para o painel flutuante, que recebe a altura
   * calculada pelo dock.
   */
  height?: 'viewport' | number;
  className?: string;
}

export function AppShell({
  header,
  children,
  footer,
  height = 'viewport',
  className = '',
}: AppShellProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr) auto',
        height: height === 'viewport' ? '100dvh' : height,
      }}
      className={`overflow-hidden ${className}`}
    >
      {/* As faixas fixas nunca encolhem: era daí que vinha o rodapé de
          controles somindo quando a transcrição crescia. */}
      <div className="min-h-0 shrink-0">{header}</div>
      <div className="flex min-h-0 flex-col">{children}</div>
      <div className="min-h-0 shrink-0">{footer}</div>
    </div>
  );
}
