/**
 * Host único da UI injetada: um custom element com Shadow DOM, isolado do
 * estilo da página. O painel TaqCITi (React) é montado aqui.
 *
 * O CSS entra como texto (`panel.css?inline`, já processado pelo Tailwind) e é
 * instalado via adoptedStyleSheets: uma folha só, sem <link>, sem vazar para o
 * Meet e sem o Meet vazar para dentro.
 *
 * ── Por que o host pendura em `documentElement`, e não em `body` ────────────
 *
 * Aplicações dinâmicas — o Meet entre elas — trocam o `body` inteiro em
 * transições de rota. Um host preso ao `body` iria junto, e o painel
 * desapareceria sem nada no console. `documentElement` só é substituído quando
 * o documento inteiro é, e nesse caso o content script morre de qualquer jeito
 * e o Chrome nos reinstala na página nova.
 */
import PANEL_CSS from './panel.css?inline';

/**
 * "Abra o painel", disparado em `document`.
 *
 * Existe por causa da segunda injeção: injetar de novo numa aba que já tem o
 * painel não monta nada de novo — o módulo do content script fica em cache no
 * mundo isolado, e um `executeScript` repetido só reexecuta o `onExecute`. Sem
 * um recado como este, a segunda injeção não teria efeito nenhum.
 */
export const PANEL_OPEN_EVENT = 'taqciti:open';

let host: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let mountPoint: HTMLElement | null = null;
let guard: MutationObserver | null = null;

/**
 * Devolve o host à árvore se a página o arrancar.
 *
 * NÃO é um `setInterval` recriando o botão: nada é recriado, e nada roda
 * periodicamente. É um observador do `documentElement` que só acorda quando a
 * lista de filhos dele muda — raro — e que apenas RECOLOCA o mesmo nó, com o
 * mesmo shadow root e a mesma árvore React viva dentro. O estado do painel não
 * é tocado, porque nunca foi perdido.
 *
 * Existe porque uma aplicação de página única pode limpar a raiz do documento
 * numa transição de rota, e quando isso acontece o sintoma é exatamente "o
 * TaqCITi sumiu sozinho e não volta mais" — sem erro nenhum para investigar.
 */
function guardHost(node: HTMLElement): void {
  guard?.disconnect();
  guard = new MutationObserver(() => {
    if (node.isConnected) return;
    document.documentElement.appendChild(node);
  });
  guard.observe(document.documentElement, { childList: true });
}

function ensureShadowRoot(): ShadowRoot {
  if (shadowRoot) return shadowRoot;

  host = document.createElement('taqciti-root');
  document.documentElement.appendChild(host);
  guardHost(host);

  // 'open' (e não 'closed') para o React conseguir gerir foco e eventos
  // sintéticos dentro do shadow root sem casos especiais.
  shadowRoot = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(PANEL_CSS);
  shadowRoot.adoptedStyleSheets = [sheet];
  return shadowRoot;
}

/** O nó onde a árvore React vive. */
export function getMountPoint(): HTMLElement {
  if (mountPoint) return mountPoint;
  const root = ensureShadowRoot();
  mountPoint = document.createElement('div');
  root.appendChild(mountPoint);
  return mountPoint;
}

/** Remove a UI inteira da página (encerramento do content script). */
export function unmountHost(): void {
  guard?.disconnect();
  guard = null;
  host?.remove();
  host = null;
  shadowRoot = null;
  mountPoint = null;
}
