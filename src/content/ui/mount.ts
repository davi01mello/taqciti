/**
 * Host único da UI injetada: um custom element com Shadow DOM, isolado do
 * estilo da página. O painel TaqCITi (React) é montado aqui.
 *
 * O CSS entra como texto (`panel.css?inline`, já processado pelo Tailwind) e é
 * instalado via adoptedStyleSheets: uma folha só, sem <link>, sem vazar para o
 * Meet e sem o Meet vazar para dentro.
 */
import PANEL_CSS from './panel.css?inline';

let shadowRoot: ShadowRoot | null = null;
let mountPoint: HTMLElement | null = null;

function ensureShadowRoot(): ShadowRoot {
  if (shadowRoot) return shadowRoot;

  const host = document.createElement('taqciti-root');
  document.documentElement.appendChild(host);

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
  shadowRoot?.host.remove();
  shadowRoot = null;
  mountPoint = null;
}
