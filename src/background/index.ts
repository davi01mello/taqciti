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
import { salaDaUrl } from '@/features/meeting/sala';
import { logger } from '@/shared/services/log';
import {
  dispatch,
  getState,
  hydrate,
  recoverInterruptedMeetings,
} from './sessionController';
import { listHistory, patchRecord, upsertRecord } from './history';
import type { MeetingRecord } from '@/shared/types/domain';
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
import {
  esquecerReuniao,
  fecharParticipacao,
  lerReuniaoDetectada,
} from '@/features/meeting/consent';

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
  .then(() => encerrarSeAAbaSumiu())
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

/**
 * O fim da reunião NÃO pode depender só do content script.
 *
 * Quem percebe "saí da chamada" é o provider, pelo DOM — mas fechar a aba,
 * navegar para outro endereço ou recarregar a extensão mata o content script
 * antes do próximo poll, e o `meet/ended` nunca sai. A sessão ficava presa em
 * `recording` para sempre, e a sidebar seguia dizendo que transcrevia. O
 * background vê a aba morrer e a URL mudar; é ele que fecha a conta nesses
 * casos. `MEETING_FINISHED` é idempotente: se o content já avisou, não faz nada.
 */
const FASES_ATIVAS: ReadonlySet<string> = new Set(['recording', 'paused', 'captionsRequired']);

async function encerrarReuniaoDaAba(tabId: number, voltarAoInicio: boolean): Promise<void> {
  await ready;
  const current = getState();
  if (current.session?.tabId !== tabId) return;
  if (FASES_ATIVAS.has(current.phase)) {
    logger.info('aba da reunião saiu da chamada; encerrando a captura', { tabId });
    await dispatch({ type: 'MEETING_FINISHED', at: Date.now() });
    // O content script morreu sem fechar a participação: sem isto, voltar ao
    // mesmo link horas depois reusava o "sim" de hoje e gravava sem perguntar.
    const sala = current.session.meetingCode;
    await fecharParticipacao(Date.now(), sala);
    await esquecerReuniao(sala);
  }
  // A aba fechou: o registro já está salvo no histórico, então o estado global
  // volta ao idle sozinho — sem tela presa para a próxima reunião.
  if (voltarAoInicio && getState().phase === 'ended') await dispatch({ type: 'RESET' });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  // A aba levou o painel injetado junto — não adianta mais endereçar broadcast
  // pra ela. Fora do `ready` de propósito: podar a lista não depende do estado.
  void forgetPanelTab(tabId);
  void encerrarReuniaoDaAba(tabId, true);
  void esquecerPerguntaSemAba();
});

/**
 * A pergunta "registrar esta reunião?" de uma aba que fechou sem resposta
 * ficava de pé na sidebar para sempre — e um "sim" ali não ligava nada. Se
 * nenhuma aba aberta está na sala anunciada, a pergunta sai.
 */
async function esquecerPerguntaSemAba(): Promise<void> {
  const anunciada = await lerReuniaoDetectada();
  if (!anunciada) return;
  const abas = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
  const alguemNaSala = abas.some(
    (aba) => aba.url !== undefined && salaDoMeet(aba.url) === anunciada.meetingCode.toLowerCase(),
  );
  if (alguemNaSala) return;
  await fecharParticipacao(Date.now(), anunciada.meetingCode);
  await esquecerReuniao(anunciada.meetingCode);
}

/** O código da sala num endereço do Meet, ou `null` se não é uma sala. */
function salaDoMeet(url: string): string | null {
  return salaDaUrl(url);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const url = changeInfo.url;
  void ready.then(() => {
    const sessao = getState().session;
    if (sessao?.tabId !== tabId) return;
    // Saiu da sala (outra página, outra sala, a tela inicial do Meet). Sem
    // RESET: a aba continua aberta, e a sidebar mostra a reunião encerrada.
    if (salaDoMeet(url) !== sessao.meetingCode.toLowerCase()) {
      return encerrarReuniaoDaAba(tabId, false);
    }
  });
});

/**
 * O worker que renasce depois de a aba já ter fechado (Chrome reiniciado,
 * extensão recarregada no meio da chamada) não recebe o `onRemoved`: confere
 * na hidratação se a aba da reunião ainda existe.
 */
async function encerrarSeAAbaSumiu(): Promise<void> {
  const current = getState();
  const tabId = current.session?.tabId;
  if (tabId == null || !FASES_ATIVAS.has(current.phase)) return;
  const existe = await chrome.tabs.get(tabId).then(
    (tab) => tab.url === undefined || salaDoMeet(tab.url) === current.session!.meetingCode.toLowerCase(),
    () => false,
  );
  if (!existe) {
    logger.info('a aba da reunião não existe mais; encerrando a captura', { tabId });
    await dispatch({ type: 'MEETING_FINISHED', at: Date.now() });
  }
}

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

    /*
     * Só a aba DA reunião fala pela reunião. Toda aba do Meet tem content
     * script, e sem esta barreira a legenda de uma sala noutra aba (sem
     * ninguém ter dito "sim" a ela) entrava na transcrição da reunião ao vivo,
     * e a tela pós-chamada de ontem saindo agora encerrava a de hoje.
     * `meet/detected` fica de fora: é como uma aba REIVINDICA a reunião.
     */
    if (message.type.startsWith('meet/') && message.type !== 'meet/detected') {
      const daReuniao = getState().session?.tabId;
      const quem = sender.tab?.id;
      if (daReuniao != null && quem !== undefined && quem !== daReuniao) return getState();
    }

    switch (message.type) {
      // ---- Content script ----
      case 'meet/detected': {
        const givenTitle = message.title.trim();
        // "Continuar de onde parou": só uma gravação DESTA sala. Um id de outra
        // sala (ou que não existe mais) vira gravação nova, nunca mistura.
        const continuar = message.continuarId
          ? (await listHistory()).find(
              (r) => r.id === message.continuarId && r.meetingCode === message.meetingCode,
            )
          : undefined;
        await dispatch({
          type: 'MEETING_DETECTED',
          ...(continuar ? { continuar } : {}),
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
            documentId: message.documentId ?? null,
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
      case 'ui/history/restore': {
        // Restaurar nunca sobrescreve: se a reunião já existe (outra aba já
        // restaurou), a resposta é ok e nada muda.
        const existente = (await listHistory()).some((r) => r.id === message.record.id);
        if (!existente) {
          await upsertRecord({
            ...(message.record as unknown as MeetingRecord),
            status: 'ready',
          });
        }
        return { ok: true };
      }
      case 'state/updated':
        return undefined;
    }
  })();
});
