/**
 * As propostas de ajuste — regra em código sobre o feedback, sem modelo.
 *
 * Seguram: uma correção pontual não vira proposta (há limiar); a proposta traz
 * os números reais e o antes → depois; recusar não faz a proposta voltar sem
 * retorno novo; sem perfil não há proposta; aplicar grava uma revisão
 * versionada com o histórico dizendo que foi proposta pelo Taq e aprovada; e
 * conflito de revisão não grava.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { lerConducao, salvarPerfil, type PerfilDeConducao } from '@/features/conducao/store';
import { lerApoio, registrarDecisaoDeAjuste, type Feedback, type TipoDeFeedback } from '@/features/apoio/store';
import {
  JANELA_DE_FEEDBACK,
  LIMIAR_PARA_CONFERIR_O_RESPONDIDO,
  LIMIAR_PARA_INTERVIR_MAIS,
  LIMIAR_PARA_INTERVIR_MENOS,
  PREFERENCIA_DO_JA_RESPONDIDO,
  aplicarAjuste,
  conteudoDepoisDe,
  modoAbaixo,
  modoAcima,
  proporAjustes,
} from './propostas';

const T = 1_760_000_000_000;
let n = 0;
const fb = (tipo: TipoDeFeedback, em: number): Feedback => {
  n += 1;
  return { id: `f${n}`, sugestaoId: `s${n}`, reuniaoId: 'm-1', em, tipo, alcance: 'agora' };
};
/** `quantos` retornos do tipo, espaçados no tempo a partir de `desde`. */
const varios = (tipo: TipoDeFeedback, quantos: number, desde = T): Feedback[] =>
  Array.from({ length: quantos }, (_, i) => fb(tipo, desde + i * 1000));

const perfil = (modo: 'sob_demanda' | 'discreto' | 'participativo', preferencias: string[] = []): PerfilDeConducao => ({
  missao: 'Apoiar a descoberta.',
  observar: [],
  intervencao: { modo, estilo: '' },
  contexto: [],
  preferencias,
  revisao: 1,
  criadoEm: T,
  atualizadoEm: T,
  historico: [],
});

beforeEach(() => {
  installChromeStorageMock();
});

describe('proporAjustes', () => {
  it('sem perfil não há o que ajustar', () => {
    expect(proporAjustes({ feedback: varios('descartada', 6), perfil: null, decisoes: {} })).toEqual([]);
  });

  it('uma correção pontual não vira proposta: abaixo do limiar, nada', () => {
    const f = varios('descartada', LIMIAR_PARA_INTERVIR_MENOS - 1);
    expect(proporAjustes({ feedback: f, perfil: perfil('discreto'), decisoes: {} })).toEqual([]);
  });

  it('descartes demais: propõe sugerir menos, com os números reais e o antes → depois', () => {
    const f = [...varios('util', 3), ...varios('descartada', 2, T + 10_000), ...varios('sem_sentido', 1, T + 20_000)];
    const [p] = proporAjustes({ feedback: f, perfil: perfil('participativo'), decisoes: {} });
    expect(p).toMatchObject({ tipo: 'intervir_menos', mudanca: { tipo: 'modo', de: 'participativo', para: 'discreto' } });
    expect(p!.porque).toBe('3 dos seus últimos 6 retornos foram “descartar” ou “não fazia sentido”.');
    expect(p!.antes).toContain('Participativo');
    expect(p!.depois).toContain('Discreto');
    expect(p!.feedbackIds).toHaveLength(3);
  });

  it('já no "só quando eu chamar", não há como sugerir menos', () => {
    expect(proporAjustes({ feedback: varios('descartada', 5), perfil: perfil('sob_demanda'), decisoes: {} })).toEqual([]);
  });

  it('"tarde demais" repetido: propõe avisar mais cedo; no topo da escala, nada', () => {
    const f = varios('tarde_demais', LIMIAR_PARA_INTERVIR_MAIS);
    const [p] = proporAjustes({ feedback: f, perfil: perfil('discreto'), decisoes: {} });
    expect(p).toMatchObject({ tipo: 'intervir_mais', mudanca: { tipo: 'modo', de: 'discreto', para: 'participativo' } });
    expect(proporAjustes({ feedback: f, perfil: perfil('participativo'), decisoes: {} })).toEqual([]);
  });

  it('quem descarta muito não recebe, ao mesmo tempo, a proposta de sugerir mais', () => {
    const f = [...varios('descartada', 3), ...varios('tarde_demais', 2, T + 10_000)];
    expect(proporAjustes({ feedback: f, perfil: perfil('discreto'), decisoes: {} }).map((x) => x.tipo)).toEqual(['intervir_menos']);
  });

  it('"já estava respondido": propõe a preferência, e não repete se ela já existe', () => {
    const f = varios('ja_respondido', LIMIAR_PARA_CONFERIR_O_RESPONDIDO);
    const [p] = proporAjustes({ feedback: f, perfil: perfil('discreto', ['Perguntas curtas']), decisoes: {} });
    expect(p).toMatchObject({ tipo: 'conferir_o_respondido', mudanca: { tipo: 'preferencia', texto: PREFERENCIA_DO_JA_RESPONDIDO } });
    expect(p!.antes).toContain('Perguntas curtas');
    expect(p!.depois).toContain(PREFERENCIA_DO_JA_RESPONDIDO);
    expect(proporAjustes({ feedback: f, perfil: perfil('discreto', [PREFERENCIA_DO_JA_RESPONDIDO.toUpperCase()]), decisoes: {} })).toEqual([]);
  });

  it('só os retornos mais recentes contam: descartes antigos, fora da janela, não pesam', () => {
    const antigos = varios('descartada', 5, T - 1_000_000);
    const recentes = varios('util', JANELA_DE_FEEDBACK, T);
    expect(proporAjustes({ feedback: [...antigos, ...recentes], perfil: perfil('discreto'), decisoes: {} })).toEqual([]);
  });

  it('quem recusou não vê a proposta de novo até haver retorno NOVO daquele tipo', () => {
    const f = varios('descartada', 3);
    const recusouEm = T + 100_000;
    expect(proporAjustes({ feedback: f, perfil: perfil('discreto'), decisoes: { intervir_menos: recusouEm } })).toEqual([]);
    // Com mais descartes DEPOIS da decisão, volta — mas só com o que veio depois.
    const novos = varios('descartada', 3, recusouEm + 1000);
    const [p] = proporAjustes({ feedback: [...f, ...novos], perfil: perfil('discreto'), decisoes: { intervir_menos: recusouEm } });
    expect(p!.feedbackIds).toHaveLength(3);
    expect(p!.feedbackIds.every((id) => novos.some((x) => x.id === id))).toBe(true);
  });

  it('a escala dos modos', () => {
    expect([modoAbaixo('participativo'), modoAbaixo('discreto'), modoAbaixo('sob_demanda')]).toEqual(['discreto', 'sob_demanda', null]);
    expect([modoAcima('sob_demanda'), modoAcima('discreto'), modoAcima('participativo')]).toEqual(['discreto', 'participativo', null]);
  });
});

