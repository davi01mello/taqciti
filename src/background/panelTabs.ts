/**
 * As abas que têm o painel injetado agora.
 *
 * ── Por que uma lista, e não um broadcast para todo mundo ──────────────────
 *
 * `chrome.runtime.sendMessage` alcança páginas da extensão — o painel lateral,
 * a página de documento — e NÃO alcança content script. Para content script a
 * mensagem tem que ser endereçada com `chrome.tabs.sendMessage(tabId, ...)`, e
 * daí a pergunta "quais abas?" precisa de resposta.
 *
 * Enquanto o painel só existia no Meet, a resposta estava no próprio estado
 * (`session.tabId`, a aba da reunião). Agora que ele abre em qualquer aba, sem
 * esta lista o painel receberia o estado uma vez, ao montar, e congelaria: o
 * relógio parado, o botão de pausa sem efeito visível, a transcrição travada
 * na primeira fala. Parece painel quebrado; é só mensagem que não chegou.
 *
 * Varrer `chrome.tabs.query({})` a cada broadcast resolveria e seria caro do
 * jeito errado — durante a gravação há um broadcast por trecho de legenda, e a
 * varredura multiplicaria isso pelo número de abas abertas, a maioria sem
 * painel nenhum.
 *
 * ── Por que `storage.session` ──────────────────────────────────────────────
 *
 * Mesma razão do estado da reunião: o service worker do MV3 morre a qualquer
 * momento e a lista precisa sobreviver a isso. Não sobrevive ao navegador
 * fechar — e nem deve, porque o painel injetado morre junto com a página.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readSession, writeSession } from '@/shared/services/storage';

/** Espelho em memória: evita uma leitura de storage por broadcast. */
let cached: number[] | null = null;

async function load(): Promise<number[]> {
  if (cached === null) cached = (await readSession<number[]>(STORAGE_KEYS.panelTabs)) ?? [];
  return cached;
}

async function save(tabs: number[]): Promise<void> {
  cached = tabs;
  await writeSession(STORAGE_KEYS.panelTabs, tabs);
}

export async function panelTabs(): Promise<number[]> {
  return load();
}

export async function rememberPanelTab(tabId: number): Promise<void> {
  const current = await load();
  if (current.includes(tabId)) return;
  await save([...current, tabId]);
}

/**
 * Tira a aba da lista. Chamado ao fechar a aba e também quando uma mensagem
 * não chega — navegar para outra página leva o painel embora sem avisar
 * ninguém, e a entrada morta só aparece na primeira mensagem que falha.
 */
export async function forgetPanelTab(tabId: number): Promise<void> {
  const current = await load();
  const next = current.filter((id) => id !== tabId);
  if (next.length !== current.length) await save(next);
}
