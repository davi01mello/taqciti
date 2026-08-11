import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { installChromeStorageMock } from '@/test/chromeStorageMock';

beforeEach(() => {
  vi.resetModules();
});

describe('panelTabs', () => {
  it('começa vazia quando nada foi injetado ainda', async () => {
    installChromeStorageMock();
    const { panelTabs } = await import('./panelTabs');
    expect(await panelTabs()).toEqual([]);
  });

  it('lembra e esquece abas', async () => {
    const { session } = installChromeStorageMock();
    const { panelTabs, rememberPanelTab, forgetPanelTab } = await import('./panelTabs');

    await rememberPanelTab(3);
    await rememberPanelTab(9);
    expect(await panelTabs()).toEqual([3, 9]);
    expect(session.values[STORAGE_KEYS.panelTabs]).toEqual([3, 9]);

    await forgetPanelTab(3);
    expect(await panelTabs()).toEqual([9]);
    expect(session.values[STORAGE_KEYS.panelTabs]).toEqual([9]);
  });

  it('lembrar duas vezes a mesma aba não duplica nem regrava', async () => {
    const { session } = installChromeStorageMock();
    const { panelTabs, rememberPanelTab } = await import('./panelTabs');

    await rememberPanelTab(3);
    session.set.mockClear();
    await rememberPanelTab(3);

    expect(await panelTabs()).toEqual([3]);
    expect(session.set).not.toHaveBeenCalled();
  });

  it('esquecer aba que não está na lista não grava nada', async () => {
    const { session } = installChromeStorageMock();
    const { rememberPanelTab, forgetPanelTab } = await import('./panelTabs');

    await rememberPanelTab(3);
    session.set.mockClear();
    await forgetPanelTab(999);

    expect(session.set).not.toHaveBeenCalled();
  });

  /*
   * O caso que justifica o storage: o service worker do MV3 morre a qualquer
   * momento, e um painel aberto numa aba continua lá esperando estado. Se a
   * lista sumisse junto com o worker, o painel congelaria sem nada explicar.
   */
  it('sobrevive a um restart do service worker', async () => {
    const { session } = installChromeStorageMock();
    const first = await import('./panelTabs');
    await first.rememberPanelTab(42);

    // Módulo recarregado do zero, storage.session intacto — é o que o Chrome faz.
    vi.resetModules();
    installChromeStorageMock({ session: session.values });
    const revived = await import('./panelTabs');

    expect(await revived.panelTabs()).toEqual([42]);
  });
});
