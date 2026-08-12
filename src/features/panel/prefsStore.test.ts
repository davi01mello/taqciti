/**
 * A fonte única de verdade da presença do painel.
 *
 * Cada teste aqui corresponde a um jeito real de o TaqCITi sumir ou reaparecer
 * errado — não a uma propriedade abstrata do módulo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PANEL_PREFS } from '@/shared/types/domain';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import type { PanelPrefs } from '@/shared/types/domain';

beforeEach(() => {
  vi.resetModules();
});

async function fresh(saved?: unknown) {
  const mock = installChromeStorageMock(
    saved === undefined ? {} : { local: { [STORAGE_KEYS.prefs]: saved } },
  );
  const store = await import('./prefsStore');
  return { ...store, mock };
}

describe('ensurePanelPrefs', () => {
  /*
   * A primeira execução não pode ser um caso especial. Enquanto a chave não
   * existe, `storage.onChanged` nunca dispara para ela — e qualquer superfície
   * esperando "as preferências mudaram" espera por um evento que só o primeiro
   * clique produziria.
   */
  it('grava o padrão quando não há nada — o estado inicial é explícito', async () => {
    const { ensurePanelPrefs, mock } = await fresh();

    expect(mock.local.values[STORAGE_KEYS.prefs]).toBeUndefined();
    expect(await ensurePanelPrefs()).toEqual(DEFAULT_PANEL_PREFS);
    expect(mock.local.values[STORAGE_KEYS.prefs]).toEqual(DEFAULT_PANEL_PREFS);
  });

  it('nasce em standby (cápsula), nunca fechado nem aberto por conta própria', async () => {
    const { ensurePanelPrefs } = await fresh();
    expect((await ensurePanelPrefs()).presence).toBe('minimized');
  });

  it('não pisa no que já existe — reinstalar não reabre o que foi fechado', async () => {
    const { ensurePanelPrefs } = await fresh({ ...DEFAULT_PANEL_PREFS, presence: 'closed' });
    expect((await ensurePanelPrefs()).presence).toBe('closed');
  });
});

describe('patchPanelPrefs', () => {
  it('muda só o campo pedido', async () => {
    const { patchPanelPrefs } = await fresh({ ...DEFAULT_PANEL_PREFS, x: 0.2, size: 'tall' });
    const next = await patchPanelPrefs({ presence: 'open' });
    expect(next).toEqual({ ...DEFAULT_PANEL_PREFS, x: 0.2, size: 'tall', presence: 'open' });
  });

  /*
   * O lost update que fazia o painel "esquecer" um clique: arrastar e minimizar
   * na mesma volta liam o mesmo estado inicial, e a segunda gravação apagava a
   * primeira. A fila é a correção, e este teste é o que a prende.
   */
  it('patches concorrentes não se apagam', async () => {
    const { patchPanelPrefs } = await fresh();

    const [, , last] = await Promise.all([
      patchPanelPrefs({ x: 0.1, y: 0.2 }),
      patchPanelPrefs({ size: 'tall' }),
      patchPanelPrefs({ presence: 'open' }),
    ]);

    expect(last).toMatchObject({ x: 0.1, y: 0.2, size: 'tall', presence: 'open' });
  });

  it('normaliza na escrita: lixo não entra no storage', async () => {
    const { patchPanelPrefs, mock } = await fresh();
    await patchPanelPrefs({ x: 9 as number, presence: 'sumido' as PanelPrefs['presence'] });

    const saved = mock.local.values[STORAGE_KEYS.prefs] as PanelPrefs;
    expect(saved.x).toBe(1);
    expect(saved.presence).toBe(DEFAULT_PANEL_PREFS.presence);
  });
});

describe('subscribePanelPrefs', () => {
  it('entrega o valor atual logo de cara', async () => {
    const { subscribePanelPrefs } = await fresh({ ...DEFAULT_PANEL_PREFS, presence: 'open' });
    const seen: PanelPrefs[] = [];
    subscribePanelPrefs((p) => seen.push(p));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.presence).toBe('open');
  });

  /*
   * O ponto inteiro da refatoração: minimizar numa superfície precisa chegar a
   * TODAS as outras. Antes, cada uma tinha a sua cópia e a última gravação
   * vencia — duas abas mostravam presenças diferentes do mesmo painel.
   */
  it('propaga mudanças de qualquer origem para todos os assinantes', async () => {
    const { subscribePanelPrefs, patchPanelPrefs } = await fresh();
    const abaA: PanelPrefs[] = [];
    const abaB: PanelPrefs[] = [];
    subscribePanelPrefs((p) => abaA.push(p));
    subscribePanelPrefs((p) => abaB.push(p));

    await patchPanelPrefs({ presence: 'closed' });

    await vi.waitFor(() => {
      expect(abaA.at(-1)?.presence).toBe('closed');
      expect(abaB.at(-1)?.presence).toBe('closed');
    });
  });

  it('ignora mudanças de outras chaves — histórico não re-renderiza o painel', async () => {
    const { subscribePanelPrefs } = await fresh();
    const seen: PanelPrefs[] = [];
    subscribePanelPrefs((p) => seen.push(p));
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [] });
    expect(seen).toHaveLength(1);
  });

  it('cancelar a assinatura solta o listener', async () => {
    const { subscribePanelPrefs, patchPanelPrefs } = await fresh();
    const seen: PanelPrefs[] = [];
    const off = subscribePanelPrefs((p) => seen.push(p));
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    off();
    await patchPanelPrefs({ presence: 'open' });
    expect(seen).toHaveLength(1);
  });
});
