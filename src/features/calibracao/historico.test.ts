/**
 * O teste histórico — gerador roteirizado, relógio simulado, storage real (mock).
 *
 * Seguram: a cada corte o modelo só recebe as falas que já tinham começado
 * (nunca o futuro); a reunião real não ganha sugestão e o que o teste gravou é
 * apagado; o teto de chamadas vale e é dito; sem perfil nada é chamado; erro do
 * provedor é contado; e a preparação e o perfil da reunião real valem no teste.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { salvarBriefing, salvarPerfil } from '@/features/conducao/store';
import type { AdaptadorDeModelo } from '@/features/taq/modelo';
import type { ResultadoDaAvaliacao } from '@/features/apoio/gerar';
import { lerApoio } from '@/features/apoio/store';
import { PREFIXO_DO_TESTE, reproduzirReuniao } from './historico';

const ADAPTADOR = {} as AdaptadorDeModelo;
const REUNIAO = { id: 'm-real', titulo: 'Descoberta com a Prefeitura' };

/** 24 falas, uma a cada 20 s, com texto de verdade (8 palavras): a reunião dura 8 minutos. */
const FALAS = Array.from({ length: 24 }, (_, i) => ({
  speaker: i % 2 ? 'Cliente' : 'Ana',
  text: `Fala número ${i} sobre o atendimento da prefeitura hoje.`,
  startOffsetMs: i * 20_000,
}));

const PERFIL = (modo: 'sob_demanda' | 'discreto' | 'participativo' = 'participativo') => ({
  missao: 'Apoiar a descoberta.',
  observar: [],
  intervencao: { modo, estilo: '' },
  contexto: [],
  preferencias: [],
});

const nova = (corte: number, ponto: string, reuniaoId = 'qualquer'): ResultadoDaAvaliacao => ({
  tipo: 'ok',
  nova: {
    reuniaoId,
    revisao: corte,
    tipo: 'pergunta',
    natureza: 'recomendacao',
    texto: `Vale esclarecer ${ponto}.`,
    pergunta: `Como funciona ${ponto} hoje?`,
    motivo: 'Ainda não ficou claro.',
    ponto,
    evidencias: [{ segmento: corte - 1, trecho: `Fala número ${corte - 1} sobre o atendimento da prefeitura hoje.` }],
  },
  retiradas: [],
  recusados: [],
  uso: { latenciaMs: 900, entrada: 1500, saida: 100 },
});

function gerador(resposta: (n: number, corte: number, reuniaoId: string) => ResultadoDaAvaliacao) {
  const vistos: Array<{ id: string; falasRecebidas: number; corte: number; maiorOffset: number }> = [];
  let n = 0;
  const avaliar = (async (a: { reuniao: { id: string }; falas: readonly { startOffsetMs: number }[]; falasConsolidadas: number }) => {
    n += 1;
    vistos.push({
      id: a.reuniao.id,
      falasRecebidas: a.falas.length,
      corte: a.falasConsolidadas,
      maiorOffset: Math.max(...a.falas.map((f) => f.startOffsetMs)),
    });
    return resposta(n, a.falasConsolidadas, a.reuniao.id);
  }) as never;
  return { avaliar, vistos };
}

beforeEach(() => {
  installChromeStorageMock();
});

