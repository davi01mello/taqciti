/**
 * O reflexo verde que corre por dentro do vidro sob o cursor — a mecânica,
 * separada do botão.
 *
 * ── Por que isto saiu do Button ────────────────────────────────────────────
 *
 * O efeito nasceu dentro do `Button`, e enquanto só botões acendiam isso
 * bastava. Agora ele precisa valer para o cartão de reunião no histórico, para
 * a cápsula flutuante e para os controles de ícone do cabeçalho — e "copiar as
 * quinze linhas de `pointermove` em cada um" é exatamente o caminho que já fez
 * a receita do vidro divergir entre `global.css` e `panel.css` (ver o
 * comentário de abertura de glass.css). Uma cópia por superfície vira quatro
 * reflexos com raios e opacidades diferentes em três meses.
 *
 * A camada visual continua em `glass.css` (`.sheen`, `.sheen-green`,
 * `.sheen-light`). Aqui mora só o que é comportamento: onde está o ponteiro.
 */
import type { PointerEvent } from 'react';

export type SheenTone = 'green' | 'light';

/**
 * Devolve o handler de `pointermove` que posiciona a luz.
 *
 * A posição vai direto para o estilo do nó, NUNCA para o estado do React:
 * `pointermove` dispara dezenas de vezes por segundo, e um `setState` por
 * evento renderizaria a árvore inteira a cada pixel de movimento. Escrever duas
 * propriedades customizadas invalida só a pintura da camada de reflexo.
 */
export function trackSheen<T extends HTMLElement>(event: PointerEvent<T>): void {
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty(
    '--sheen-x',
    `${((event.clientX - box.left) / box.width) * 100}%`,
  );
  event.currentTarget.style.setProperty(
    '--sheen-y',
    `${((event.clientY - box.top) / box.height) * 100}%`,
  );
}

/**
 * A camada de luz. Vai DENTRO do elemento que acende, que precisa ser
 * `relative isolate` e declarar o grupo `group/sheen` — sem o `isolate` o
 * `z-index: -1` da camada escapa para trás do vidro da tela e o reflexo some.
 *
 * `group-focus-visible` além do hover: quem navega por teclado nunca dispara um
 * `pointermove`, e sem isso o elemento focado seria o único sem resposta de
 * superfície. Sem ponteiro, os valores padrão de `--sheen-x/y` deixam a luz no
 * centro.
 */
export function Sheen({ tone = 'green' }: { tone?: SheenTone }) {
  return (
    <span
      aria-hidden
      className={`sheen sheen-${tone} group-hover/sheen:opacity-100 group-focus-visible/sheen:opacity-100`}
    />
  );
}

/** As classes que o elemento hospedeiro precisa ter para o reflexo funcionar. */
export const SHEEN_HOST = 'group/sheen relative isolate';
