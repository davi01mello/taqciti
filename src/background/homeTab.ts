/**
 * A ABA DA HOME — a página principal do TaqCiti, e o único destino em aba.
 *
 * ── Por que aqui, e não um `chrome.tabs.create` em cada chamador ───────────
 *
 * Três caminhos pedem a HOME: o clique no ícone da extensão fora de uma
 * reunião, o "Abrir numa aba" da sidebar de reunião e os atalhos internos. Se
 * cada um criasse a própria aba, usar o produto por meia hora deixaria seis
 * abas idênticas abertas — e a conversa que a pessoa estava escrevendo ficaria
 * numa delas, com as outras mostrando o mesmo histórico parado.
 *
 * Então a regra é uma só: se já existe aba da HOME, ela é FOCADA. Só quando não
 * existe nenhuma é que uma nasce.
 *
 * ── Por que a busca é por prefixo de URL ───────────────────────────────────
 *
 * `chrome.tabs.query({ url })` casa padrões, não strings, e a HOME pode estar
 * com query string (`?secao=reunioes&record=…`). O padrão com `*` no fim
 * alcança as duas formas. Guardar o id da aba em vez de procurá-la seria mais
 * rápido e erraria mais: a aba pode ter sido fechada, navegada para outro
 * lugar ou descartada, e um id velho abre em silêncio uma segunda aba.
 *
 * ── Por que o `openerTabId` não entra ──────────────────────────────────────
 *
 * A HOME não é um pop-up da página que a abriu: é o produto. Amarrá-la à aba
 * de origem faria o Chrome fechá-la junto em alguns fluxos de agrupamento.
 */
import { logger } from '@/shared/services/log';

const HOME_PATH = 'src/home/index.html';

/** Páginas que o Chrome abre "vazias" — reaproveitá-las é melhor que empilhar. */
const BLANK_PAGES = ['chrome://newtab/', 'chrome://new-tab-page/', 'about:blank'];

function isBlank(url: string | undefined): boolean {
  if (!url) return false;
  return BLANK_PAGES.some((blank) => url === blank || url.startsWith(blank));
}

export type HomeSection = 'assistente' | 'reunioes' | 'documentos' | 'conexoes';

export interface HomeTarget {
  /** Seção em que a HOME deve abrir. Ausente = a que ela já mostrava. */
  secao?: HomeSection;
  /** Abre já nesta reunião, dentro de "Reuniões". */
  recordId?: string | null;
}

export function homeUrl(target?: HomeTarget): string {
  const base = chrome.runtime.getURL(HOME_PATH);
  const params = new URLSearchParams();
  const recordId = target?.recordId ?? null;
  // Um registro implica a seção que o mostra; dizer as duas coisas seria dar
  // ao chamador a chance de pedir um registro dentro de "Documentos".
  if (recordId !== null) {
    params.set('secao', 'reunioes');
    params.set('record', recordId);
  } else if (target?.secao) {
    params.set('secao', target.secao);
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** A aba da HOME que já existe nesta janela do navegador, se houver. */
async function findHomeTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const tabs = await chrome.tabs.query({ url: `${chrome.runtime.getURL(HOME_PATH)}*` });
    return tabs[0] ?? null;
  } catch (error) {
    logger.debug('nao foi possivel procurar a aba da HOME', {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}

/**
 * Abre — ou traz de volta — a HOME. Devolve se conseguiu.
 *
 * Com uma aba já aberta, ela é ativada e a janela dela vem para a frente. A URL
 * só é reescrita quando há um alvo NOVO: navegar a aba a troco de nada
 * recarregaria a página e jogaria fora o rascunho que estivesse no compositor.
 *
 * Numa aba nova e vazia (a aba nova do Chrome), NAVEGA essa aba em vez de criar
 * outra: quem clicou no ícone ali estava numa página em branco à espera de um
 * destino, e abrir uma segunda deixaria a primeira para trás, vazia.
 */
export async function openHome(
  tab?: chrome.tabs.Tab,
  target?: HomeTarget,
): Promise<boolean> {
  const url = homeUrl(target);
  const temAlvo = Boolean(target?.secao || target?.recordId);

  try {
    const existente = await findHomeTab();
    if (existente?.id !== undefined) {
      await chrome.tabs.update(existente.id, {
        active: true,
        ...(temAlvo && existente.url !== url ? { url } : {}),
      });
      if (existente.windowId !== undefined) {
        await chrome.windows.update(existente.windowId, { focused: true });
      }
      return true;
    }

    if (tab?.id !== undefined && isBlank(tab.url)) {
      await chrome.tabs.update(tab.id, { url });
    } else {
      await chrome.tabs.create({ url, windowId: tab?.windowId });
    }
    return true;
  } catch (error) {
    logger.error('nao foi possivel abrir a HOME', error);
    return false;
  }
}