describe('reproduzirReuniao', () => {
  it('a cada corte o modelo só recebe o que já tinha sido dito: nada do futuro', async () => {
    await salvarPerfil(PERFIL(), 0);
    const g = gerador((n, corte, id) => nova(corte, `ponto ${n}`, id));
    const r = await reproduzirReuniao({ adaptador: ADAPTADOR, reuniao: REUNIAO, falas: FALAS, avaliar: g.avaliar });
    expect(g.vistos.length).toBeGreaterThan(0);
    for (const v of g.vistos) {
      // As falas recebidas terminam no instante do corte; a mais nova começou, no máximo, nele.
      expect(v.falasRecebidas).toBeLessThanOrEqual(FALAS.length);
      expect(v.corte).toBe(Math.max(0, v.falasRecebidas - 2));
      expect(v.maiorOffset).toBe(FALAS[v.falasRecebidas - 1]!.startOffsetMs);
    }
    // Os cortes crescem: o modelo vê cada vez mais, nunca menos nem tudo de uma vez.
    const cortes = g.vistos.map((v) => v.corte);
    expect([...cortes].sort((a, b) => a - b)).toEqual(cortes);
    expect(cortes[0]!).toBeLessThan(FALAS.length - 2);
    expect(r.fontesValidas).toBe(true);
  });

  it('roda sob um id próprio: a reunião real não ganha sugestão e o teste não deixa nada gravado', async () => {
    await salvarPerfil(PERFIL(), 0);
    const g = gerador((n, corte, id) => nova(corte, `ponto ${n}`, id));
    await reproduzirReuniao({ adaptador: ADAPTADOR, reuniao: REUNIAO, falas: FALAS, avaliar: g.avaliar });
    expect(g.vistos.every((v) => v.id === `${PREFIXO_DO_TESTE}m-real`)).toBe(true);
    const apoio = await lerApoio();
    expect(apoio.sugestoes).toEqual([]);
    expect(apoio.medicoes).toEqual({});
    expect(apoio.pausadas).toEqual({});
  });

  it('o perfil e a preparação da reunião real valem no teste', async () => {
    await salvarPerfil(PERFIL('sob_demanda'), 0);
    await salvarBriefing('m-real', { objetivo: 'Entender a causa dos atrasos.', modo: 'participativo' }, 0);
    const g = gerador((n, corte, id) => nova(corte, `ponto ${n}`, id));
    const r = await reproduzirReuniao({ adaptador: ADAPTADOR, reuniao: REUNIAO, falas: FALAS, avaliar: g.avaliar });
    // O perfil é "só quando eu chamar", mas a preparação desta reunião escolheu participativo: o modelo roda.
    expect(r.avaliacoes).toBeGreaterThan(0);
  });

  it('o relatório diz, a cada corte, se mostrou, ficou em silêncio ou esperou', async () => {
    await salvarPerfil(PERFIL(), 0);
    const g = gerador((n, corte, id) =>
      n === 1 ? nova(corte, 'Onde ocorre a espera', id) : { tipo: 'ok', nova: null, retiradas: [], recusados: [], uso: { latenciaMs: 1, entrada: 1, saida: 1 } },
    );
    const r = await reproduzirReuniao({ adaptador: ADAPTADOR, reuniao: REUNIAO, falas: FALAS, avaliar: g.avaliar });
    const acoes = r.linhas.map((l) => l.acao);
    expect(acoes).toContain('mostrou');
    expect(acoes).toContain('silencio');
    // Passos em que o orçamento não deixou chamar o modelo ficam "esperou".
    expect(r.linhas.filter((l) => !l.chamouOModelo).every((l) => l.acao === 'esperou' || l.acao === 'sem_orcamento')).toBe(true);
    const linha = r.linhas.find((l) => l.acao === 'mostrou')!;
    expect(linha.sugestao).toMatchObject({ ponto: 'Onde ocorre a espera', pergunta: expect.stringContaining('Como funciona') });
    // A fonte citada é uma fala que existia no corte.
    expect(linha.sugestao!.falasCitadas.every((n) => n < linha.falasConsolidadas)).toBe(true);
    expect(r.sugestoesMostradas).toBe(1);
    expect(r.passos).toBe(r.linhas.length);
  });

  it('o teto de chamadas vale e o relatório diz que parou por ele', async () => {
    await salvarPerfil(PERFIL(), 0);
    const g = gerador(() => ({ tipo: 'ok', nova: null, retiradas: [], recusados: [] }));
    const r = await reproduzirReuniao({
      adaptador: ADAPTADOR,
      reuniao: REUNIAO,
      falas: FALAS,
      passoMs: 20_000,
      maxAvaliacoes: 2,
      avaliar: g.avaliar,
    });
    expect(r.avaliacoes).toBe(2);
    expect(g.vistos).toHaveLength(2);
    expect(r.paradoPeloTeto).toBe(true);
  });

  it('sem perfil, nada é chamado e todos os passos ficam esperando', async () => {
    const g = gerador((n, corte, id) => nova(corte, `ponto ${n}`, id));
    const r = await reproduzirReuniao({ adaptador: ADAPTADOR, reuniao: REUNIAO, falas: FALAS, avaliar: g.avaliar });
    expect(g.vistos).toEqual([]);
    expect(r.avaliacoes).toBe(0);
    expect(r.linhas.every((l) => l.acao === 'esperou' && !l.chamouOModelo)).toBe(true);
  });

  it('erro do provedor é contado no relatório e não interrompe o teste', async () => {
    await salvarPerfil(PERFIL(), 0);
    const g = gerador(() => ({ tipo: 'erro', codigo: 'limite_do_provedor', mensagem: 'A cota acabou.' }));
    const r = await reproduzirReuniao({ adaptador: ADAPTADOR, reuniao: REUNIAO, falas: FALAS, avaliar: g.avaliar });
    expect(r.erros).toBeGreaterThan(0);
    expect(r.linhas.some((l) => l.acao === 'erro')).toBe(true);
    expect(r.sugestoesGeradas).toBe(0);
    expect(r.passos).toBeGreaterThan(1);
  });

  it('aoAndar informa o andamento, e cancelar para o teste', async () => {
    await salvarPerfil(PERFIL(), 0);
    const g = gerador(() => ({ tipo: 'ok', nova: null, retiradas: [], recusados: [] }));
    const andamento: Array<[number, number]> = [];
    const controle = new AbortController();
    const r = await reproduzirReuniao({
      adaptador: ADAPTADOR,
      reuniao: REUNIAO,
      falas: FALAS,
      avaliar: g.avaliar,
      sinal: controle.signal,
      aoAndar: (feito, total) => {
        andamento.push([feito, total]);
        if (feito === 2) controle.abort();
      },
    });
    expect(andamento.map((a) => a[0])).toEqual([1, 2]);
    expect(r.passos).toBe(2);
  });
});
