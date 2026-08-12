/**
 * Entry point do content script — o mesmo bundle em toda página.
 *
 * ── O ciclo de vida, escrito por extenso ───────────────────────────────────
 *
 *   documento nasce  →  Chrome executa este script  →  painel monta lendo o
 *   storage  →  usuário navega  →  documento morre COM o painel  →  documento
 *   novo nasce  →  Chrome executa este script de novo  →  painel monta lendo o
 *   storage.
 *
 * O painel morrer na navegação não é o defeito: é como o Chrome funciona, e
 * nenhuma API de extensão desenha UI que atravesse documentos. O que precisa
 * atravessar é o ESTADO, e ele mora em `chrome.storage` (ver
 * features/panel/prefsStore.ts). Por isso não há nada aqui tentando manter o
 * painel vivo — só um caminho curto para ele renascer igual ao que era.
 *
 * ── Por que `onExecute` em vez de código no topo do módulo ─────────────────
 *
 * O @crxjs não registra este arquivo no manifesto: registra um loader mínimo
 * que faz `import()` deste módulo e chama o `onExecute` que ele exportar (ver
 * `dist/assets/*-loader-*.js`). Isso importa porque a primeira execução também
 * injeta este bundle com `chrome.scripting.executeScript`, nas abas que já
 * estavam abertas: o mundo isolado guarda o módulo em cache, o topo do arquivo
 * não reexecuta, e só o `onExecute` roda outra vez. Código de inicialização no
 * topo simplesmente não veria a segunda entrada.
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
import { sendMessage } from '@/shared/services/messaging';
import { PANEL_OPEN_EVENT } from './ui/mount';

const MEET_HOST = 'meet.google.com';

let started = false;

export function onExecute(): void {
  if (window.top !== window) return;

  if (started) {
    document.dispatchEvent(new CustomEvent(PANEL_OPEN_EVENT));
    return;
  }
  started = true;

  /*
   * O painel se anuncia ao background ANTES de montar qualquer coisa.
   *
   * É o que faz o estado ao vivo alcançar esta aba: o background só consegue
   * endereçar content script por `chrome.tabs.sendMessage(tabId, …)`, e é este
   * recado que lhe diz qual é o tabId. Um documento novo a cada navegação
   * significa um painel novo a cada navegação — e um anúncio novo, sem ninguém
   * precisar manter lista de aba nenhuma sincronizada por fora.
   */
  void sendMessage({ type: 'panel/mounted' });

  if (window.location.hostname === MEET_HOST) {
    new ContentController(new GoogleMeetProvider()).start();
  } else {
    startStandalonePanel();
  }
}
