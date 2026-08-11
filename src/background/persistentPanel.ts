/**
 * O que faz o painel sobreviver à navegação da página.
 *
 * ── O problema, e por que não tem solução dentro da página ─────────────────
 *
 * Um content script MORRE quando a aba navega: o documento descarrega, o mundo
 * isolado é desmontado, e a árvore React vai junto. Não existe API de extensão
 * que desenhe UI persistente por cima de páginas web — as únicas superfícies
 * que atravessam a navegação são o painel lateral, uma janela própria e o
 * devtools, e nenhuma delas flutua sobre a página.
 *
 * Então "o painel não pertencer ao DOM da página" é inalcançável. O que é
 * alcançável, e produz o mesmo resultado para quem usa, são duas metades:
 *
 *   1. o ESTADO mora fora da página (chrome.storage — ver PanelPrefs), então a
 *      navegação não tem o que destruir;
 *   2. o painel é REINJETADO sozinho na página nova, e remonta lendo esse
 *      estado — mesma posição, mesmo tamanho, mesma tela, mesma reunião.
 *
 * Este arquivo é a metade 2.
 *
 * ── Por que uma permissão opcional ─────────────────────────────────────────
 *
 * Reinjetar sozinho exige acesso permanente ao host, e `activeTab` é revogado
 * exatamente na navegação — é a permissão de "esta aba, por causa deste
 * clique". A alternativa seria `host_permissions: <all_urls>` no manifesto, que
 * põe "ler e alterar todos os seus dados em todos os sites" na tela de
 * instalação de todo mundo, inclusive de quem só quer transcrever reuniões.
 *
 * Com `optional_host_permissions` a instalação continua sem aviso nenhum e quem
 * quer a persistência autoriza uma vez. Por isso tudo aqui é condicional: sem a
 * autorização, o registro simplesmente não acontece e o painel continua vindo
 * por clique no ícone.
 *
 * ── Por que registerContentScripts, e não tabs.onUpdated ───────────────────
 *
 * Ouvir navegação e injetar à mão parece mais simples e erra em dois pontos: o
 * service worker do MV3 pode estar dormindo no momento do evento, e injetar
 * depois do `document_idle` faz o painel piscar em cima de uma página já
 * pintada. O registro dinâmico é do próprio Chrome, sobrevive ao worker morrer
 * e entra no mesmo momento do ciclo de vida que um content script declarado.
 */
import { logger } from '@/shared/services/log';
import { loadPanelPrefs } from '@/features/panel/prefs';
import { panelScriptFiles } from './injectPanel';

/** Escopo pedido para a persistência. Nunca no manifesto — só sob demanda. */
export const ALL_URLS = '<all_urls>';

/** Id do registro dinâmico; é por ele que se atualiza ou remove depois. */
const SCRIPT_ID = 'taqciti-persistent-panel';

export async function hasPersistentAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [ALL_URLS] });
  } catch (error) {
    logger.error('falha ao consultar permissao de host', error);
    return false;
  }
}

async function isRegistered(): Promise<boolean> {
  try {
    const registered = await chrome.scripting.getRegisteredContentScripts({
      ids: [SCRIPT_ID],
    });
    return registered.length > 0;
  } catch {
    // `getRegisteredContentScripts` rejeita quando o id não existe em algumas
    // versões, em vez de devolver lista vazia. Ausente é ausente.
    return false;
  }
}

/**
 * Acerta o registro com a realidade: autorizado E painel não-fechado significa
 * registrado; qualquer outra combinação significa removido.
 *
 * Idempotente de propósito — é chamada de quatro lugares (boot do worker,
 * mudança de preferência, permissão concedida, permissão revogada) e nenhum
 * deles sabe o que os outros já fizeram.
 */
export async function syncPersistentInjection(): Promise<void> {
  const [granted, prefs, already] = await Promise.all([
    hasPersistentAccess(),
    loadPanelPrefs(),
    isRegistered(),
  ]);

  /*
   * Fechado desregistra. Sem isso, o bundle do painel seria carregado e
   * executado em toda página visitada só para descobrir que não deve desenhar
   * nada — um custo real de CPU e memória por aba, cobrado de quem
   * explicitamente pediu para o TaqCITi sair da frente.
   */
  const wanted = granted && prefs.presence !== 'closed';

  if (wanted === already) return;

  try {
    if (wanted) {
      const js = panelScriptFiles();
      if (js.length === 0) {
        logger.error('manifesto sem content script: nada para registrar');
        return;
      }
      await chrome.scripting.registerContentScripts([
        {
          id: SCRIPT_ID,
          js,
          matches: [ALL_URLS],
          runAt: 'document_idle',
          // Só o quadro de topo: o painel é uma janela da aba, e um iframe de
          // anúncio não deve ganhar a sua própria cópia.
          allFrames: false,
          persistAcrossSessions: true,
        },
      ]);
      logger.info('painel persistente registrado');
    } else {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
      logger.info('painel persistente removido');
    }
  } catch (error) {
    logger.error('falha ao sincronizar a injecao persistente', error);
  }
}

/**
 * Pede a autorização. Devolve se ficou concedida ao final.
 *
 * `chrome.permissions.request` exige um gesto do usuário. A chamada nasce de um
 * clique no painel, que vira mensagem até aqui — e o gesto pode não atravessar
 * a mensageria, do mesmo jeito que não atravessa para `sidePanel.open`. Por
 * isso devolve booleano em vez de assumir sucesso: quem chamou precisa poder
 * dizer ao usuário que não deu.
 */
export async function requestPersistentAccess(): Promise<boolean> {
  try {
    const granted = await chrome.permissions.request({ origins: [ALL_URLS] });
    if (granted) await syncPersistentInjection();
    return granted;
  } catch (error) {
    logger.error('falha ao pedir permissao de host', error);
    return false;
  }
}

export async function dropPersistentAccess(): Promise<void> {
  try {
    await chrome.permissions.remove({ origins: [ALL_URLS] });
  } catch (error) {
    logger.error('falha ao revogar permissao de host', error);
  }
  await syncPersistentInjection();
}
