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
import { backfillOpenTabs, canInject, ensurePanelInTab } from './injectPanel';
import { openWideView } from './sidePanel';
import { forgetPanelTab, rememberPanelTab } from './panelTabs';
import { ensurePanelPrefs, patchPanelPrefs } from '@/features/panel/prefsStore';

/**
 * A inicialização, e o que ela garante ANTES de a primeira mensagem chegar.
 *
 * `ensurePanelPrefs` está aqui, e não só no `onInstalled`, de propósito: o
 * service worker do MV3 morre e renasce o tempo todo, e o `onInstalled` dispara
 * uma única vez na vida da instalação. Garantir o estado inicial a cada boot faz
 * "a chave existe" deixar de depender de um evento que já passou.
 *
 * A rejeição é capturada porque `ready` é aguardado por TODO handler de
 * mensagem: deixá-la propagar transformaria uma falha de migração em painéis
 * que nunca respondem. O erro fica visível no log, e o estado padrão — que
 * `ensurePanelPrefs` e `getState` garantem — continua de pé.
 */
const ready: Promise<void> = migrateLocalStorage()
  .then(() => hydrate())
  .then(() => recoverInterruptedMeetings())
  .then(() => ensurePanelPrefs())
  .then(() => undefined)
  .catch((error) => logger.error('falha na inicialização', error));

/**
 * Primeira execução depois de instalar (ou atualizar).
 *
 * A única coisa que o background faz pela presença do painel. Dali em diante
 * quem o põe em toda página é o Chrome, pelo `content_scripts` do manifesto —
 * o que sobra aqui é alcançar as abas que já estavam abertas no instante da
 * instalação, porque content script declarado só entra em documento que nasce
 * depois dele.
 *
 * O `await ready` não é decoração: garante que migrações e estado padrão
 * existam ANTES de qualquer painel pedir estado. Sem isso a primeira execução
 * seria uma corrida entre a inicialização e a primeira mensagem.
 */
chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await ready;
    const reached = await backfillOpenTabs();
    logger.info('primeira execução: abas alcançadas', { attempts: reached });
  })();
});

/*
 * O clique no ícone: o TaqCITi VOLTA.
 *
 * É uma gravação no storage, e nada mais. O painel já está montado em toda
 * página aberta, assinando essa chave — então `presence: 'open'` chega até ele
 * pelo mesmo caminho por onde chegam as mudanças feitas em qualquer outra aba.
 * Não há injeção, nem mensagem endereçada, nem "clicar duas vezes porque a
 * primeira não pegou": este é o gesto que desfaz o X.
 *
 * Páginas internas do Chrome (chrome://, a Web Store, a aba nova) não aceitam
 * extensão nenhuma: não há onde desenhar o painel. Ali a saída é o TaqCITi
 * inteiro numa aba — a mesma tela larga do botão "Abrir numa aba", e não uma
 * superfície diferente só porque o ponto de partida era diferente.
 */
chrome.action.onClicked.addListener((tab) => {
  if (!canInject(tab.url)) {
    void openWideView(tab);
    return;
  }
  // A gravação primeiro: se a rede de segurança abaixo precisar mesmo montar um
  // painel, ele já nasce lendo `open` em vez de aparecer recolhido.
  void patchPanelPrefs({ presence: 'open' }).then(() => ensurePanelInTab(tab));
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
      case 'panel/openRequest':
        // "Abrir numa aba", clicado dentro do painel. Abre a mesma tela do
        // painel lateral numa aba, que é o caminho que não depende de um gesto
        // do usuário — ver src/background/sidePanel.ts para o porquê.
        return { ok: await openWideView(sender.tab) };
      // ---- UIs (painel lateral / painel injetado) ----
      case 'panel/mounted': {
        // Um painel nasceu nesta aba: a partir de agora o estado ao vivo tem
        // para onde ir. Ver a nota de `panel/mounted` em types/messages.ts.
        if (sender.tab?.id !== undefined) await rememberPanelTab(sender.tab.id);
        return getState();
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
