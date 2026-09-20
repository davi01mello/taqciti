/**
 * A abertura do painel lateral nativo — e a verdade sobre o gesto do usuário.
 *
 * ── O caminho que sempre funciona: o ícone ────────────────────────────────
 *
 * `setPanelBehavior({ openPanelOnActionClick: true })` faz o CHROME abrir o
 * painel quando o ícone é clicado. Não passa por código nosso, não depende de o
 * service worker estar acordado, e não há gesto para preservar porque quem
 * trata o clique é o próprio navegador. É por isso que é o caminho principal.
 *
 * Chamado a cada boot, e não só no `onInstalled`: o worker do MV3 morre e
 * renasce o tempo todo, e o comportamento é por perfil — garantir a cada
 * inicialização faz ele deixar de depender de um evento que já passou.
 *
 * ── O caminho frágil: qualquer outro clique ───────────────────────────────
 *
 * `chrome.sidePanel.open()` só é aceito "em resposta a um gesto do usuário", e
 * o Chrome mede isso no contexto da EXTENSÃO. Um clique na cápsula acontece na
 * PÁGINA do Meet: vira uma mensagem até aqui, e o gesto não atravessa a
 * mensageria. É a mesma limitação que, na versão 1.5, derrubou o botão "abrir
 * no painel lateral" — ela nunca foi resolvida, só contornada.
 *
 * Então `abrirPainel` TENTA, e devolve por que não deu. Não existe truque: o
 * que existe é a interface saber dizer "clique no ícone do TaqCiti" em vez de
 * fingir que o clique funcionou.
 */
import { logger } from '@/shared/services/log';

export type ResultadoDeAbertura =
  | { ok: true }
  /** O Chrome recusou por falta de gesto — o caso da cápsula. */
  | { ok: false; motivo: 'gesto' }
  | { ok: false; motivo: 'erro' };

/**
 * Liga a abertura pelo ícone. Devolve se o Chrome aceitou.
 *
 * Um `false` aqui não é fatal: `chrome.action.onClicked` continua registrado
 * como rede de segurança (ver background/index.ts), e com o comportamento
 * desligado ele volta a disparar.
 */
export async function ligarAberturaPeloIcone(): Promise<boolean> {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    return true;
  } catch (error) {
    logger.error('nao foi possivel ligar o painel no clique do icone', error);
    return false;
  }
}

/**
 * Abre o painel para uma aba. Só funciona com gesto vivo no contexto da
 * extensão — na prática, a partir de `chrome.action.onClicked`.
 */
export async function abrirPainel(tabId?: number): Promise<ResultadoDeAbertura> {
  try {
    // `open` exige uma âncora: a aba ou a janela. Sem aba conhecida, a janela
    // em foco é o alvo certo — é onde a pessoa está olhando.
    if (tabId === undefined) {
      const janela = await chrome.windows.getCurrent();
      if (janela.id === undefined) return { ok: false, motivo: 'erro' };
      await chrome.sidePanel.open({ windowId: janela.id });
    } else {
      await chrome.sidePanel.open({ tabId });
    }
    return { ok: true };
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    // A mensagem do Chrome é estável o bastante para distinguir o caso que tem
    // conserto na interface (pedir o clique no ícone) do que não tem.
    if (/user gesture/i.test(mensagem)) {
      logger.debug('painel lateral recusado por falta de gesto');
      return { ok: false, motivo: 'gesto' };
    }
    logger.error('nao foi possivel abrir o painel lateral', error);
    return { ok: false, motivo: 'erro' };
  }
}
