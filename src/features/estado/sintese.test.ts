/**
 * A síntese de fechamento e o registro como acompanhamento.
 *
 * Seguram: nada vira decisão por aparecer na síntese; responsável e prazo
 * ausentes são listados como não definidos; leitura antiga é dita como limite;
 * só decidido ou combinado vira acompanhamento, por clique, com dono e prazo só
 * os que a fala trouxe, sem duplicar.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { lerTrabalho } from '@/features/trabalho/store';
import { registrarPontoComoAcompanhamento, registrarPontoComoDecisao } from './registrar';
import { sintetizar, podeVirarAcompanhamento } from './sintese';
import { idDoPontoDaPreparacao, mesclar, snapshotInicial, type Snapshot } from './store';

const TRANSCRICAO = [
  { speaker: 'Ana', text: 'Em que momento o atendimento costuma travar hoje?' },
  { speaker: 'Cliente', text: 'Na triagem. A fila da triagem passa de uma hora quase todo dia.' },
  { speaker: 'Cliente', text: 'Acho que a gente podia contratar mais dois atendentes, mas ainda não decidimos.' },
  { speaker: 'Cliente', text: 'A Marta consegue levantar esses dados até sexta-feira, pode ficar com ela.' },
  { speaker: 'Ana', text: 'Fechado então: a Marta levanta os dados até sexta-feira.' },
  { speaker: 'Cliente', text: 'A pesquisa de satisfação a gente deixa para o mês que vem, fica para depois.' },
];
const P = ['Onde ocorre a espera', 'Contratar atendentes', 'Quem levanta os dados e quando', 'Pesquisa de satisfação', 'Orçamento'];
const id = (t: string) => idDoPontoDaPreparacao(t);

function estado(): Snapshot {
  return mesclar({
    anterior: snapshotInicial('m-1', P, 0, 1),
    corte: 6,
    agora: 2,
    transcricao: TRANSCRICAO,
    proposta: {
      pontos: [
        { id: id(P[0]!), estado: 'discutido', falas: [1] },
        { id: id(P[1]!), estado: 'a_confirmar', falas: [2] },
        { id: id(P[2]!), estado: 'decidido', falas: [3, 4], dono: 'Marta', prazo: 'sexta-feira' },
        { id: id(P[3]!), estado: 'adiado', falas: [5] },
      ],
    },
  }).snapshot;
}

beforeEach(() => {
  installChromeStorageMock();
});

describe('sintetizar', () => {
  it('agrupa por estado: só "decidido" é decidido; a proposta fica em "a confirmar"', () => {
    const s = sintetizar(estado());
    expect(s.decidido.map((p) => p.texto)).toEqual(['Quem levanta os dados e quando']);
    expect(s.aConfirmar.map((p) => p.texto)).toEqual(['Contratar atendentes']);
    expect(s.emAberto.map((p) => p.texto)).toEqual(['Orçamento', 'Onde ocorre a espera']);
    expect(s.adiado.map((p) => p.texto)).toEqual(['Pesquisa de satisfação']);
    expect(s.vazia).toBe(false);
  });

  it('lista como NÃO DEFINIDO o que está decidido ou combinado sem responsável ou prazo', () => {
    const s = sintetizar(estado());
    // Marta/sexta-feira estão completos; "Contratar atendentes" não tem nenhum dos dois.
    expect(s.semResponsavelOuPrazo.map((x) => [x.ponto.texto, x.falta])).toEqual([
      ['Contratar atendentes', ['responsável', 'prazo']],
    ]);
  });

  it('diz o limite quando a leitura é mais antiga que a transcrição, e quando ainda não há leitura', () => {
    expect(sintetizar(estado(), 6).limites).toEqual([]);
    expect(sintetizar(estado(), 40).limites.join(' ')).toMatch(/vai até a fala 6 de 40/);
    const nada = sintetizar(null);
    expect(nada.vazia).toBe(true);
    expect(nada.limites.join(' ')).toMatch(/ainda não foi lida/);
  });

  it('sem pontos, não inventa conteúdo', () => {
    const s = sintetizar(snapshotInicial('m-1', [], 3, 1));
    expect(s).toMatchObject({ decidido: [], emAberto: [], aConfirmar: [], adiado: [], semResponsavelOuPrazo: [], vazia: true });
  });

  it('só decidido ou combinado pode virar acompanhamento', () => {
    expect(podeVirarAcompanhamento({ estado: 'decidido' })).toBe(true);
    expect(podeVirarAcompanhamento({ estado: 'a_confirmar' })).toBe(true);
    for (const e of ['a_esclarecer', 'discutido', 'adiado'] as const) expect(podeVirarAcompanhamento({ estado: e })).toBe(false);
  });
});

describe('registrarPontoComoAcompanhamento', () => {
  const reuniao = { id: 'm-1', titulo: 'Descoberta' };
  const pontoDe = (t: string) => estado().pontos.find((p) => p.texto === t)!;

  it('nasce com dono (sugerido) e prazo da fala, a fala como evidência, e como registro aceito pela pessoa', async () => {
    const r = await registrarPontoComoAcompanhamento({ reuniao, ponto: pontoDe('Quem levanta os dados e quando'), versao: '9:6' });
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    expect(r.jaExistia).toBe(false);
    expect(r.compromisso).toMatchObject({
      descricao: 'Quem levanta os dados e quando',
      responsavel: { nome: 'Marta', confirmado: false },
      prazo: { texto: 'sexta-feira' },
      estado: 'aberto',
      situacao: 'aceito',
      reuniaoId: 'm-1',
    });
    expect(r.compromisso.evidencias.map((e) => e.segmento)).toEqual([3, 4]);
    expect(r.compromisso.evidencias[0]).toMatchObject({ tipo: 'reuniao', registroId: 'm-1', versao: '9:6' });
    expect(r.compromisso.historico[0]).toMatchObject({ origem: 'pessoa' });
  });

  it('sem dono nem prazo na fala, o compromisso nasce sem dono nem prazo', async () => {
    const r = await registrarPontoComoAcompanhamento({ reuniao, ponto: pontoDe('Contratar atendentes'), versao: '9:6' });
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    expect(r.compromisso.responsavel).toBeNull();
    expect(r.compromisso.prazo).toBeNull();
  });

  it('repetir o clique não duplica', async () => {
    const ponto = pontoDe('Quem levanta os dados e quando');
    await registrarPontoComoAcompanhamento({ reuniao, ponto, versao: '9:6' });
    const de_novo = await registrarPontoComoAcompanhamento({ reuniao, ponto, versao: '9:6' });
    if (de_novo.tipo !== 'ok') throw new Error('esperava ok');
    expect(de_novo.jaExistia).toBe(true);
    expect((await lerTrabalho()).compromissos).toHaveLength(1);
  });

  it('o que está só discutido, adiado ou a esclarecer não vira acompanhamento', async () => {
    for (const t of ['Onde ocorre a espera', 'Pesquisa de satisfação', 'Orçamento']) {
      const r = await registrarPontoComoAcompanhamento({ reuniao, ponto: pontoDe(t), versao: '9:6' });
      expect(r.tipo, t).toBe('recusado');
    }
    expect((await lerTrabalho()).compromissos).toEqual([]);
  });

  it('ponto sem fala que o sustente não é registrado', async () => {
    const semFala = { ...pontoDe('Contratar atendentes'), evidencias: [] };
    expect((await registrarPontoComoAcompanhamento({ reuniao, ponto: semFala, versao: '9:6' }))).toMatchObject({ tipo: 'recusado' });
  });
});

describe('registrarPontoComoDecisao', () => {
  const reuniao = { id: 'm-1', titulo: 'Descoberta' };
  const pontoDe = (t: string) => estado().pontos.find((p) => p.texto === t)!;

  it('registra a decisão com o assunto e a fala COPIADA da transcrição, como confirmada, por clique da pessoa', async () => {
    const r = await registrarPontoComoDecisao({ reuniao, ponto: pontoDe('Quem levanta os dados e quando'), versao: '9:6' });
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    expect(r.jaExistia).toBe(false);
    expect(r.decisao).toMatchObject({
      assunto: 'Quem levanta os dados e quando',
      estado: 'confirmada',
      reuniaoId: 'm-1',
      texto: 'Quem levanta os dados e quando: Fechado então: a Marta levanta os dados até sexta-feira.',
    });
    // O texto da decisão é a fala da transcrição, não uma frase escrita pelo Taq.
    expect(TRANSCRICAO.some((f) => r.decisao.texto.endsWith(f.text))).toBe(true);
    expect(r.decisao.evidencias.map((e) => e.segmento)).toEqual([3, 4]);
    expect(r.decisao.historico[0]).toMatchObject({ origem: 'pessoa' });
    expect((await lerTrabalho()).decisoes).toHaveLength(1);
  });

  it('repetir o clique não duplica', async () => {
    const ponto = pontoDe('Quem levanta os dados e quando');
    await registrarPontoComoDecisao({ reuniao, ponto, versao: '9:6' });
    const de_novo = await registrarPontoComoDecisao({ reuniao, ponto, versao: '9:6' });
    expect(de_novo).toMatchObject({ tipo: 'ok', jaExistia: true });
    expect((await lerTrabalho()).decisoes).toHaveLength(1);
  });

  it('proposta, discussão, adiamento e ponto a esclarecer NÃO viram decisão', async () => {
    for (const t of ['Contratar atendentes', 'Onde ocorre a espera', 'Pesquisa de satisfação', 'Orçamento']) {
      expect((await registrarPontoComoDecisao({ reuniao, ponto: pontoDe(t), versao: '9:6' })).tipo, t).toBe('recusado');
    }
    expect((await lerTrabalho()).decisoes).toEqual([]);
  });

  it('decidido sem fala que o sustente não é registrado', async () => {
    const semFala = { ...pontoDe('Quem levanta os dados e quando'), evidencias: [] };
    expect(await registrarPontoComoDecisao({ reuniao, ponto: semFala, versao: '9:6' })).toMatchObject({ tipo: 'recusado' });
  });
});

describe('frase de fechamento no estado', () => {
  const com = (fechamento: string | undefined, pontos: Parameters<typeof mesclar>[0]['proposta']['pontos']) =>
    mesclar({
      anterior: snapshotInicial('m-1', P, 0, 1),
      corte: 6,
      agora: 2,
      transcricao: TRANSCRICAO,
      proposta: { ...(fechamento ? { fechamento } : {}), pontos },
    }).snapshot;

  it('é guardada com a revisão quando ainda há algo sem fechar', () => {
    const s = com('Quem decide sobre os atendentes e até quando?', [{ id: id(P[1]!), estado: 'a_confirmar', falas: [2] }]);
    expect(s.fechamento).toEqual({ texto: 'Quem decide sobre os atendentes e até quando?', revisao: 6 });
  });

  it('não se guarda quando tudo está decidido com responsável e prazo, nem sem texto', () => {
    const tudo = mesclar({
      anterior: snapshotInicial('m-1', [P[2]!], 0, 1),
      corte: 6,
      agora: 2,
      transcricao: TRANSCRICAO,
      proposta: {
        fechamento: 'Mais alguma coisa?',
        pontos: [{ id: id(P[2]!), estado: 'decidido', falas: [3, 4], dono: 'Marta', prazo: 'sexta-feira' }],
      },
    }).snapshot;
    expect(tudo.fechamento).toBeUndefined();
    expect(com(undefined, [{ id: id(P[1]!), estado: 'a_confirmar', falas: [2] }]).fechamento).toBeUndefined();
  });
});
