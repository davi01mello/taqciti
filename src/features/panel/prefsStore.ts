/**
 * A ÚNICA fonte de verdade da presença do TaqCITi: `chrome.storage.local`.
 *
 * ── O problema que este arquivo existe para resolver ───────────────────────
 *
 * O painel vive dentro do documento da página, e o documento morre a cada
 * navegação. Isso é uma verdade do Chrome, não um defeito a consertar: não há
 * API de extensão que desenhe UI que atravesse documentos. O que atravessa é o
 * ESTADO — e por isso ele não pode morar em `useState`, nem num campo do
 * controller, nem numa variável do service worker (que o Chrome suspende
 * quando quer).
 *
 * Antes daqui, cada superfície tinha a sua cópia das preferências e gravava o
 * objeto INTEIRO por cima do storage. Três consequências, todas observadas:
 *
 *   1. duas abas com painel divergiam — minimizar numa não chegava na outra, e
 *      a última gravação vencia, ressuscitando posição e rota antigas;
 *   2. o background gravava `presence: 'open'` para abrir o painel e a cópia
 *      velha da página desfazia isso na gravação seguinte;
 *   3. dois cliques na mesma volta (mover e minimizar) perdiam um dos dois,
 *      porque o read-modify-write de cada um lia o mesmo estado inicial.
 *
 * Aqui a leitura é uma assinatura (`chrome.storage.onChanged` alcança TODOS os
 * contextos, inclusive content scripts de outras abas) e a escrita é sempre um
 * PATCH serializado. Nenhum componente guarda uma versão própria da verdade:
 * eles renderizam o que o storage disser, e pedem mudanças por patch.
 */
import type { PanelPrefs, Unsubscribe } from '@/shared/types/domain';
import { DEFAULT_PANEL_PREFS } from '@/shared/types/domain';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, writeLocal } from '@/shared/services/storage';
import { normalizePanelPrefs } from './prefs';

/**
 * Fila de gravação.
 *
 * Cada patch espera o anterior TERMINAR antes de reler. Sem isto, minimizar e
 * mover na mesma volta fariam dois read-modify-write sobre a mesma leitura, e o
 * segundo `set` apagaria o primeiro — o clássico lost update. A fila é por
 * contexto (uma por documento), o que basta: entre contextos o que muda é
 * sempre campo diferente, e `onChanged` reconcilia.
 */
let queue: Promise<PanelPrefs> = Promise.resolve({ ...DEFAULT_PANEL_PREFS });

/** Lê e normaliza. Ausente vira o padrão — nunca `undefined`, nunca meio objeto. */
export async function loadPanelPrefs(): Promise<PanelPrefs> {
  return normalizePanelPrefs(await readLocal<Partial<PanelPrefs>>(STORAGE_KEYS.prefs));
}

/**
 * Aplica um patch e devolve o resultado. É o ÚNICO caminho de escrita.
 *
 * Recebe patch e não o objeto inteiro de propósito: quem chama quase sempre
 * conhece só o campo que está mudando, e mandar o objeto inteiro é justamente
 * como uma cópia velha desfaz o trabalho de outra superfície.
 */
export function patchPanelPrefs(patch: Partial<PanelPrefs>): Promise<PanelPrefs> {
  queue = queue.then(async () => {
    const next = normalizePanelPrefs({ ...(await loadPanelPrefs()), ...patch });
    await writeLocal(STORAGE_KEYS.prefs, next);
    return next;
  });
  return queue;
}

/**
 * Garante que o estado inicial EXISTA, explicitamente, em vez de ser inferido
 * da ausência da chave.
 *
 * A leitura já cai no padrão quando a chave falta, então isto não é sobre
 * evitar `undefined` — é sobre a primeira execução não ser um caso especial.
 * Enquanto a chave não existe, `storage.onChanged` nunca dispara para ela, e
 * qualquer código que espere "o estado mudou" fica esperando por um evento que
 * só o primeiro clique produziria. Escrever o padrão na instalação faz a
 * primeira execução ser igual a todas as outras.
 */
export async function ensurePanelPrefs(): Promise<PanelPrefs> {
  const saved = await readLocal<Partial<PanelPrefs>>(STORAGE_KEYS.prefs);
  if (saved !== null) return normalizePanelPrefs(saved);
  const seed = { ...DEFAULT_PANEL_PREFS };
  await writeLocal(STORAGE_KEYS.prefs, seed);
  return seed;
}

/**
 * Assina as preferências: chama de volta com o valor atual e depois a cada
 * mudança, venha ela desta página, de outra aba ou do background.
 *
 * `chrome.storage.onChanged` é o que faz o painel de TODA aba concordar sem
 * ninguém coordenar nada — é o barramento que substitui as cópias privadas.
 */
export function subscribePanelPrefs(onPrefs: (prefs: PanelPrefs) => void): Unsubscribe {
  let live = true;

  void loadPanelPrefs().then((prefs) => {
    if (live) onPrefs(prefs);
  });

  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (!live || area !== 'local' || !(STORAGE_KEYS.prefs in changes)) return;
    onPrefs(
      normalizePanelPrefs(
        (changes[STORAGE_KEYS.prefs]?.newValue as Partial<PanelPrefs> | undefined) ?? null,
      ),
    );
  };

  chrome.storage.onChanged.addListener(listener);
  return () => {
    live = false;
    chrome.storage.onChanged.removeListener(listener);
  };
}
