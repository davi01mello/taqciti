/**
 * As sugestões de condução e o feedback — storage real (mock), dados sintéticos.
 *
 * Seguram: sugestão sem fonte não nasce; só existem as transições da tabela;
 * "usada" e "resolvida" são coisas diferentes; encerrar não apaga; o feedback
 * guarda o alcance que a pessoa escolheu; e as sugestões saem com a reunião.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import {
  expirarAbertas,
  lerApoio,
  mudarEstado,
  podeTransitar,
  registrarFeedback,
  registrarSugestao,
  semApoioDaReuniao,
  type NovaSugestao,
} from './store';

const NOVA: NovaSugestao = {
  reuniaoId: 'm-1',
  revisao: 12,
  tipo: 'pergunta',
  natureza: 'recomendacao',
  texto: 'Vale esclarecer em que etapa o atendimento trava.',
  pergunta: 'Em que momento o atendimento costuma travar hoje?',
  motivo: 'O cliente falou em solução antes de descrever o problema.',
  ponto: 'Onde ocorre a espera',
  evidencias: [{ segmento: 10, trecho: 'Acho que precisamos de um aplicativo.' }],
};

beforeEach(() => {
  installChromeStorageMock();
});

describe('registrarSugestao', () => {
  it('nasce pendente, com a fonte, e fica guardada', async () => {
    const r = await registrarSugestao(NOVA);
    expect(r.tipo).toBe('ok');
    const { sugestoes } = await lerApoio();
    expect(sugestoes).toHaveLength(1);
    expect(sugestoes[0]).toMatchObject({ estado: 'pendente', natureza: 'recomendacao', ponto: 'Onde ocorre a espera' });
    expect(sugestoes[0]!.evidencias[0]).toEqual({ segmento: 10, trecho: 'Acho que precisamos de um aplicativo.' });
  });

  it('sem fala que a sustente, não nasce', async () => {
    expect((await registrarSugestao({ ...NOVA, evidencias: [] })).tipo).toBe('invalida');
    // Fala que não existia na revisão em que a sugestão nasceu (índice >= revisão).
    expect((await registrarSugestao({ ...NOVA, evidencias: [{ segmento: 12, trecho: 'x' }] })).tipo).toBe('invalida');
    expect((await registrarSugestao({ ...NOVA, evidencias: [{ segmento: 3, trecho: '  ' }] })).tipo).toBe('invalida');
    expect((await lerApoio()).sugestoes).toEqual([]);
  });

  it('sem texto, motivo ou ponto, ou com tipo/natureza desconhecidos, não nasce', async () => {
    for (const ruim of [
      { texto: '  ' },
      { motivo: '' },
      { ponto: '' },
      { tipo: 'ordem' },
      { natureza: 'fato' },
    ]) {
      expect((await registrarSugestao({ ...NOVA, ...ruim } as unknown as NovaSugestao)).tipo).toBe('invalida');
    }
  });

  it('limita o texto e tira o excesso de espaço', async () => {
    const r = await registrarSugestao({ ...NOVA, texto: `  ${'a '.repeat(300)}  ` });
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    expect(r.sugestao.texto.length).toBeLessThanOrEqual(240);
    expect(r.sugestao.texto.startsWith('a a')).toBe(true);
  });
});

describe('estados', () => {
  it('a tabela de transições: o que termina não volta', () => {
    expect(podeTransitar('pendente', 'mostrada')).toBe(true);
    expect(podeTransitar('mostrada', 'usada')).toBe(true);
    expect(podeTransitar('guardada', 'mostrada')).toBe(true);
    expect(podeTransitar('pendente', 'usada')).toBe(false);
    expect(podeTransitar('usada', 'mostrada')).toBe(false);
    expect(podeTransitar('descartada', 'pendente')).toBe(false);
  });

  it('mostrar marca a hora; usar e resolver são encerramentos diferentes', async () => {
    const a = await registrarSugestao(NOVA);
    const b = await registrarSugestao({ ...NOVA, ponto: 'Outro ponto' });
    if (a.tipo !== 'ok' || b.tipo !== 'ok') throw new Error('esperava ok');
    await mudarEstado(a.sugestao.id, 'mostrada');
    await mudarEstado(b.sugestao.id, 'mostrada');
    const usada = await mudarEstado(a.sugestao.id, 'usada', 'pessoa');
    const resolvida = await mudarEstado(b.sugestao.id, 'resolvida', 'conversa');
    expect(usada).toMatchObject({ tipo: 'ok', sugestao: { estado: 'usada', encerradaPor: 'pessoa' } });
    expect(resolvida).toMatchObject({ tipo: 'ok', sugestao: { estado: 'resolvida', encerradaPor: 'conversa' } });
    const { sugestoes } = await lerApoio();
    expect(sugestoes.every((s) => s.mostradaEm !== undefined && s.encerradaEm !== undefined)).toBe(true);
  });

  it('transição fora da tabela é recusada e nada muda', async () => {
    const r = await registrarSugestao(NOVA);
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    const feito = await mudarEstado(r.sugestao.id, 'usada');
    expect(feito).toEqual({ tipo: 'transicao_invalida', de: 'pendente', para: 'usada' });
    expect((await lerApoio()).sugestoes[0]!.estado).toBe('pendente');
  });

  it('guardar para depois não encerra: volta a poder ser mostrada', async () => {
    const r = await registrarSugestao(NOVA);
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    await mudarEstado(r.sugestao.id, 'mostrada');
    await mudarEstado(r.sugestao.id, 'guardada', 'pessoa');
    const guardada = (await lerApoio()).sugestoes[0]!;
    expect(guardada.estado).toBe('guardada');
    expect(guardada.encerradaEm).toBeUndefined();
    expect((await mudarEstado(r.sugestao.id, 'mostrada')).tipo).toBe('ok');
  });

  it('id inexistente não inventa nada', async () => {
    expect(await mudarEstado('nao-existe', 'mostrada')).toEqual({ tipo: 'inexistente' });
  });

  it('expirarAbertas encerra só as abertas da reunião', async () => {
    const a = await registrarSugestao(NOVA);
    await registrarSugestao({ ...NOVA, reuniaoId: 'm-2', ponto: 'Outra reunião' });
    if (a.tipo !== 'ok') throw new Error('esperava ok');
    await registrarSugestao({ ...NOVA, ponto: 'Aberta 2' });
    await mudarEstado(a.sugestao.id, 'descartada', 'pessoa');
    expect(await expirarAbertas('m-1')).toBe(1);
    const { sugestoes } = await lerApoio();
    expect(sugestoes.find((s) => s.reuniaoId === 'm-2')!.estado).toBe('pendente');
    expect(sugestoes.find((s) => s.id === a.sugestao.id)!.estado).toBe('descartada');
  });
});

describe('feedback', () => {
  it('guarda o tipo e o alcance escolhido; o padrão é "só agora"', async () => {
    const r = await registrarSugestao(NOVA);
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    const a = await registrarFeedback({ sugestaoId: r.sugestao.id, tipo: 'ja_respondido' });
    const b = await registrarFeedback({ sugestaoId: r.sugestao.id, tipo: 'tarde_demais', alcance: 'preferencia', comentario: 'Era para ter avisado antes.' });
    expect(a).toMatchObject({ tipo: 'ok', feedback: { alcance: 'agora', reuniaoId: 'm-1' } });
    expect(b).toMatchObject({ tipo: 'ok', feedback: { alcance: 'preferencia', comentario: 'Era para ter avisado antes.' } });
    expect((await lerApoio()).feedback).toHaveLength(2);
  });

  it('feedback de sugestão inexistente ou de tipo/alcance desconhecido é recusado', async () => {
    const r = await registrarSugestao(NOVA);
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    expect(await registrarFeedback({ sugestaoId: 'nao-existe', tipo: 'util' })).toEqual({ tipo: 'inexistente' });
    expect((await registrarFeedback({ sugestaoId: r.sugestao.id, tipo: 'gostei' as never })).tipo).toBe('invalido');
    expect((await registrarFeedback({ sugestaoId: r.sugestao.id, tipo: 'util', alcance: 'sempre' as never })).tipo).toBe('invalido');
  });
});

describe('derivados da reunião', () => {
  it('semApoioDaReuniao tira as sugestões e o feedback daquela reunião', async () => {
    const a = await registrarSugestao(NOVA);
    const b = await registrarSugestao({ ...NOVA, reuniaoId: 'm-2', ponto: 'Outro' });
    if (a.tipo !== 'ok' || b.tipo !== 'ok') throw new Error('esperava ok');
    await registrarFeedback({ sugestaoId: a.sugestao.id, tipo: 'util' });
    await registrarFeedback({ sugestaoId: b.sugestao.id, tipo: 'util' });
    const { apoio, removidas } = semApoioDaReuniao(await lerApoio(), 'm-1');
    expect(removidas).toBe(1);
    expect(apoio.sugestoes.map((s) => s.reuniaoId)).toEqual(['m-2']);
    expect(apoio.feedback.map((f) => f.reuniaoId)).toEqual(['m-2']);
  });
});
