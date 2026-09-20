/**
 * A abertura do painel lateral nativo — e o gesto do usuário, medido.
 *
 * ── O caminho que sempre funciona: o ícone ────────────────────────────────
 *
 * `setPanelBehavior({ openPanelOnActionClick: true })` faz o CHROME abrir o
 * painel quando o ícone é clicado. Não passa por código nosso, não depende de o
 * service worker estar acordado, e não há gesto para preservar porque quem
 * trata o clique é o próprio navegador.
 *
 * Chamado a cada boot, e não só no `onInstalled`: o worker do MV3 morre e
 * renasce o tempo todo, e o comportamento é por perfil — garantir a cada
 * inicialização faz ele deixar de depender de um evento que já passou.
 *
 * ── O clique na cápsula: funciona, e quase não funcionou ──────────────────
 *
 * `chrome.sidePanel.open()` exige "um gesto do usuário", medido no contexto da
 * EXTENSÃO. Durante um tempo este projeto tratou isso como impossível a partir
 * da página: a cápsula tentava, o Chrome recusava, e a interface pedia o clique
 * no ícone.
 *
 * Estava errado, e a medição no Chrome 144 mostrou onde:
 *
 *   clique real na cápsula → runtime.sendMessage → open({ tabId })     ABRE
 *   o mesmo, com UM `await` qualquer antes do open()                   RECUSA
 *
 * O gesto ATRAVESSA a mensageria. O que ele não sobrevive é a um `await` no
 * meio do caminho: a ativação vale para o turno síncrono do handler, e qualquer
 * espera antes da chamada a consome. O culpado era o nosso próprio `await
 * ready` no topo do roteador de mensagens, que rodava antes de todo caso —
 * inclusive deste.
 *
 * Daí a forma destas funções: elas NÃO são `async`. Chamar `open()` é a
 * primeira coisa que acontece, e o `then` só trata o resultado. Pôr um `await`
 * antes de qualquer uma delas quebra a abertura pela cápsula, e o sintoma é um
 * botão que não faz nada.
 */
import { logger } from '@/shared/services/log';

export type ResultadoDeAbertura =
  | { ok: true }
  /** O Chrome recusou por falta de gesto. */
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

function interpretar(error: unknown): ResultadoDeAbertura {
  const mensagem = error instanceof Error ? error.message : String(error);
  // A mensagem do Chrome é estável o bastante para distinguir o caso que tem
  // conserto (um `await` a mais no caminho) do que é falha de verdade.
  if (/user gesture/i.test(mensagem)) {
    logger.debug('painel lateral recusado por falta de gesto');
    return { ok: false, motivo: 'gesto' };
  }
  logger.error('nao foi possivel abrir o painel lateral', error);
  return { ok: false, motivo: 'erro' };
}

/**
 * Abre o painel para uma aba.
 *
 * NÃO é `async` de propósito — ver o comentário do topo. A chamada precisa ser
 * a primeira coisa a acontecer depois do clique.
 */
export function abrirPainel(tabId: number): Promise<ResultadoDeAbertura> {
  try {
    return chrome.sidePanel
      .open({ tabId })
      .then<ResultadoDeAbertura>(() => ({ ok: true }))
      .catch(interpretar);
  } catch (error) {
    // Algumas recusas do Chrome chegam como exceção síncrona.
    return Promise.resolve(interpretar(error));
  }
}

/**
 * Abre o painel sem uma aba conhecida, ancorando na janela em foco.
 *
 * Caminho de último recurso: descobrir a janela exige um `await`, e é
 * exatamente isso que consome a ativação. Serve quando quem chama já não tem
 * gesto a perder — não use para o clique da cápsula.
 */
export async function abrirPainelNaJanela(): Promise<ResultadoDeAbertura> {
  try {
    const janela = await chrome.windows.getCurrent();
    if (janela.id === undefined) return { ok: false, motivo: 'erro' };
    await chrome.sidePanel.open({ windowId: janela.id });
    return { ok: true };
  } catch (error) {
    return interpretar(error);
  }
}
