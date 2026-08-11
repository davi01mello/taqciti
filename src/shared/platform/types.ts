/**
 * A fronteira entre a UI e o mundo que a hospeda.
 *
 * ── Por que isto existe ────────────────────────────────────────────────────
 *
 * A mesma árvore React precisa rodar em dois lugares muito diferentes:
 *
 *   - dentro do Chrome, onde `chrome.runtime` e `chrome.storage` existem;
 *   - dentro da janela do app nativo, onde NADA de `chrome.*` existe e os
 *     mesmos dados chegam por um socket local.
 *
 * Sem esta fronteira, cada tela teria que saber onde está rodando — e a versão
 * nativa viraria um fork da interface, que é exatamente o que se quer evitar.
 * Com ela, `HomeScreen` não muda uma linha entre os dois mundos.
 *
 * ── O contrato, e por que ele tem só três métodos ──────────────────────────
 *
 * A tentação seria espelhar `chrome.storage` e `chrome.runtime` aqui. Seria um
 * erro: a interface ficaria com a FORMA da extensão, e a implementação nativa
 * teria que fingir ser um `chrome.storage` para caber. O que a UI realmente
 * faz é três coisas — mandar um comando, acompanhar a reunião ao vivo e
 * acompanhar o histórico. É esse o vocabulário aqui.
 *
 * ── A regra dos `subscribe` ────────────────────────────────────────────────
 *
 * Todo `subscribe` EMITE O VALOR ATUAL assim que puder, e depois cada
 * atualização. Não é detalhe: é o que dispensa a UI de fazer "leia uma vez, e
 * também assine as mudanças" — o passo duplo que o `useMeetingState` fazia à
 * mão e que, sobre um socket, teria uma janela de corrida entre a leitura e a
 * primeira atualização. Quem implementa é que resolve isso, uma vez.
 */
import type { MeetingRecord, MeetingState } from '@/shared/types/domain';
import type { UiCommand } from '@/shared/types/messages';

export type PlatformKind = 'extension' | 'desktop';

export interface Platform {
  /** Onde a UI está rodando. Só para diagnóstico e para o raro ajuste de
   *  chrome de janela (o app nativo desenha a própria barra de título). */
  readonly kind: PlatformKind;

  /**
   * Emite um comando e devolve a resposta, ou `null` se não houve
   * destinatário — a janela pode estar aberta com o background dormindo, ou o
   * app nativo pode ter perdido a ponte. `null` é um resultado esperado, não
   * um erro: quem chama decide se isso importa.
   */
  send<R = unknown>(command: UiCommand): Promise<R | null>;

  /** Estado da reunião ao vivo: valor atual e cada atualização. */
  subscribeMeeting(onState: (state: MeetingState) => void): () => void;

  /** Histórico local: valor atual e cada atualização. */
  subscribeHistory(onRecords: (records: MeetingRecord[]) => void): () => void;
}
