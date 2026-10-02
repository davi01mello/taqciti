/**
 * Libera o `chrome.storage.session` para o CONTENT SCRIPT.
 *
 * ── O bug que isto conserta ──────────────────────────────────────────────
 *
 * A pergunta "deseja registrar esta reunião?" nunca aparecia. Nem na página,
 * nem na sidebar. Entrar numa reunião não produzia nada — e não produzia
 * silêncio por acaso.
 *
 * O caminho inteiro da autorização mora em `chrome.storage.session`: a
 * participação atual, a reunião detectada e a decisão (ver
 * `features/meeting/consent.ts`). Quem detecta a reunião e escreve o anúncio é
 * o content script, dentro da aba do Meet.
 *
 * Só que no MV3 a área `session` é, por padrão, **inacessível a content
 * scripts**: eles rodam num contexto "não confiável" e toda chamada rejeita com
 * `Access to storage is not allowed from this context.` Como
 * `considerarReuniao` é assíncrona e era chamada com `void`, essa rejeição não
 * tinha para onde ir — nenhum erro na tela, nenhum log, nada no painel. A
 * extensão parecia funcionar e simplesmente não perguntava nada.
 *
 * `TRUSTED_AND_UNTRUSTED_CONTEXTS` é o que dá ao content script a mesma área de
 * sessão que o background e as páginas da extensão já enxergam. Sem isso, o
 * portão da captura não existe na prática.
 *
 * ── Por que a cada boot, e não no `onInstalled` ──────────────────────────
 *
 * O nível de acesso é do service worker, que morre e renasce o tempo todo no
 * MV3; `onInstalled` dispara uma vez na vida da instalação. Garantir isto a
 * cada boot é o que faz a permissão deixar de depender de um evento que já
 * passou — a mesma razão de `ensurePanelPrefs` também viver no boot.
 *
 * ── Por que não amplia permissão nenhuma ─────────────────────────────────
 *
 * `storage.session` é a área de sessão DESTA extensão. O que muda aqui é quais
 * contextos DELA podem lê-la — e o content script já é código dela. Nada disto
 * é exposto à página: o mundo isolado continua isolado, e o site não ganha
 * acesso a coisa alguma.
 */
import { logger } from '@/shared/services/log';

export async function liberarSessionParaContentScripts(): Promise<void> {
  try {
    await chrome.storage.session.setAccessLevel({
      accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
    });
  } catch (error) {
    /*
     * Ruído alto de propósito. O modo de falhar em silêncio desta chamada é a
     * extensão nunca perguntar se deve registrar a reunião — e foi exatamente
     * assim que o problema passou despercebido da primeira vez.
     */
    logger.error(
      'não foi possível liberar o storage de sessão para o content script: a ' +
        'pergunta de autorização não vai aparecer',
      error,
    );
  }
}
