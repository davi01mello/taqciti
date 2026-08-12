/**
 * O alcance da PRIMEIRA EXECUÇÃO: as abas que já estavam abertas quando a
 * extensão foi instalada.
 *
 * Content script declarado só entra em documento que NASCE depois dele. Sem o
 * que está aqui, quem instala a extensão com abas abertas precisaria recarregar
 * cada uma à mão para ver o TaqCITi — que é a cara de uma extensão quebrada
 * logo no primeiro contato. Depois desse momento, quem põe o painel em toda
 * página é o próprio Chrome, pelo manifesto; este módulo não participa mais.
 *
 * ── Por que o caminho do script é lido do manifesto ────────────────────────
 *
 * O @crxjs não coloca `src/content/index.ts` no manifesto: coloca um loader
 * gerado, com hash no nome (`assets/index.ts-loader-Dtw2XVcj.js`), que muda a
 * cada alteração do bundle. Qualquer caminho escrito à mão aqui apodreceria no
 * build seguinte — em silêncio, porque o build continua passando.
 *
 * O manifesto REESCRITO já carrega o nome certo, e `chrome.runtime.getManifest`
 * o devolve em tempo de execução. É por isso que não há nome de arquivo neste
 * módulo, nem configuração de `entryFileNames` no Vite.
 */
import { logger } from '@/shared/services/log';
import { panelTabs, rememberPanelTab } from './panelTabs';

/** Hosts que servem a Chrome Web Store: o Chrome barra injeção neles. */
const STORE_HOSTS = ['chrome.google.com', 'chromewebstore.google.com'];

/**
 * A aba aceita injeção?
 *
 * Páginas internas (`chrome://`, `devtools://`, a Web Store, outra extensão)
 * são fechadas para TODA extensão — não é permissão faltando, é política do
 * navegador, e insistir só produz uma exceção. `file://` fica de fora por outro
 * motivo: depende de "Permitir acesso a URLs de arquivo", que vem desligado, e
 * falharia de um jeito que pareceria bug em vez de configuração.
 */
export function canInject(url: string | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return !STORE_HOSTS.includes(parsed.hostname);
}

/** Os arquivos que o manifesto declara como content script, na ordem. */
export function panelScriptFiles(): string[] {
  const declared = chrome.runtime.getManifest().content_scripts ?? [];
  return declared.flatMap((entry) => entry.js ?? []);
}

/**
 * A aba pode receber a injeção AGORA?
 *
 * Não é a mesma pergunta que `canInject`, que fala da URL. Uma aba descartada
 * pela gestão de memória do Chrome, ou ainda carregando, recusa `executeScript`
 * com uma exceção — e essa exceção não é um defeito a investigar, é o Chrome
 * dizendo "esta aba não existe de verdade neste instante". Perguntar antes é o
 * que evita transformar uma condição normal em erro vermelho na primeira
 * execução; quando ela voltar a carregar, o content script declarado entra
 * sozinho, sem ninguém precisar fazer nada.
 */
function isReachableNow(tab: chrome.tabs.Tab): boolean {
  return tab.id !== undefined && tab.discarded !== true && tab.status === 'complete';
}

/**
 * Injeta numa aba, e diz se conseguiu.
 *
 * Reinjetar numa aba que já tem o painel é seguro: o mundo isolado guarda o
 * módulo em cache, então só o `onExecute` roda de novo, sobre o painel que já
 * está lá.
 */
async function injectInto(tab: chrome.tabs.Tab, files: string[]): Promise<boolean> {
  if (!isReachableNow(tab) || !canInject(tab.url)) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files });
    // Só depois de injetar de verdade: uma aba anotada sem painel receberia
    // broadcast a troco de nada até a primeira mensagem falhar e podá-la.
    await rememberPanelTab(tab.id!);
    return true;
  } catch (error) {
    /*
     * A aba mudou de estado entre a triagem e a injeção. Continua não sendo um
     * defeito — e não vira erro de console, porque a página se resolve sozinha
     * ao carregar: o content script declarado entra nela sem ajuda de ninguém.
     */
    logger.debug('aba fora de alcance para injeção', {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return false;
  }
}

/** Põe o painel nas abas que já estavam abertas na instalação. */
export async function backfillOpenTabs(): Promise<number> {
  const files = panelScriptFiles();
  if (files.length === 0) {
    logger.error('manifesto sem content script: nada para injetar');
    return 0;
  }

  const tabs = await chrome.tabs.query({});
  const results = await Promise.all(tabs.map((tab) => injectInto(tab, files)));
  return results.filter(Boolean).length;
}

/**
 * Rede de segurança do clique no ícone: garante que ESTA aba tenha painel.
 *
 * Quase sempre não faz nada, e é assim que tem que ser — o content script
 * declarado já pôs o painel em toda página que carregou. A exceção é estreita e
 * real: uma aba que estava CARREGANDO no instante da instalação escapa dos dois
 * caminhos, porque o backfill a recusa (documento a meio) e o script declarado
 * só vale para documento que começa depois. Sem isto, o único jeito de trazer o
 * TaqCITi para essa aba seria recarregá-la à mão — exatamente o que não pode ser
 * exigido de ninguém.
 */
export async function ensurePanelInTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  if ((await panelTabs()).includes(tab.id)) return;

  const files = panelScriptFiles();
  if (files.length === 0) return;
  await injectInto(tab, files);
}