describe('aplicar', () => {
  it('conteudoDepoisDe não grava e não altera o perfil original', () => {
    const original = perfil('discreto');
    const copia = JSON.stringify(original);
    const c = conteudoDepoisDe(original, { tipo: 'modo', de: 'discreto', para: 'sob_demanda' });
    expect(c.intervencao.modo).toBe('sob_demanda');
    expect(JSON.stringify(original)).toBe(copia);
  });

  it('aplicar grava uma revisão nova, versionada, com o histórico dizendo que foi proposta pelo Taq e aprovada', async () => {
    await salvarPerfil(
      { missao: 'Apoiar a descoberta.', observar: [], intervencao: { modo: 'participativo', estilo: '' }, contexto: [], preferencias: [] },
      0,
    );
    const atual = (await lerConducao()).perfil!;
    const [p] = proporAjustes({ feedback: varios('descartada', 3), perfil: atual, decisoes: {} });
    const r = await aplicarAjuste(atual, p!);
    expect(r).toMatchObject({ tipo: 'ok', item: { revisao: 2, intervencao: { modo: 'discreto' } } });
    const guardado = (await lerConducao()).perfil!;
    expect(guardado.revisao).toBe(2);
    const ultimo = guardado.historico.at(-1)!;
    expect(ultimo.acao).toMatch(/ajuste proposto pelo Taq e aprovado: Sugerir menos vezes/);
    expect(ultimo.origem).toBe('pessoa');
  });

  it('conflito de revisão: o perfil mudou no meio, e nada é gravado', async () => {
    await salvarPerfil(
      { missao: 'Apoiar a descoberta.', observar: [], intervencao: { modo: 'participativo', estilo: '' }, contexto: [], preferencias: [] },
      0,
    );
    const lido = (await lerConducao()).perfil!;
    const [p] = proporAjustes({ feedback: varios('descartada', 3), perfil: lido, decisoes: {} });
    // Outra aba muda o perfil depois de a pessoa ver a proposta.
    await salvarPerfil(
      { missao: 'Outra missão.', observar: [], intervencao: { modo: 'participativo', estilo: '' }, contexto: [], preferencias: [] },
      1,
    );
    expect((await aplicarAjuste(lido, p!)).tipo).toBe('conflito');
    expect((await lerConducao()).perfil!.missao).toBe('Outra missão.');
    expect((await lerConducao()).perfil!.intervencao.modo).toBe('participativo');
  });

  it('adicionar a preferência respeita o teto da lista e não duplica', async () => {
    await salvarPerfil(
      { missao: 'Apoiar.', observar: [], intervencao: { modo: 'discreto', estilo: '' }, contexto: [], preferencias: ['a', 'b'] },
      0,
    );
    const atual = (await lerConducao()).perfil!;
    const [p] = proporAjustes({ feedback: varios('ja_respondido', 2), perfil: atual, decisoes: {} });
    await aplicarAjuste(atual, p!);
    const depois = (await lerConducao()).perfil!;
    expect(depois.preferencias).toEqual(['a', 'b', PREFERENCIA_DO_JA_RESPONDIDO]);
    expect(proporAjustes({ feedback: varios('ja_respondido', 2), perfil: depois, decisoes: {} })).toEqual([]);
  });
});

describe('decisão da pessoa', () => {
  it('registrar a decisão guarda a hora por tipo, e é isso que faz a proposta recusada sumir', async () => {
    await registrarDecisaoDeAjuste('intervir_menos', T + 5000);
    expect((await lerApoio()).ajustes).toEqual({ intervir_menos: T + 5000 });
  });
});
