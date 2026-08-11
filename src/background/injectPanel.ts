/**
 * Põe o painel flutuante numa aba qualquer, a partir do clique no ícone.
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
import { rememberPanelTab } from './panelTabs';

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
 * Injeta, e diz se conseguiu — quem chama decide o plano B.
 *
 * Injetar de novo numa aba que já tem o painel é seguro e esperado: o mundo
 * isolado guarda o módulo em cache, então o `onExecute` do content script roda
 * outra vez sobre o painel que já está lá e ele apenas se abre. É o que faz o
 * segundo clique no ícone parecer natural em vez de duplicar a cápsula.
 */
export async function openPanelInTab(tab: chrome.tabs.Tab): Promise<boolean> {
  if (tab.id === undefined || !canInject(tab.url)) return false;

  const files = panelScriptFiles();
  if (files.length === 0) {
    logger.error('manifesto sem content script: nada para injetar');
    return false;
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
    // Só depois de injetar de verdade: uma aba anotada sem painel receberia
    // broadcast a troco de nada até a primeira mensagem falhar e podá-la.
    await rememberPanelTab(tab.id);
    return true;
  } catch (error) {
    logger.error('falha ao injetar o painel na aba', error);
    return false;
  }
}
