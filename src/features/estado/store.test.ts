/**
 * O estado dos pontos — a mesclagem é pura, então testa-se sem storage nem modelo.
 *
 * Seguram cada garantia do código: estado só com fala que existe antes do corte,
 * trecho copiado da transcrição, "decidido" sem protocolo vazio, correção da
 * pessoa que só cede a fala posterior, reabertura de decisão com fala posterior,
 * dono e prazo ausentes continuam ausentes, ponto novo com fonte e teto.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import {
  MAX_PONTOS,
  corrigirPelaPessoa,
  corrigirPontoDaReuniao,
  idDoPontoDaPreparacao,
  lerEstados,
  mesclar,
  snapshotInicial,
  transacaoDoEstado,
  type AtualizacaoProposta,
  type FalaDaTranscricao,
} from './store';

const T = 1_760_000_000_000;

const TRANSCRICAO: FalaDaTranscricao[] = [
  { speaker: 'Ana', text: 'Hoje a ideia é entender como funciona o atendimento aí hoje.' },
  { speaker: 'Cliente', text: 'A gente tem muita reclamação, o povo demora demais.' },
  { speaker: 'Ana', text: 'Em que momento o atendimento costuma travar hoje?' },
  { speaker: 'Cliente', text: 'Na triagem. A fila da triagem passa de uma hora quase todo dia.' },
  { speaker: 'Ana', text: 'E isso acontece em quantos atendimentos, mais ou menos?' },
  { speaker: 'Cliente', text: 'Uns sessenta por cento, a gente nunca mediu direito, mas é o que a equipe sente.' },
  { speaker: 'Ana', text: 'Certo.' },
  { speaker: 'Cliente', text: 'A Marta consegue levantar esses dados até sexta-feira, pode ficar com ela.' },
  { speaker: 'Ana', text: 'Fechado então: a Marta levanta os dados até sexta-feira.' },
];

const PRIORIDADES = ['Onde ocorre a espera', 'Com que frequência', 'Quem levanta os dados e quando'];
const ESPERA = idDoPontoDaPreparacao('Onde ocorre a espera');
const FREQ = idDoPontoDaPreparacao('Com que frequência');
const DADOS = idDoPontoDaPreparacao('Quem levanta os dados e quando');

const base = (corte = 0) => snapshotInicial('m-1', PRIORIDADES, corte, T);
const aplicar = (proposta: AtualizacaoProposta, corte: number, anterior = base()) =>
  mesclar({ anterior, proposta, transcricao: TRANSCRICAO, corte, agora: T + 1 });

beforeEach(() => {
  installChromeStorageMock();
});

describe('snapshotInicial', () => {
  it('nasce com os pontos da preparação, todos "a esclarecer" e sem fonte', () => {
    const s = base();
    expect(s.pontos.map((p) => [p.texto, p.estado, p.origem, p.evidencias.length])).toEqual([
      ['Onde ocorre a espera', 'a_esclarecer', 'preparacao', 0],
      ['Com que frequência', 'a_esclarecer', 'preparacao', 0],
      ['Quem levanta os dados e quando', 'a_esclarecer', 'preparacao', 0],
    ]);
  });

  it('sem preparação, não há ponto inventado; repetidos entram uma vez', () => {
    expect(snapshotInicial('m-1', [], 0, T).pontos).toEqual([]);
    expect(snapshotInicial('m-1', ['Prazo', 'prazo!', '  '], 0, T).pontos).toHaveLength(1);
  });
});

describe('mesclar: fontes', () => {
  it('copia o trecho da transcrição e fixa a revisão do corte', () => {
    const r = aplicar({ pontos: [{ id: ESPERA, estado: 'discutido', falas: [3], nota: 'cliente disse "na triagem"' }] }, 6);
    const p = r.snapshot.pontos.find((x) => x.id === ESPERA)!;
    expect(p).toMatchObject({ estado: 'discutido', revisao: 6 });
    expect(p.evidencias).toEqual([{ segmento: 3, trecho: 'Na triagem. A fila da triagem passa de uma hora quase todo dia.' }]);
    expect(p.historico).toEqual([{ revisao: 6, estado: 'discutido', falas: [3], por: 'modelo' }]);
    expect(r.mudancas).toBe(1);
  });

  it('fala fora do corte (ainda não existia) é fonte inexistente: nada muda', () => {
    const r = aplicar({ pontos: [{ id: ESPERA, estado: 'decidido', falas: [8] }] }, 6);
    expect(r.snapshot.pontos.find((x) => x.id === ESPERA)!.estado).toBe('a_esclarecer');
    expect(r.recusados.join(' ')).toMatch(/fonte inexistente/);
    expect(r.mudancas).toBe(0);
  });

  it('qualquer estado além de "a esclarecer" exige fala que o sustente', () => {
    const r = aplicar({ pontos: [{ id: FREQ, estado: 'discutido', falas: [] }] }, 6);
    expect(r.snapshot.pontos.find((x) => x.id === FREQ)!.estado).toBe('a_esclarecer');
    expect(r.recusados.join(' ')).toMatch(/sem fala que o sustente/);
  });

  it('"decidido" não se apoia em fala protocolar ("Certo.")', () => {
    const r = aplicar({ pontos: [{ id: DADOS, estado: 'decidido', falas: [6] }] }, 7);
    expect(r.snapshot.pontos.find((x) => x.id === DADOS)!.estado).toBe('a_esclarecer');
    expect(r.recusados.join(' ')).toMatch(/sem fala com conteúdo/);
  });

  it('estado desconhecido e ponto desconhecido são recusados', () => {
    const r = aplicar(
      {
        pontos: [
          { id: ESPERA, estado: 'resolvido' as never, falas: [3] },
          { id: 'nao-existe', estado: 'discutido', falas: [3] },
        ],
      },
      6,
    );
    expect(r.mudancas).toBe(0);
    expect(r.recusados).toHaveLength(2);
  });
});

describe('mesclar: dono e prazo nunca são inventados', () => {
  it('ficam quando aparecem na fala citada; o nome do falante também vale para o dono', () => {
    const r = aplicar({ pontos: [{ id: DADOS, estado: 'decidido', falas: [7, 8], dono: 'Marta', prazo: 'sexta-feira' }] }, 9);
    expect(r.snapshot.pontos.find((x) => x.id === DADOS)).toMatchObject({ estado: 'decidido', dono: 'Marta', prazo: 'sexta-feira' });
    const falante = aplicar({ pontos: [{ id: DADOS, estado: 'a_confirmar', falas: [5], dono: 'Cliente' }] }, 9);
    expect(falante.snapshot.pontos.find((x) => x.id === DADOS)!.dono).toBe('Cliente');
  });

  it('nome ou prazo que a fala não traz continuam em aberto, e o resto da atualização vale', () => {
    const r = aplicar({ pontos: [{ id: FREQ, estado: 'discutido', falas: [5], dono: 'Carlos', prazo: 'amanhã' }] }, 6);
    const p = r.snapshot.pontos.find((x) => x.id === FREQ)!;
    expect(p.estado).toBe('discutido');
    expect(p.dono).toBeUndefined();
    expect(p.prazo).toBeUndefined();
    expect(r.recusados.join(' ')).toMatch(/Carlos.*não aparece/);
    expect(r.recusados.join(' ')).toMatch(/amanhã.*não aparece/);
  });
});

describe('mesclar: a pessoa e as reaberturas', () => {
  it('o que a pessoa corrigiu só muda por fala posterior à correção', () => {
    const s0 = aplicar({ pontos: [{ id: ESPERA, estado: 'discutido', falas: [3] }] }, 6).snapshot;
    const { snapshot: corrigido } = corrigirPelaPessoa(s0, ESPERA, 'decidido');
    expect(corrigido.pontos.find((x) => x.id === ESPERA)).toMatchObject({ estado: 'decidido', pessoaNaRevisao: 6 });
    // O modelo tenta voltar para "a esclarecer" sem fala nova: recusado.
    const sem = aplicar({ pontos: [{ id: ESPERA, estado: 'a_confirmar', falas: [3] }] }, 8, corrigido);
    expect(sem.snapshot.pontos.find((x) => x.id === ESPERA)!.estado).toBe('decidido');
    expect(sem.recusados.join(' ')).toMatch(/a pessoa corrigiu/);
    // Com fala posterior à correção, a mudança vale.
    const com = aplicar({ pontos: [{ id: ESPERA, estado: 'a_confirmar', falas: [7] }] }, 8, corrigido);
    expect(com.snapshot.pontos.find((x) => x.id === ESPERA)!.estado).toBe('a_confirmar');
  });

  it('um ponto decidido só é reaberto por fala posterior à decisão', () => {
    const decidido = aplicar({ pontos: [{ id: DADOS, estado: 'decidido', falas: [8] }] }, 9).snapshot;
    const antiga = aplicar({ pontos: [{ id: DADOS, estado: 'discutido', falas: [5] }] }, 9, decidido);
    expect(antiga.snapshot.pontos.find((x) => x.id === DADOS)!.estado).toBe('decidido');
    expect(antiga.recusados.join(' ')).toMatch(/reabrir um ponto decidido/);
  });

  it('reafirmar o mesmo estado não gera histórico nem conta como mudança', () => {
    const s1 = aplicar({ pontos: [{ id: ESPERA, estado: 'discutido', falas: [3] }] }, 6).snapshot;
    const r = aplicar({ pontos: [{ id: ESPERA, estado: 'discutido', falas: [3] }] }, 8, s1);
    expect(r.mudancas).toBe(0);
    expect(r.snapshot.pontos.find((x) => x.id === ESPERA)!.historico).toHaveLength(1);
  });

  it('corrigirPelaPessoa recusa estado ou ponto inexistente', () => {
    expect(corrigirPelaPessoa(base(), 'nao-existe', 'decidido').ok).toBe(false);
    expect(corrigirPelaPessoa(base(), ESPERA, 'resolvido' as never).ok).toBe(false);
  });
});

describe('mesclar: pontos novos e assunto', () => {
  it('ponto novo nasce da conversa, com fonte com conteúdo', () => {
    const r = aplicar({ pontos: [{ texto: 'Orçamento apertado', estado: 'a_confirmar', falas: [5] }] }, 6);
    const novo = r.snapshot.pontos.find((x) => x.origem === 'conversa')!;
    expect(novo).toMatchObject({ texto: 'Orçamento apertado', estado: 'a_confirmar' });
    expect(novo.id.startsWith('c:')).toBe(true);
  });

  it('ponto novo sem texto, sem fonte com conteúdo, ou além do teto não entra', () => {
    expect(aplicar({ pontos: [{ estado: 'discutido', falas: [5] }] }, 6).recusados.join(' ')).toMatch(/sem texto/);
    expect(aplicar({ pontos: [{ texto: 'X', estado: 'discutido', falas: [6] }] }, 7).recusados.join(' ')).toMatch(/sem fonte com conteúdo/);
    const cheio = snapshotInicial('m-1', Array.from({ length: MAX_PONTOS }, (_, i) => `Ponto ${i}`), 0, T);
    const r = aplicar({ pontos: [{ texto: 'Mais um', estado: 'discutido', falas: [5] }] }, 6, cheio);
    expect(r.snapshot.pontos).toHaveLength(MAX_PONTOS);
    expect(r.recusados.join(' ')).toMatch(/teto/);
  });

  it('o assunto atual é hipótese com fonte; sem fonte válida, não entra', () => {
    const ok = aplicar({ assunto: { texto: 'Frequência da espera', falas: [5] }, pontos: [] }, 6);
    expect(ok.snapshot.assunto).toMatchObject({ texto: 'Frequência da espera' });
    const ruim = aplicar({ assunto: { texto: 'Frequência', falas: [8] }, pontos: [] }, 6);
    expect(ruim.snapshot.assunto).toBeUndefined();
    expect(ruim.recusados.join(' ')).toMatch(/assunto atual sem fonte válida/);
  });

  it('a mesclagem não altera o snapshot anterior', () => {
    const antes = base();
    const copia = JSON.stringify(antes);
    aplicar({ pontos: [{ id: ESPERA, estado: 'discutido', falas: [3] }] }, 6, antes);
    expect(JSON.stringify(antes)).toBe(copia);
  });
});

describe('persistência', () => {
  it('grava e lê por reunião; a correção da pessoa persiste', async () => {
    await transacaoDoEstado((m) => {
      m['m-1'] = aplicar({ pontos: [{ id: ESPERA, estado: 'discutido', falas: [3] }] }, 6).snapshot;
      return { resultado: undefined, mudou: true };
    });
    expect(await corrigirPontoDaReuniao('m-1', ESPERA, 'adiado')).toBe(true);
    expect(await corrigirPontoDaReuniao('m-9', ESPERA, 'adiado')).toBe(false);
    const lido = (await lerEstados())['m-1']!;
    expect(lido.pontos.find((x) => x.id === ESPERA)).toMatchObject({ estado: 'adiado', pessoaNaRevisao: 6 });
  });

  it('dado estragado no storage é descartado, não quebra a leitura', async () => {
    await chrome.storage.local.set({ 'taq:estado': { 'm-1': { pontos: 'x' }, 'm-2': null, 'm-3': { revisao: 1, pontos: [{ id: 'a', estado: 'xx' }] } } });
    const lido = await lerEstados();
    expect(Object.keys(lido)).toEqual(['m-3']);
    expect(lido['m-3']!.pontos).toEqual([]);
  });
});
