/**
 * Quem pode mandar o quê ao background.
 *
 * O zod de `messaging.ts` confere a FORMA da mensagem, não quem a mandou. E o
 * content script é declarado para `<all_urls>`: existe dentro do processo de
 * todo site aberto, mesmo saindo cedo fora do Meet. Sem esta barreira, um
 * renderer comprometido em qualquer aba (a classe de bug que o isolamento por
 * site existe para conter) herdava o content script e, com ele, os comandos de
 * UI: ler a transcrição ao vivo (`ui/getState`), capturar a tela da reunião
 * (`ui/print`), escrever no chat do Meet, apagar ou "restaurar" reuniões.
 *
 * A regra:
 *
 *  - página da EXTENSÃO (sidebar, HOME, documento): tudo;
 *  - content script: só da aba de topo do Meet, e só o que o content script
 *    de fato manda (`controller.ts` e `index.ts`) — os `meet/*`, o anúncio da
 *    sidebar, o pedido de abrir o painel e a leitura do estado que a cápsula
 *    desenha.
 *
 * Qualquer outra combinação é descartada em silêncio, como uma mensagem
 * malformada.
 */
import type { ExtensionMessage } from '@/shared/types/messages';

/** O que o content script do Meet manda. Ver o cabeçalho. */
const DO_CONTENT_SCRIPT = new Set<ExtensionMessage['type']>([
  'panel/mounted',
  'ui/openSidePanel',
  'ui/getState',
]);

function ehDoMeet(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'meet.google.com';
  } catch {
    return false;
  }
}

export function remetentePermitido(
  message: Pick<ExtensionMessage, 'type'>,
  sender: chrome.runtime.MessageSender,
  idDaExtensao: string,
  raizDaExtensao: string,
): boolean {
  if (sender.id !== idDaExtensao) return false;

  // Página da própria extensão. `sender.url` é o endereço do documento que
  // mandou — uma aba com a HOME tem `sender.tab`, mas a url continua sendo
  // `chrome-extension://<id>/...`.
  if (sender.url?.startsWith(raizDaExtensao)) return true;

  // Daqui para baixo, só content script: da aba de topo do Meet.
  if (!sender.tab || sender.frameId !== 0) return false;
  if (!ehDoMeet(sender.url) && !ehDoMeet(sender.tab.url)) return false;
  return message.type.startsWith('meet/') || DO_CONTENT_SCRIPT.has(message.type);
}
