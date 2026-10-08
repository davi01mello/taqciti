/**
 * O que vai ao modelo do perfil e do briefing — dados sintéticos.
 *
 * Seguram: sem nada configurado, nada é acrescentado; o briefing sem objetivo
 * diz que não há objetivo; a reunião preparada usa a CÓPIA do perfil de quando
 * foi preparada, mesmo depois de o perfil mudar; e os blocos dizem que são
 * preferências, não fatos nem permissões.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { linhasDaConducao, perfilQueValeParaAReuniao } from './contexto';
import { atualizarPerfilDoBriefing, lerConducao, salvarBriefing, salvarPerfil } from './store';

const PERFIL = {
  missao: 'Apoiar o entendimento de necessidades.',
  observar: ['Impacto'],
  intervencao: { modo: 'discreto', estilo: 'Uma pergunta curta por vez' },
  contexto: [],
  preferencias: ['Explicar o motivo só quando eu pedir'],
};
const REUNIAO = { id: 'm-1', titulo: 'Descoberta com a Prefeitura' };

beforeEach(() => {
  installChromeStorageMock();
});

describe('linhasDaConducao', () => {
  it('sem perfil nem briefing: nada é acrescentado', async () => {
    expect(linhasDaConducao(await lerConducao(), REUNIAO)).toEqual([]);
  });

  it('o perfil entra como preferência, dizendo que não é fato nem permissão', async () => {
    await salvarPerfil(PERFIL, 0);
    const texto = linhasDaConducao(await lerConducao(), null).join('\n');
    expect(texto).toMatch(/preferências dela/);
    expect(texto).toMatch(/não ampliam nem reduzem/);
    expect(texto).toContain('Apoiar o entendimento de necessidades.');
    expect(texto).toContain('Discreto: uma lembrança relevante por vez — Uma pergunta curta por vez');
  });

  it('briefing sem objetivo diz que não há objetivo, e não usa o título', async () => {
    await salvarBriefing('m-1', { contexto: 'Cliente novo.' }, 0);
    const texto = linhasDaConducao(await lerConducao(), REUNIAO).join('\n');
    expect(texto).toMatch(/não informou um objetivo/);
    expect(texto).not.toMatch(/resultado que querem alcançar/);
    expect(texto).toContain('Cliente novo.');
  });

  it('briefing com objetivo e prioridades, separado do que foi dito na reunião', async () => {
    await salvarBriefing(
      'm-1',
      { objetivo: 'Decidir se o piloto começa com uma ou duas unidades.', prioridades: ['Quem levanta os dados?'] },
      0,
    );
    const texto = linhasDaConducao(await lerConducao(), REUNIAO).join('\n');
    expect(texto).toMatch(/não o que foi dito na reunião/);
    expect(texto).toContain('resultado que querem alcançar: Decidir se o piloto começa');
    expect(texto).toContain('não pode ficar sem encaminhamento: Quem levanta os dados?');
  });

  it('a reunião preparada mantém o perfil antigo até a pessoa pedir o atual', async () => {
    await salvarPerfil(PERFIL, 0);
    await salvarBriefing('m-1', { objetivo: 'A' }, 0);
    await salvarPerfil({ ...PERFIL, missao: 'Missão NOVA, depois da reunião preparada.' }, 1);

    const antes = linhasDaConducao(await lerConducao(), REUNIAO).join('\n');
    expect(antes).toContain('Apoiar o entendimento de necessidades.');
    expect(antes).not.toContain('Missão NOVA');
    // Outra reunião, sem briefing, já usa o perfil de hoje.
    expect(linhasDaConducao(await lerConducao(), { id: 'm-2', titulo: 'Outra' }).join('\n')).toContain('Missão NOVA');

    await atualizarPerfilDoBriefing('m-1', 1);
    expect(linhasDaConducao(await lerConducao(), REUNIAO).join('\n')).toContain('Missão NOVA');
  });

  it('o contexto do Taq recebe os blocos da reunião em foco, e só dela', async () => {
    const { STORAGE_KEYS } = await import('@/shared/config/constants');
    const { armazenamentoLocal } = await import('@/features/taq/armazenamento');
    const { escopoDaConversa } = await import('@/features/taq/politica');
    const { montarContextoInicial } = await import('@/features/taq/contexto');
    const reuniao = (id: string, title: string) => ({
      id,
      title,
      startedAt: Date.parse('2026-10-06T12:00:00Z'),
      endedAt: Date.parse('2026-10-06T13:00:00Z'),
      status: 'completed',
      segments: [],
      participants: [],
    });
    await chrome.storage.local.set({
      [STORAGE_KEYS.history]: [reuniao('m-1', 'Descoberta com a Prefeitura'), reuniao('m-2', 'Outra reunião')],
    });
    await salvarPerfil(PERFIL, 0);
    await salvarBriefing('m-1', { objetivo: 'Decidir o piloto.' }, 0);
    await salvarBriefing('m-2', { objetivo: 'Objetivo da OUTRA reunião.' }, 0);

    const daM1 = await montarContextoInicial(
      { escopo: escopoDaConversa({ conversaId: 'c', meetingId: 'm-1', texto: 'x' }), selecionados: [], conversaId: 'c' },
      armazenamentoLocal,
    );
    expect(daM1).toContain('Decidir o piloto.');
    expect(daM1).toContain('Apoiar o entendimento de necessidades.');
    expect(daM1).not.toContain('OUTRA reunião');

    // Conversa solta, sem reunião em foco: só o perfil, nenhum briefing.
    const solta = await montarContextoInicial(
      { escopo: escopoDaConversa({ conversaId: 'c2', texto: 'x' }), selecionados: [], conversaId: 'c2' },
      armazenamentoLocal,
    );
    expect(solta).toContain('Apoiar o entendimento de necessidades.');
    expect(solta).not.toContain('Decidir o piloto.');
  });

  it('o modo escolhido só para a reunião vale nela, e só com perfil salvo', async () => {
    await salvarPerfil(PERFIL, 0);
    await salvarBriefing('m-1', { objetivo: 'A', modo: 'participativo' }, 0);
    expect(perfilQueValeParaAReuniao(await lerConducao(), 'm-1')!.intervencao.modo).toBe('participativo');
    // Outra reunião, sem briefing, segue o perfil.
    expect(perfilQueValeParaAReuniao(await lerConducao(), 'm-2')!.intervencao.modo).toBe('discreto');
    expect(linhasDaConducao(await lerConducao(), REUNIAO).join('\n')).toContain('Participativo');
    // Sem perfil, escolher um modo não liga o apoio.
    installChromeStorageMock();
    await salvarBriefing('m-3', { objetivo: 'C', modo: 'participativo' }, 0);
    expect(perfilQueValeParaAReuniao(await lerConducao(), 'm-3')).toBeNull();
  });

  it('reunião preparada sem perfil não ganha perfil sozinha', async () => {
    await salvarBriefing('m-1', { objetivo: 'A' }, 0);
    await salvarPerfil(PERFIL, 0);
    const texto = linhasDaConducao(await lerConducao(), REUNIAO).join('\n');
    expect(texto).not.toContain('Apoiar o entendimento');
    expect(texto).toContain('resultado que querem alcançar: A');
  });
});
