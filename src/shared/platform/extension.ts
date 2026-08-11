/**
 * A implementação para quando a UI roda DENTRO do Chrome — a janela do
 * navegador, o popup e a página de documento.
 *
 * É a tradução do vocabulário da UI (ver `types.ts`) para as duas APIs da
 * extensão, e o único lugar do lado da interface que sabe que `chrome.*`
 * existe.
 */
import type { MeetingRecord, MeetingState } from '@/shared/types/domain';
import { IDLE_STATE } from '@/shared/types/domain';
import type { UiCommand } from '@/shared/types/messages';
import { meetingStateSchema } from '@/shared/types/messages';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onMessage, sendMessage } from '@/shared/services/messaging';
import { onLocalChange, readLocal } from '@/shared/services/storage';
import type { Platform } from './types';

export const extensionPlatform: Platform = {
  kind: 'extension',

  send: (command: UiCommand) => sendMessage(command),

  subscribeMeeting(onState: (state: MeetingState) => void) {
    let live = true;

    /*
     * A leitura inicial e a assinatura são disparadas na MESMA volta, e a
     * assinatura vem primeiro de propósito: entre pedir o estado e receber a
     * resposta cabe um `state/updated`, e assinar depois perderia essa
     * atualização. Com esta ordem o pior caso é aplicar o snapshot mais velho
     * por cima do broadcast mais novo — e por isso a resposta do `getState` só
     * é aplicada se nada tiver chegado antes.
     */
    let sawBroadcast = false;

    const unsubscribe = onMessage((message) => {
      if (message.type === 'state/updated') {
        sawBroadcast = true;
        if (live) onState(message.state as MeetingState);
      }
      return undefined;
    });

    void sendMessage<MeetingState>({ type: 'ui/getState' }).then((raw) => {
      if (!live || sawBroadcast) return;
      const parsed = meetingStateSchema.safeParse(raw);
      onState(parsed.success ? (parsed.data as MeetingState) : IDLE_STATE);
    });

    return () => {
      live = false;
      unsubscribe();
    };
  },

  subscribeHistory(onRecords: (records: MeetingRecord[]) => void) {
    let live = true;

    void readLocal<MeetingRecord[]>(STORAGE_KEYS.history).then((list) => {
      if (live) onRecords(list ?? []);
    });

    const unsubscribe = onLocalChange<MeetingRecord[]>(STORAGE_KEYS.history, (list) => {
      if (live) onRecords(list ?? []);
    });

    return () => {
      live = false;
      unsubscribe();
    };
  },
};
