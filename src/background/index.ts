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
import { patchRecord } from './history';
import { bumpMetrics } from './metrics';
import { migrateLocalStorage } from './storageMigrations';
import { backfillOpenTabs } from './injectPanel';
import { openHome } from './homeTab';
import { abrirPainel, abrirPainelNaJanela, ligarAberturaPeloIcone } from './sidePanel';
import { capturarAbaDaReuniao } from './captura';
import { forgetPanelTab, rememberPanelTab } from './panelTabs';
import { liberarSessionParaContentScripts } from './sessionAccess';
import { limparVinculosDaReuniao } from '@/features/annotations/vinculos';
import { ensurePanelPrefs } from '@/features/panel/prefsStore';
import { ligarSincronizacaoAutomatica } from '@/features/sync/sincronizacao';

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
const ready: Promise<void> = liberarSessionParaContentScripts()
  /*
   * PRIMEIRO de tudo, e antes de qualquer leitura de estado.
   *
   * Sem esta liberação o content script não consegue tocar o
   * `chrome.storage.session`, e o portão da captura — a pergunta "deseja
   * registrar esta reunião?" — não chega a existir. Ver `sessionAccess.ts`.
   */
  .then(() => migrateLocalStorage())
  .then(() => hydrate())
  .then(() => recoverInterruptedMeetings())
  .then(() => ensurePanelPrefs())
  .then(() => undefined)
  .catch((error) => logger.error('falha na inicialização', error));

/*
 * O clique no ícone abre a SIDEBAR, e quem o faz é o próprio Chrome.
 *
 * Fora do `ready` e fora do `onInstalled` de propósito: não depende de estado
 * nenhum, e precisa valer a cada boot do worker — o comportamento é por perfil,
 * e o `onInstalled` dispara uma única vez na vida da instalação.
 */
void ligarAberturaPeloIcone();

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
 * O espelho do acervo no servidor, quando a pessoa ligou isso em Conexões.
 *
 * Registrado no escopo do módulo — e não dentro de um `onInstalled` — porque
 * é registro de LISTENER: o service worker do MV3 morre por ociosidade e
 * renasce a cada evento, e um listener registrado dentro de um callback
 * assíncrono pode não existir quando o evento que deveria acordá-lo chega.
 *
 * Nada acontece enquanto a sincronização estiver desligada: a primeira coisa
 * que `sincronizar()` faz é conferir o "sim" guardado. Ver
 * `features/sync/sincronizacao.ts`.
 */
ligarSincronizacaoAutomatica();

/*
 * Rede de segurança do clique no ícone.
 *
 * Com `openPanelOnActionClick` ligado, o Chrome abre o painel sozinho e ESTE
 * listener nunca dispara — é o caminho normal. Ele existe para o caso de aquela
 * chamada ter falhado (Chrome antigo, política de perfil): aí o clique volta a
 * chegar aqui, e aqui ainda há gesto do usuário, que é o que
 * `sidePanel.open()` exige. Se nem isso funcionar, a HOME é o destino — melhor
 * abrir o produto do que não abrir nada.
 */
chrome.action.onClicked.addListener((tab) => {
  // Sem `await` antes da abertura, pelo mesmo motivo de sempre: é aqui que o
  // gesto do clique vive, e uma espera o consumiria.
  const tentativa = tab.id === undefined ? abrirPainelNaJanela() : abrirPainel(tab.id);
  void tentativa.then((r) => {
    if (!r.ok) return openHome(tab);
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
  /*
   * ANTES do `await ready`, e isso é o ponto inteiro deste bloco.
   *
   * `chrome.sidePanel.open()` exige a ativação de usuário, e ela vale só para o
   * turno SÍNCRONO do handler: qualquer `await` antes da chamada a consome. O
   * `await ready` logo abaixo roda antes de todo caso do `switch` — e era ele
   * que fazia o clique na cápsula ser recusado com "may only be called in
   * response to a user gesture". Medido no Chrome 144: com o await, recusa; sem
   * ele, abre.
   *
   * Abrir o painel também não precisa do estado hidratado, então sair na frente
   * não custa nada. Ver src/background/sidePanel.ts.
   */
  if (message.type === 'ui/openSidePanel') {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return abrirPainelNaJanela();
    return abrirPainel(tabId);
  }

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
      case 'meet/captureRecovered':
        return dispatch({ type: 'CAPTURE_RECOVERED' });
      case 'ui/print': {
        const sessao = getState().session;
        const captura = await capturarAbaDaReuniao(sessao?.tabId);
        // A imagem sobe para quem pediu; quem GRAVA é o painel, que conhece o
        // `meetingId` e trata a cota. O background não guarda print.
        return captura.ok
          ? {
              ok: true as const,
              dataUrl: captura.dataUrl,
              meetingId: sessao?.meetingId ?? null,
            }
          : { ok: false as const, motivo: captura.motivo };
      }

      case 'ui/chatNotice': {
        // Só a aba da reunião consegue escrever no chat do Meet. O painel não
        // alcança content script; o background sabe qual é a aba.
        const tabId = getState().session?.tabId;
        if (tabId === null || tabId === undefined) return { ok: false as const };
        try {
          const resposta = (await chrome.tabs.sendMessage(tabId, {
            type: 'meet/sendChatNotice',
            text: message.text,
          })) as { ok?: boolean } | undefined;
          return { ok: resposta?.ok === true };
        } catch {
          // Aba fechada ou sem content script: falhou, e falha não vira
          // confirmação.
          return { ok: false as const };
        }
      }

      case 'ui/openHome':
        // A página principal em aba própria — e SEMPRE a mesma aba, se ela já
        // existir. A abertura mora em `homeTab.ts`, e não aqui, porque o pedido
        // pode vir da sidebar de reunião: content script não abre aba, e um
        // `window.open` de lá sairia no contexto da página, onde o bloqueador
        // de pop-up do site manda.
        return {
          ok: await openHome(sender.tab, {
            ...(message.secao ? { secao: message.secao } : {}),
            recordId: message.recordId ?? null,
          }),
        };
      // ---- UIs (HOME / sidebar de reunião) ----
      case 'panel/mounted': {
        // Uma sidebar nasceu nesta aba: a partir de agora o estado ao vivo tem
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
        if (
          current.session?.meetingId === message.id &&
          current.phase !== 'ended' &&
          current.phase !== 'idle'
        )
          return { ok: false, error: 'meeting-active' };
        /*
         * O que estava preso à reunião sai com ela — nota, marcações e prints —
         * e os documentos ficam, sem o vínculo. Antes nada disso era tocado: os
         * anexos continuavam no storage indexados por um `meetingId` que não
         * existia mais, invisíveis para toda a interface. Ver
         * `features/annotations/vinculos.ts`.
         */
        const limpeza = await limparVinculosDaReuniao(message.id);
        if (current.session?.meetingId === message.id && current.phase === 'ended') {
          await dispatch({ type: 'RESET' });
        }
        return { ok: true, limpeza };
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
