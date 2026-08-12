/**
 * A SAÍDA LARGA do TaqCITi — a tela cheia do histórico, sem a página por baixo.
 *
 * ── Por que ela deixou de ser `chrome.sidePanel.open()` ────────────────────
 *
 * `chrome.sidePanel.open()` só é aceito em resposta a um gesto do usuário no
 * contexto da EXTENSÃO. O clique em "Abrir no painel lateral" acontece dentro do
 * painel, ou seja, na PÁGINA: vira uma mensagem até aqui, e o gesto não
 * atravessa a mensageria. O Chrome recusava com "may only be called in response
 * to a user gesture" — sempre, não às vezes. O botão nunca funcionou, e cada
 * clique ainda deixava um erro vermelho no console da extensão.
 *
 * O caminho que não depende de gesto nenhum é abrir a MESMA página numa aba.
 * Entrega o que se pede dela — a transcrição inteira, larga, sem a página por
 * baixo — e funciona em todo lugar, inclusive a partir do ícone numa página em
 * que o painel não pode ser desenhado.
 *
 * O painel lateral do Chrome continua existindo para quem o quiser: com
 * `side_panel.default_path` no manifesto, o TaqCITi aparece no menu de painel
 * lateral do próprio navegador. Aquele caminho nasce de um clique na UI do
 * Chrome, que é um gesto de verdade, e por isso sempre funcionou.
 */
import { logger } from '@/shared/services/log';

const WIDE_VIEW_PATH = 'src/sidepanel/index.html';

/** Páginas que o Chrome abre "vazias" — reaproveitá-las é melhor que empilhar. */
const BLANK_PAGES = ['chrome://newtab/', 'chrome://new-tab-page/', 'about:blank'];

function isBlank(url: string | undefined): boolean {
  if (!url) return false;
  return BLANK_PAGES.some((blank) => url === blank || url.startsWith(blank));
}

/**
 * Abre a saída larga. Devolve se conseguiu.
 *
 * Numa aba nova e vazia, NAVEGA essa aba em vez de criar outra: quem clicou no
 * ícone ali estava numa página em branco à espera de um destino, e abrir uma
 * segunda aba deixaria a primeira para trás, vazia.
 */
export async function openWideView(tab?: chrome.tabs.Tab): Promise<boolean> {
  const url = chrome.runtime.getURL(WIDE_VIEW_PATH);
  try {
    if (tab?.id !== undefined && isBlank(tab.url)) {
      await chrome.tabs.update(tab.id, { url });
    } else {
      await chrome.tabs.create({ url, windowId: tab?.windowId });
    }
    return true;
  } catch (error) {
    logger.error('nao foi possivel abrir a saida larga', error);
    return false;
  }
}
