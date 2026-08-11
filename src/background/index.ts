/**
 * Entry point do service worker: roteia mensagens validadas para a máquina de
 * estados e o histórico local. Listeners registrados sincronamente (exigência
 * do MV3); handlers aguardam a hidratação.
 *
 * Versão standalone: captura, guarda no histórico local, mostra. Sem envio a
 * nenhum backend, sem autenticação de produto, sem diagnóstico técnico — só
 * transcrição.
 */
import { PROVIDER_GOOGLE_MEET, STORAGE_KEYS } from '@/shared/config/constants';
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
import { openPanelInTab, canInject, panelScriptFiles } from './injectPanel';
import { openSidePanel } from './sidePanel';
import { forgetPanelTab } from './panelTabs';
import {
  dropPersistentAccess,
  hasPersistentAccess,
  requestPersistentAccess,
  syncPersistentInjection,
} from './persistentPanel';

const ready: Promise<void> = migrateLocalStorage()
  .then(() => hydrate())
  .then(() => recoverInterruptedMeetings())
  .catch((error) => logger.error('falha na inicialização', error));

/*
 * O registro da injeção persistente é reconciliado a cada boot do worker, e
 * não só quando algo muda. O service worker do MV3 morre e renasce o tempo
 * todo, e a permissão pode ter sido revogada pelo usuário direto na página de
 * extensões do Chrome, sem evento nenhum chegar aqui enquanto ele dormia.
 */
void syncPersistentInjection();

chrome.permissions.onAdded.addListener(() => void syncPersistentInjection());
chrome.permissions.onRemoved.addListener(() => void syncPersistentInjection());

// Fechar o painel desregistra a injeção; reabrir registra de volta. Storage é
// o único canal: quem muda a presença é o content script, noutro processo.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && STORAGE_KEYS.prefs in changes) {
    void syncPersistentInjection();
  }
});

/**
 * Primeira execução depois de instalar (ou atualizar).
 *
 * Content script declarado só entra em página que CARREGA depois da
 * instalação: as abas do Meet já abertas ficariam sem o TaqCITi até alguém
 * recarregar à mão, o que parece extensão quebrada logo no primeiro contato.
 * `host_permissions` do Meet — que não custa aviso nenhum, porque o
 * `content_scripts` já o produz — é o que permite alcançá-las agora.
 *
 * O `await ready` não é decoração: é o que garante que migrações e estado
 * padrão existam ANTES de qualquer painel pedir estado. Sem isso a primeira
 * execução seria uma corrida entre a inicialização e a primeira mensagem.
 */
chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await ready;
    await syncPersistentInjection();

    const files = panelScriptFiles();
    if (files.length === 0) return;

    const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id === undefined || !canInject(tab.url)) return;
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
        } catch (error) {
          // Aba descartada, ou num estado que recusa injeção. Recarregar
          // resolve, e insistir aqui não.
          logger.error('nao foi possivel alcancar uma aba do Meet ja aberta', error);
        }
      }),
    );
  })();
});

/*
 * O clique no ícone abre o painel NA PÁGINA em que a pessoa está — é isto que
 * o `default_popup` ausente no manifesto libera.
 *
 * Não espera o `ready`: injetar não depende do estado hidratado, e o painel
 * pede o estado por conta própria assim que monta. Segurar aqui só atrasaria a
 * resposta ao clique.
 *
 * Páginas internas do Chrome (chrome://, a Web Store) não aceitam extensão
 * nenhuma. Ali cai no painel lateral — e cai funcionando, porque estamos
 * dentro do clique no ícone, que é o gesto que `sidePanel.open` exige.
 */
chrome.action.onClicked.addListener((tab) => {
  void openPanelInTab(tab).then((injected) => {
    if (!injected) void openSidePanel(tab.windowId);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  // A aba levou o painel injetado junto — não adianta mais endereçar broadcast
  // pra ela. Fora do `ready` de propósito: podar a lista não depende do estado.
  void forgetPanelTab(tabId);

  // A aba da reunião fechou depois do fim: o resumo já está salvo no histórico,
  // então o estado global volta ao idle sozinho — sem tela presa para a próxima.
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
      case 'panel/openRequest': {
        // "Ver no histórico", clicado dentro do painel injetado. O clique
        // aconteceu na PÁGINA, então o gesto não chega até aqui e o Chrome
        // pode recusar — ver src/background/sidePanel.ts. O `ok` conta a
        // verdade em vez de fingir sucesso.
        const opened = await openSidePanel(sender.tab?.windowId);
        return { ok: opened };
      }
      // ---- UIs (painel lateral / painel injetado) ----
      case 'ui/persistence/status':
        return { enabled: await hasPersistentAccess() };
      case 'ui/persistence/set': {
        if (!message.enabled) {
          await dropPersistentAccess();
          return { enabled: false };
        }
        // Pode falhar por falta de gesto do usuário: o clique aconteceu na
        // página e virou mensagem. O painel precisa saber para poder avisar.
        return { enabled: await requestPersistentAccess() };
      }
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
