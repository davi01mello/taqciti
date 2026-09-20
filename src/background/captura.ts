/**
 * O PRINT da aba da reunião.
 *
 * ── A armadilha que este módulo existe para evitar ───────────────────────
 *
 * `chrome.tabs.captureVisibleTab(windowId)` não captura a aba que você pede:
 * captura a aba ATIVA daquela janela. Chamá-la com a janela da reunião
 * enquanto a pessoa está lendo e-mail noutra aba devolve uma imagem do e-mail —
 * e ela seria guardada, em silêncio, como "print da reunião". É o pior modo de
 * falhar possível: sem erro, com o dado errado, vinculado à reunião certa.
 *
 * Por isso a captura é precedida de uma CONFERÊNCIA: a aba da sessão ainda
 * existe, é ela que está ativa na janela dela, e é dela que a imagem sai. Se
 * não for, nada é capturado e a interface recebe um motivo que dá para
 * explicar.
 *
 * ── Por que JPEG ─────────────────────────────────────────────────────────
 *
 * PNG de tela cheia passa de 1 MB, e vira ~1,4 MB como data URL. O
 * `storage.local` tem cota, e estourá-la não falha só o print: falha a PRÓXIMA
 * gravação de qualquer coisa, inclusive a da transcrição em andamento.
 * Qualidade 88 num print de interface é indistinguível do PNG a olho nu.
 */
import { logger } from '@/shared/services/log';

export type ResultadoDaCaptura =
  | { ok: true; dataUrl: string }
  | { ok: false; motivo: MotivoDeFalha };

export type MotivoDeFalha =
  /** Não há reunião com aba conhecida. */
  | 'sem-reuniao'
  /** A aba da reunião não existe mais. */
  | 'aba-fechada'
  /** A aba da reunião não é a ativa: capturar daria a tela de outra coisa. */
  | 'aba-nao-ativa'
  /** O Chrome recusou (permissão, página protegida, janela minimizada). */
  | 'recusado';

export const EXPLICACAO: Record<MotivoDeFalha, string> = {
  'sem-reuniao': 'Não há reunião em andamento para capturar.',
  'aba-fechada': 'A aba da reunião não está mais aberta.',
  'aba-nao-ativa':
    'Vá até a aba da reunião e tente de novo — o print é da tela dela, e o Chrome só captura a aba que está à vista.',
  recusado:
    'O Chrome não deixou capturar esta tela. Pode ser uma página protegida ou a janela estar minimizada.',
};

/**
 * Captura a aba da reunião, ou diz por que não deu.
 *
 * @param tabId a aba da sessão de captura (`session.tabId`)
 */
export async function capturarAbaDaReuniao(
  tabId: number | null | undefined,
): Promise<ResultadoDaCaptura> {
  if (tabId === null || tabId === undefined) return { ok: false, motivo: 'sem-reuniao' };

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { ok: false, motivo: 'aba-fechada' };
  }

  // A conferência. `active` é por janela, que é exatamente o escopo de
  // `captureVisibleTab` — as duas perguntas são a mesma.
  if (!tab.active || tab.windowId === undefined) {
    return { ok: false, motivo: 'aba-nao-ativa' };
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 88,
    });
    if (!dataUrl) return { ok: false, motivo: 'recusado' };
    return { ok: true, dataUrl };
  } catch (error) {
    logger.debug('captureVisibleTab recusou', {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return { ok: false, motivo: 'recusado' };
  }
}
