/**
 * Entry point do content script — o mesmo bundle para dois papéis.
 *
 * ── Por que `onExecute` em vez de código no topo do módulo ─────────────────
 *
 * O @crxjs não registra este arquivo no manifesto: registra um loader mínimo
 * que faz `import()` deste módulo e chama o `onExecute` que ele exportar (ver
 * `dist/assets/*-loader-*.js`). Isso importa porque o painel agora também é
 * injetado sob demanda, e `chrome.scripting.executeScript` roda o loader de
 * novo na MESMA aba: o mundo isolado guarda o módulo em cache, o topo do
 * arquivo não reexecuta, e só o `onExecute` roda outra vez. Código de
 * inicialização no topo do módulo simplesmente não veria o segundo clique.
 *
 * ── Os dois papéis ─────────────────────────────────────────────────────────
 *
 * No Meet, o controller completo: legendas, captura, painel. Fora dele, só o
 * painel — histórico e comando à distância de uma reunião que roda noutra aba.
 * Um bundle só porque o loader é descoberto pelo manifesto em tempo de
 * execução; um segundo entry precisaria de um nome de arquivo fixo, brigando
 * com o hash que o @crxjs gera.
 */
import { GoogleMeetProvider } from './providers/googleMeet/GoogleMeetProvider';
import { ContentController } from './controller';
import { startStandalonePanel } from './standalone';
import { PANEL_OPEN_EVENT } from './ui/mount';

let started = false;

export function onExecute(): void {
  if (window.top !== window) return;

  if (started) {
    document.dispatchEvent(new CustomEvent(PANEL_OPEN_EVENT));
    return;
  }
  started = true;

  if (window.location.hostname === 'meet.google.com') {
    new ContentController(new GoogleMeetProvider()).start();
  } else {
    startStandalonePanel();
  }
}
