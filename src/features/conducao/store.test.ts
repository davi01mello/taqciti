/**
 * O perfil de condução e o briefing — dados sintéticos.
 *
 * Seguram: nada é salvo sem a pessoa, edição confere a revisão lida, igual não
 * cria revisão, o objetivo só é "aprovado" quando a pessoa o informa, a reunião
 * mantém o perfil de quando foi preparada, e entrada fora do formato não vira
 * perfil.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import {
  atualizarPerfilDoBriefing,
  briefingDaReuniao,
  lerConducao,
  normalizarConteudoDoPerfil,
  salvarBriefing,
  salvarPerfil,
  semBriefingDaReuniao,
} from './store';

const PERFIL = {
  missao: 'Apoiar o entendimento de necessidades e critérios de sucesso.',
  observar: ['Processo atual', 'Impacto', 'Restrições'],
  intervencao: { modo: 'discreto', estilo: 'Uma sugestão curta por vez' },
  contexto: ['Histórico do cliente'],
  preferencias: ['Explicar o motivo só quando eu pedir'],
};

beforeEach(() => {
  installChromeStorageMock();
});

describe('perfil', () => {
  it('começa vazio: nada é inventado', async () => {
    const c = await lerConducao();
    expect(c.perfil).toBeNull();
    expect(c.briefings).toEqual([]);
  });

  it('o primeiro perfil exige revisão 0 e fica na revisão 1, com histórico', async () => {
    const r = await salvarPerfil(PERFIL, 0);
    expect(r.tipo).toBe('ok');
    const { perfil } = await lerConducao();
    expect(perfil).toMatchObject({ revisao: 1, missao: PERFIL.missao });
    expect(perfil!.historico.map((h) => h.acao)).toEqual(['perfil criado']);
  });

  it('edição com revisão velha dá conflito e não grava', async () => {
    await salvarPerfil(PERFIL, 0);
    await salvarPerfil({ ...PERFIL, missao: 'Outra missão.' }, 1);
    const r = await salvarPerfil({ ...PERFIL, missao: 'De uma tela desatualizada.' }, 1);
    expect(r.tipo).toBe('conflito');
    expect((await lerConducao()).perfil!.missao).toBe('Outra missão.');
  });

  it('salvar o mesmo conteúdo não cria revisão', async () => {
    await salvarPerfil(PERFIL, 0);
    const r = await salvarPerfil(PERFIL, 1);
    expect(r).toMatchObject({ tipo: 'ok', item: { revisao: 1 } });
  });

  it('sem missão ou fora do formato não vira perfil', async () => {
    expect((await salvarPerfil({ ...PERFIL, missao: '   ' }, 0)).tipo).toBe('invalido');
    expect((await salvarPerfil('texto solto', 0)).tipo).toBe('invalido');
    expect((await lerConducao()).perfil).toBeNull();
  });

  it('limpa e limita: duplicados saem, modo desconhecido vira discreto', () => {
    const c = normalizarConteudoDoPerfil({
      ...PERFIL,
      observar: ['Impacto', 'impacto', '  ', ...Array.from({ length: 20 }, (_, i) => `Item ${i}`)],
      intervencao: { modo: 'agressivo', estilo: 'x' },
    })!;
    expect(c.observar).toHaveLength(8);
    expect(c.observar[0]).toBe('Impacto');
    expect(c.intervencao.modo).toBe('discreto');
  });
});

describe('briefing', () => {
  it('o objetivo só é aprovado quando a pessoa o informa', async () => {
    const vazio = await salvarBriefing('m-1', { contexto: 'Cliente novo.' }, 0);
    expect(vazio).toMatchObject({ tipo: 'ok', item: { aprovado: false, objetivo: '' } });
    const com = await salvarBriefing('m-1', { objetivo: 'Decidir se o piloto começa com uma ou duas unidades.' }, 1);
    expect(com).toMatchObject({ tipo: 'ok', item: { aprovado: true, revisao: 2 } });
    const apagado = await salvarBriefing('m-1', { objetivo: '' }, 2);
    expect(apagado).toMatchObject({ tipo: 'ok', item: { aprovado: false } });
  });

  it('conflito de revisão não sobrescreve', async () => {
    await salvarBriefing('m-1', { objetivo: 'A' }, 0);
    const r = await salvarBriefing('m-1', { objetivo: 'B' }, 0);
    expect(r.tipo).toBe('conflito');
    expect(briefingDaReuniao(await lerConducao(), 'm-1')!.objetivo).toBe('A');
  });

  it('um briefing por reunião, sem misturar', async () => {
    await salvarBriefing('m-1', { objetivo: 'A', prioridades: ['Quem levanta os dados?'] }, 0);
    await salvarBriefing('m-2', { objetivo: 'B' }, 0);
    const c = await lerConducao();
    expect(briefingDaReuniao(c, 'm-1')!.prioridades).toEqual(['Quem levanta os dados?']);
    expect(briefingDaReuniao(c, 'm-2')!.prioridades).toEqual([]);
  });

  it('a reunião mantém o perfil de quando foi preparada até a pessoa pedir', async () => {
    await salvarPerfil(PERFIL, 0);
    await salvarBriefing('m-1', { objetivo: 'A' }, 0);
    await salvarPerfil({ ...PERFIL, missao: 'Nova missão.' }, 1);
    await salvarBriefing('m-1', { contexto: 'Mais um detalhe.' }, 1);
    expect(briefingDaReuniao(await lerConducao(), 'm-1')!.perfilRevisao).toBe(1);

    const r = await atualizarPerfilDoBriefing('m-1', 2);
    expect(r).toMatchObject({ tipo: 'ok', item: { perfilRevisao: 2 } });
  });

  it('reunião preparada sem perfil guarda null, não um perfil inventado', async () => {
    await salvarBriefing('m-1', { objetivo: 'A' }, 0);
    expect(briefingDaReuniao(await lerConducao(), 'm-1')!.perfilRevisao).toBeNull();
  });

  it('semBriefingDaReuniao tira só o daquela reunião', async () => {
    await salvarBriefing('m-1', { objetivo: 'A' }, 0);
    await salvarBriefing('m-2', { objetivo: 'B' }, 0);
    const { conducao, removidos } = semBriefingDaReuniao(await lerConducao(), 'm-1');
    expect(removidos).toBe(1);
    expect(conducao.briefings.map((b) => b.reuniaoId)).toEqual(['m-2']);
  });
});
