import { beforeEach, describe, expect, it } from 'vitest';
import type { MeetingRecord } from '@/shared/types/domain';
import {
  ACTIVE_IDENTITY_NAMESPACE_KEY,
  ANONYMOUS_IDENTITY_NAMESPACE,
  LEGACY_STORAGE_KEYS,
  LOCAL_STORAGE_SCHEMA_VERSION,
  LOCAL_STORAGE_SCHEMA_VERSION_KEY,
  STORAGE_KEYS,
} from '@/shared/config/constants';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import type { Conducao } from '@/features/conducao/store';
import { migrateLocalStorage } from './storageMigrations';

function legacyMeeting(): MeetingRecord {
  return {
    id: 'legacy-meeting',
    title: 'Legada',
    startedAt: 1,
    endedAt: 2,
    durationSeconds: 1,
    participants: [],
    segments: [],
    status: 'ready',
    metadata: {
      capturedCaptions: false,
      droppedSegments: 0,
      reconnectCount: 0,
      wasDiscardedAndRestarted: false,
    },
  };
}

beforeEach(() => installChromeStorageMock());

describe('migrações locais versionadas', () => {
  it('migra cfc:* uma vez, marca o workspace anônimo e grava a versão atual', async () => {
    await chrome.storage.local.set({
      [LEGACY_STORAGE_KEYS.history]: [legacyMeeting()],
      [LEGACY_STORAGE_KEYS.metrics]: { meetingsCaptured: 7 },
    });

    await migrateLocalStorage();
    const stored = await chrome.storage.local.get(null);
    expect((stored[STORAGE_KEYS.history] as MeetingRecord[])[0]?.id).toBe('legacy-meeting');
    expect(stored[STORAGE_KEYS.metrics]).toEqual({ meetingsCaptured: 7 });
    expect(stored[ACTIVE_IDENTITY_NAMESPACE_KEY]).toBe(ANONYMOUS_IDENTITY_NAMESPACE);
    expect(stored[LOCAL_STORAGE_SCHEMA_VERSION_KEY]).toBe(LOCAL_STORAGE_SCHEMA_VERSION);
    expect(stored[LEGACY_STORAGE_KEYS.history]).toBeUndefined();

    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [] });
    await migrateLocalStorage();
    expect((await chrome.storage.local.get(STORAGE_KEYS.history))[STORAGE_KEYS.history]).toEqual([]);
  });

  it('apaga os avisos do Taq já guardados (o recurso foi removido) e deixa o resto', async () => {
    await chrome.storage.local.set({
      [LOCAL_STORAGE_SCHEMA_VERSION_KEY]: 2,
      'taq:avisos': { versao: 1, itens: [{ id: 'a1' }] },
      [STORAGE_KEYS.history]: [legacyMeeting()],
    });
    await migrateLocalStorage();
    const stored = await chrome.storage.local.get(null);
    expect(stored['taq:avisos']).toBeUndefined();
    expect((stored[STORAGE_KEYS.history] as MeetingRecord[])[0]?.id).toBe('legacy-meeting');
    expect(stored[LOCAL_STORAGE_SCHEMA_VERSION_KEY]).toBe(LOCAL_STORAGE_SCHEMA_VERSION);
  });

  /*
   * O perfil do assistente virou contextos (versão 4). A decisão: nada do que a
   * pessoa escreveu se perde. Cada campo vira um contexto LIGADO dela; texto
   * maior que 200 caracteres segue em "(continua)"; o modo e "ler ao encerrar"
   * ligam comportamento e continuam campos; e o perfil antigo fica guardado
   * como estava, com o aviso de que algo não coube quando for o caso.
   */
  describe('versão 4: o perfil do assistente vira contextos', () => {
    const PERFIL_V1 = {
      missao: 'Apoiar reuniões de descoberta com o cliente.',
      observar: ['Impacto', 'Processo atual'],
      intervencao: { modo: 'participativo', estilo: 'Uma pergunta curta por vez' },
      contexto: ['Histórico do cliente'],
      preferencias: ['Explicar o motivo só quando eu pedir'],
      lerAoEncerrar: true,
      revisao: 3,
      criadoEm: 10,
      atualizadoEm: 20,
      historico: [{ em: 10, acao: 'perfil criado', origem: 'pessoa' }],
    };

    it('converte o perfil e a cópia guardada no briefing, preservando revisão, modo e consentimento', async () => {
      await chrome.storage.local.set({
        [LOCAL_STORAGE_SCHEMA_VERSION_KEY]: 3,
        [STORAGE_KEYS.conducao]: {
          versao: 1,
          perfil: PERFIL_V1,
          briefings: [{ reuniaoId: 'm-1', revisao: 1, objetivo: 'A', prioridades: [], retomar: [], perfilRevisao: 3, perfilUsado: PERFIL_V1, historico: [] }],
        },
      });
      await migrateLocalStorage();
      const stored = await chrome.storage.local.get(null);
      const c = stored[STORAGE_KEYS.conducao] as Conducao;
      expect(stored[LOCAL_STORAGE_SCHEMA_VERSION_KEY]).toBe(LOCAL_STORAGE_SCHEMA_VERSION);
      expect(c.perfil).toMatchObject({ base: 'personalizado', revisao: 3, criadoEm: 10, intervencao: { modo: 'participativo' }, lerAoEncerrar: true });
      expect(c.perfil!.contextos.map((x) => [x.nome, x.texto, x.ligado, x.origem])).toEqual([
        ['Em que ajudar', 'Apoiar reuniões de descoberta com o cliente.', true, 'seu'],
        ['O que observar', 'Impacto; Processo atual', true, 'seu'],
        ['Como intervir', 'Uma pergunta curta por vez', true, 'seu'],
        ['Contexto que indiquei', 'Histórico do cliente', true, 'seu'],
        ['Jeito de trabalhar', 'Explicar o motivo só quando eu pedir', true, 'seu'],
      ]);
      expect(c.perfil!.historico).toHaveLength(1);
      expect(c.perfilV1).toEqual({ original: PERFIL_V1, coubeInteiro: true });
      expect(c.briefings[0]!.perfilUsado!.contextos[0]!.texto).toBe('Apoiar reuniões de descoberta com o cliente.');

      // Rodar de novo não muda nada.
      await chrome.storage.local.set({ [LOCAL_STORAGE_SCHEMA_VERSION_KEY]: 3 });
      await migrateLocalStorage();
      expect((await chrome.storage.local.get(STORAGE_KEYS.conducao))[STORAGE_KEYS.conducao]).toEqual(c);
    });

    it('texto longo segue em "(continua)" e, quando não cabe nas 8 vagas, o original fica guardado e marcado', async () => {
      const longo = (letra: string) => Array.from({ length: 150 }, (_, i) => `${letra}${i}`).join(' ');
      // Missão (2 pedaços) + observar (1) + intervir (1) + contexto (3) + jeito (3) = 10 > 8 vagas.
      await chrome.storage.local.set({
        [LOCAL_STORAGE_SCHEMA_VERSION_KEY]: 3,
        [STORAGE_KEYS.conducao]: {
          versao: 1,
          perfil: {
            ...PERFIL_V1,
            missao: longo('m').slice(0, 400),
            observar: [longo('o').slice(0, 200)],
            contexto: [longo('c').slice(0, 200), longo('d').slice(0, 200)],
            preferencias: [longo('p').slice(0, 200), longo('q').slice(0, 200)],
          },
          briefings: [],
        },
      });
      await migrateLocalStorage();
      const c = (await chrome.storage.local.get(STORAGE_KEYS.conducao))[STORAGE_KEYS.conducao] as Conducao;
      expect(c.perfil!.contextos).toHaveLength(8);
      expect(c.perfil!.contextos.every((x) => x.texto.length <= 200 && x.nome.length <= 40)).toBe(true);
      expect(c.perfil!.contextos[1]!.nome).toBe('Em que ajudar (continua)');
      expect(new Set(c.perfil!.contextos.map((x) => x.vaga)).size).toBe(8);
      expect(c.perfilV1!.coubeInteiro).toBe(false);
      expect((c.perfilV1!.original as { missao: string }).missao).toBe(longo('m').slice(0, 400));
    });

    it('sem perfil guardado, não cria nada', async () => {
      await chrome.storage.local.set({ [LOCAL_STORAGE_SCHEMA_VERSION_KEY]: 3 });
      await migrateLocalStorage();
      expect((await chrome.storage.local.get(STORAGE_KEYS.conducao))[STORAGE_KEYS.conducao]).toBeUndefined();
    });
  });

  it('não tenta rebaixar storage criado por uma extensão mais nova', async () => {
    await chrome.storage.local.set({
      [LOCAL_STORAGE_SCHEMA_VERSION_KEY]: LOCAL_STORAGE_SCHEMA_VERSION + 1,
      [STORAGE_KEYS.history]: [legacyMeeting()],
    });
    await expect(migrateLocalStorage()).rejects.toThrow(/versão mais nova/);
    expect(
      ((await chrome.storage.local.get(STORAGE_KEYS.history))[STORAGE_KEYS.history] as MeetingRecord[])[0]?.id,
    ).toBe('legacy-meeting');
  });
});
