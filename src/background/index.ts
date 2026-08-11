/**
 * Entry point do service worker: roteia mensagens validadas para a máquina de
 * estados e o histórico local. Listeners registrados sincronamente (exigência
 * do MV3); handlers aguardam a hidratação.
 *
 * Versão standalone: captura, guarda no histórico local, mostra. Sem envio a
 * nenhum backend, sem autenticação de produto, sem diagnóstico técnico — só
 * transcrição.
 */
import { PROVIDER_GOOGLE_MEET } from '@/shared/config/constants';
import { onMessage } from '@/shared/services/messaging';
import { logger } from '@/shared/services/log';
import {
  dispatch,
  getState,
  hydrate,
  recoverInterruptedMeetings,
} from './sessionController';
import { deleteRecord, patchRecord } from './history';
import { bumpMetrics } from './metrics';
import { migrateLocalStorage } from './storageMigrations';
import { openMainWindow, registerMainWindowListeners } from './mainWindow';
import { openPanelInTab } from './injectPanel';

const ready: Promise<void> = migrateLocalStorage()
  .then(() => hydrate())
  .then(() => recoverInterruptedMeetings())
  .catch((error) => logger.error('falha na inicialização', error));

registerMainWindowListeners();

/*
 * O clique no ícone abre o painel NA PÁGINA em que a pessoa está — é isto que
 * o `default_popup` ausente no manifesto libera.
 *
 * Não espera o `ready`: injetar não depende do estado hidratado, e o painel
 * pede o estado por conta própria assim que monta. Segurar aqui só atrasaria a
 * resposta ao clique.
 *
 * Páginas internas do Chrome não aceitam extensão nenhuma; ali o histórico
 * abre na outra saída, que é onde ele sempre coube.
 */
chrome.action.onClicked.addListener((tab) => {
  void openPanelInTab(tab).then((injected) => {
    if (!injected) void openMainWindow();
  });
});

// A aba da reunião fechou depois do fim: o resumo já está salvo no histórico,
// então o estado global volta ao idle sozinho — sem tela presa para a próxima.
chrome.tabs.onRemoved.addListener((tabId) => {
  void ready.then(() => {
    const current = getState();
    if (current.phase === 'ended' && current.session?.tabId === tabId) {
      void dispatch({ type: 'RESET' });
    }
  });
});

function defaultTitle(now: Date): string {
  const date = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `Reunião de ${date} às ${time}`;
}

onMessage((message, sender) => {
  return (async () => {
    await ready;
    const now = Date.now();

    switch (message.type) {
      // ---- Content script ----
      case 'meet/detected': {
        const givenTitle = message.title.trim();
        await dispatch({
          type: 'MEETING_DETECTED',
          meetingId: crypto.randomUUID(),
          meetingCode: message.meetingCode,
          provider: PROVIDER_GOOGLE_MEET,
          tabId: sender.tab?.id ?? null,
          title: givenTitle || defaultTitle(new Date(now)),
          titleAuto: givenTitle.length === 0,
          captionsEnabled: message.captionsEnabled,
          at: now,
        });
        return getState();
      }
      case 'meet/ended':
        return dispatch({ type: 'MEETING_FINISHED', at: now });
      case 'meet/captions':
        return dispatch({ type: 'CAPTIONS_STATE', enabled: message.enabled });
      case 'meet/chunk':
        return dispatch({ type: 'CAPTION_CHUNK', chunk: message.chunk });
      case 'meet/participants':
        return dispatch({
          type: 'PARTICIPANTS_UPDATED',
          participants: message.participants,
        });
      case 'meet/accountContext':
        // Sem autenticação de produto nesta versão: só a conta do Meet
        // observada, nunca comparada com nenhuma conta "oficial".
        return dispatch({
          type: 'ACCOUNT_BOUNDARY_UPDATED',
          boundary: {
            meet: message.context,
            product: null,
            mismatch: false,
          },
        });
      case 'meet/speakersMerged':
        return dispatch({ type: 'SPEAKERS_MERGED', renames: message.renames });
      case 'meet/reconnect':
        return dispatch({ type: 'RECONNECT' });
      case 'meet/captureDegraded':
        await bumpMetrics({
          captureDegradedTotal: 1,
          ...(message.reason === 'parser' ? { parserFailuresTotal: 1 } : {}),
        });
        return dispatch({ type: 'CAPTURE_DEGRADED', at: now });
      case 'panel/openRequest':
        // Abre/foca a janela principal — vem do popup ou do botão "Ver no
        // histórico" no painel do Meet. Único lugar que chama openMainWindow.
        await openMainWindow();
        return { ok: true };
      // ---- UIs (popup / janela principal / painel no Meet) ----
      case 'ui/getState':
        return getState();
      case 'ui/pause':
        return dispatch({ type: 'PAUSE' });
      case 'ui/resume':
        return dispatch({ type: 'RESUME' });
      case 'ui/clearTranscript':
        return dispatch({ type: 'CLEAR_TRANSCRIPT' });
      case 'ui/finish':
        return dispatch({ type: 'MEETING_FINISHED', at: now });
      case 'ui/rename':
        await dispatch({ type: 'RENAME', title: message.title });
        return { ok: true };
      case 'ui/reset':
        return dispatch({ type: 'RESET' });
      case 'ui/dismissLanguageWarning':
        return dispatch({ type: 'LANGUAGE_WARNING_DISMISSED' });

      // ---- Histórico ----
      case 'ui/history/delete': {
        const current = getState();
        if (current.session?.meetingId === message.id && current.phase === 'ended') {
          await dispatch({ type: 'RESET' });
        }
        await deleteRecord(message.id);
        return { ok: true };
      }
      case 'ui/history/rename': {
        await patchRecord(message.id, { title: message.title });
        if (getState().session?.meetingId === message.id) {
          await dispatch({ type: 'RENAME', title: message.title });
        }
        return { ok: true };
      }
      case 'state/updated':
        return undefined;
    }
  })();
});
