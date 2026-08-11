/**
 * O painel lateral do Chrome — uma das saídas do TaqCITi, não mais A saída.
 *
 * ── Por que ele voltou, e por que a janela própria foi embora ──────────────
 *
 * Entre a 1.5.0 e agora, o histórico morou numa janela criada com
 * `chrome.windows.create`. A intenção era boa (uma janela do TaqCITi, sem aba,
 * sempre à mão) e o resultado não: extensão não consegue janela sem moldura do
 * SO — `type: 'popup'` vem com a barra do Chrome em cima, e `type: 'panel'`
 * foi removido do Chrome estável. O produto ficava emoldurado por um navegador
 * que ele não queria mostrar.
 *
 * Quem resolveu isso foi o painel injetado, que não tem moldura nenhuma porque
 * é um shadow root dentro da página. O painel lateral fica como a saída larga,
 * para ler uma transcrição inteira sem a página por baixo.
 *
 * ── A pegadinha do gesto ───────────────────────────────────────────────────
 *
 * `chrome.sidePanel.open()` só é aceito em resposta a um gesto do usuário no
 * contexto da EXTENSÃO — um clique no ícone serve. Um clique no painel
 * injetado não serve: ele acontece na página, vira uma mensagem, e o gesto não
 * atravessa a mensageria. Por isso esta função devolve se conseguiu em vez de
 * assumir que sim, e por isso o caminho garantido continua existindo sem
 * código nenhum: com `side_panel.default_path` no manifesto, o TaqCITi aparece
 * no menu de painel lateral do próprio Chrome.
 */
import { logger } from '@/shared/services/log';

export async function openSidePanel(windowId: number | undefined): Promise<boolean> {
  if (windowId === undefined) return false;
  try {
    await chrome.sidePanel.open({ windowId });
    return true;
  } catch (error) {
    // Quase sempre "may only be called in response to a user gesture".
    logger.error('nao foi possivel abrir o painel lateral', error);
    return false;
  }
}
