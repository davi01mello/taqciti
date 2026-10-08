/**
 * O laço ao vivo — gerador roteirizado, relógio controlado, storage real (mock).
 *
 * Seguram: sem perfil (ou "só quando eu chamar") o modelo não é chamado; a
 * avaliação respeita o orçamento; pausar silencia sem derrubar a captura; o que
 * já está na tela some quando a reunião acaba; resultado de tarefa antiga não é
 * publicado; falha do provedor é medida e não derruba nada; e cada chamada deixa
 * uma medição.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { salvarPerfil } from '@/features/conducao/store';
import type { AdaptadorDeModelo } from '@/features/taq/modelo';
import type { ResultadoDaAvaliacao, FalaDaReuniao } from './gerar';
import { falasConsolidadas, criarLaco, type EntradaDoLaco } from './laco';
import { CONFIGURACAO_DOS_MODOS } from './politica';
import { definirPausa, lerApoio, mudarEstado } from './store';

const ADAPTADOR = {} as AdaptadorDeModelo;
const REUNIAO = { id: 'm-1', titulo: 'Descoberta com a Prefeitura' };
const PERFIL = (modo: 'sob_demanda' | 'discreto' | 'participativo') => ({
  missao: 'Apoiar a descoberta.',
  observar: [],
  intervencao: { modo, estilo: '' },
  contexto: [],
  preferencias: [],
});

const falas = (n: number): FalaDaReuniao[] =>
  Array.from({ length: n }, (_, i) => ({ speaker: 'Ana', text: `Fala ${i}.`, startOffsetMs: i * 1000 }));

const entrada = (n: number, extra: Partial<EntradaDoLaco> = {}): EntradaDoLaco => ({
  reuniao: REUNIAO,
  falas: falas(n),
  encerrada: false,
  gravando: true,
  ...extra,
});

let relogio = 1_760_000_000_000;
const agora = () => relogio;

/** Gerador roteirizado: devolve, a cada chamada, a próxima resposta da fila. */
function gerador(respostas: Array<ResultadoDaAvaliacao | ((p: { falasConsolidadas: number }) => ResultadoDaAvaliacao)>) {
  const chamadas: number[] = [];
  const avaliar = async (p: { falasConsolidadas: number }) => {
    chamadas.push(p.falasConsolidadas);
    const proxima = respostas.shift() ?? { tipo: 'ok' as const, nova: null, retiradas: [], recusados: [] };
    return typeof proxima === 'function' ? proxima(p) : proxima;
  };
  return { avaliar: avaliar as never, chamadas };
}

const nova = (corte: number, ponto = 'Onde ocorre a espera') =>
  ({
    tipo: 'ok',
    nova: {
      reuniaoId: 'm-1',
      revisao: corte,
      tipo: 'pergunta',
      natureza: 'recomendacao',
      texto: 'Vale esclarecer onde o atendimento trava.',
      pergunta: 'Em que momento o atendimento costuma travar hoje?',
      motivo: 'O cliente propôs uma solução antes de descrever o problema.',
      ponto,
      evidencias: [{ segmento: corte - 1, trecho: 'Acho que precisamos de um aplicativo.' }],
    },
    retiradas: [],
    recusados: [],
    uso: { latenciaMs: 800, entrada: 1200, saida: 90 },
  }) satisfies ResultadoDaAvaliacao;

beforeEach(() => {
  installChromeStorageMock();
  relogio = 1_760_000_000_000;
});

describe('falasConsolidadas', () => {
  it('ao vivo, as duas últimas ainda podem ser revistas; encerrada, todas valem', () => {
    expect(falasConsolidadas(10, false)).toBe(8);
    expect(falasConsolidadas(1, false)).toBe(0);
    expect(falasConsolidadas(10, true)).toBe(10);
  });
});

describe('sem permissão da pessoa, silêncio e nenhuma chamada', () => {
  it('sem perfil de condução, o modelo não é chamado', async () => {
    const g = gerador([nova(18)]);
    const laco = criarLaco({ adaptador: ADAPTADOR, agora, avaliar: g.avaliar });
    await laco.aoMudar(entrada(20));
    expect(g.chamadas).toEqual([]);
    expect((await lerApoio()).sugestoes).toEqual([]);
  });

  it('com o modo "só quando eu chamar", o modelo não é chamado', async () => {
    await salvarPerfil(PERFIL('sob_demanda'), 0);
    const g = gerador([nova(18)]);
    const laco = criarLaco({ adaptador: ADAPTADOR, agora, avaliar: g.avaliar });
    await laco.aoMudar(entrada(20));
    expect(g.chamadas).toEqual([]);
  });

  it('pausado, silencia: nada é chamado e o que esperava para aparecer expira', async () => {
    await salvarPerfil(PERFIL('discreto'), 0);
    const g = gerador([nova(18)]);
    const laco = criarLaco({ adaptador: ADAPTADOR, agora, avaliar: g.avaliar });
    // Uma pendente nasce, depois a pessoa pausa antes de ela aparecer.
    const { registrarSugestao } = await import('./store');
    await registrarSugestao((nova(18) as { nova: Parameters<typeof registrarSugestao>[0] }).nova);
    await definirPausa('m-1', true);
    await laco.aoMudar(entrada(20));
    expect(g.chamadas).toEqual([]);
    expect((await lerApoio()).sugestoes[0]).toMatchObject({ estado: 'expirada', encerradaPor: 'politica' });
  });
});

describe('com perfil discreto', () => {
  it('avalia, grava a sugestão e a política a mostra (uma só)', async () => {
    await salvarPerfil(PERFIL('discreto'), 0);
    const g = gerador([nova(18)]);
    const laco = criarLaco({ adaptador: ADAPTADOR, agora, avaliar: g.avaliar });
    await laco.aoMudar(entrada(20));
    expect(g.chamadas).toEqual([18]);
    const { sugestoes, medicoes } = await lerApoio();
    expect(sugestoes).toHaveLength(1);
    expect(sugestoes[0]).toMatchObject({ estado: 'mostrada', ponto: 'Onde ocorre a espera' });
    expect(medicoes['m-1']).toMatchObject({
      avaliacoes: 1,
      sugestoesGeradas: 1,
      silencios: 0,
      latenciaTotalMs: 800,
      tokensEntrada: 1200,
      tokensSaida: 90,
    });
  });

  it('respeita o orçamento: nova avaliação só com tempo E fala nova', async () => {
    await salvarPerfil(PERFIL('discreto'), 0);
    const cfg = CONFIGURACAO_DOS_MODOS.discreto!;
    const g = gerador([nova(18)]);
    const laco = criarLaco({ adaptador: ADAPTADOR, agora, avaliar: g.avaliar });
    await laco.aoMudar(entrada(20));
    // Mais falas, mas cedo demais.
    await laco.aoMudar(entrada(30));
    expect(g.chamadas).toHaveLength(1);
    // Tempo passou, mas sem fala nova suficiente.
    relogio += cfg.intervaloEntreAvaliacoesMs;
    await laco.aoMudar(entrada(20));
    expect(g.chamadas).toHaveLength(1);
    // Tempo E falas novas.
    await laco.aoMudar(entrada(30));
    expect(g.chamadas).toHaveLength(2);
  });

  it('com a captura pausada o laço aplica a política mas não chama o modelo', async () => {
    await salvarPerfil(PERFIL('discreto'), 0);
    const g = gerador([nova(18)]);
    const laco = criarLaco({ adaptador: ADAPTADOR, agora, avaliar: g.avaliar });
    await laco.aoMudar(entrada(20, { gravando: false }));
    expect(g.chamadas).toEqual([]);
  });

  it('silêncio do modelo conta como silêncio e não cria nada', async () => {
    await salvarPerfil(PERFIL('discreto'), 0);
    const g = gerador([{ tipo: 'ok', nova: null, retiradas: [], recusados: [], uso: { latenciaMs: 500, entrada: 900, saida: 20 } }]);
    const laco = criarLaco({ adaptador: ADAPTADOR, agora, avaliar: g.avaliar });
    await laco.aoMudar(entrada(20));
    const { sugestoes, medicoes } = await lerApoio();
    expect(sugestoes).toEqual([]);
    expect(medicoes['m-1']).toMatchObject({ avaliacoes: 1, silencios: 1, sugestoesGeradas: 0 });
  });

  it('falha do provedor é medida e não derruba nada nem cria sugestão', async () => {
    await salvarPerfil(PERFIL('discreto'), 0);
    const g = gerador([{ tipo: 'erro', codigo: 'limite_do_provedor', mensagem: 'A cota acabou.' }]);
    const laco = criarLaco({ adaptador: ADAPTADOR, agora, avaliar: g.avaliar });
    await expect(laco.aoMudar(entrada(20))).resolves.toBeUndefined();
    const { sugestoes, medicoes } = await lerApoio();
    expect(sugestoes).toEqual([]);
    expect(medicoes['m-1']).toMatchObject({ avaliacoes: 1, erros: 1 });
  });

  it('exceção do gerador também não derruba o laço', async () => {
    await salvarPerfil(PERFIL('discreto'), 0);
    const laco = criarLaco({
      adaptador: ADAPTADOR,
      agora,
      avaliar: (async () => {
        throw new Error('boom');
      }) as never,
    });
    await expect(laco.aoMudar(entrada(20))).resolves.toBeUndefined();
    expect((await lerApoio()).medicoes['m-1']).toMatchObject({ erros: 1 });
  });

  it('a mesma pergunta não volta enquanto a anterior está na tela', async () => {
    await salvarPerfil(PERFIL('participativo'), 0);
    const cfg = CONFIGURACAO_DOS_MODOS.participativo!;
    const g = gerador([nova(18), nova(24)]);
    const laco = criarLaco({ adaptador: ADAPTADOR, agora, avaliar: g.avaliar });
    await laco.aoMudar(entrada(20));
    relogio += cfg.intervaloEntreAvaliacoesMs + cfg.intervaloEntreSugestoesMs;
    await laco.aoMudar(entrada(26));
    const { sugestoes } = await lerApoio();
    const mostradas = sugestoes.filter((s) => s.estado === 'mostrada');
    expect(mostradas).toHaveLength(1);
    expect(sugestoes.find((s) => s.estado === 'expirada')).toMatchObject({ encerradaPor: 'politica' });
  });

  it('a sugestão na tela sai sozinha quando a conversa foi longe demais', async () => {
    await salvarPerfil(PERFIL('discreto'), 0);
    const g = gerador([nova(18)]);
    const laco = criarLaco({ adaptador: ADAPTADOR, agora, avaliar: g.avaliar });
    await laco.aoMudar(entrada(20));
    expect((await lerApoio()).sugestoes[0]!.estado).toBe('mostrada');
    // A reunião segue: 34 falas depois, o cartão já não ajuda.
    await laco.aoMudar(entrada(52));
    const { sugestoes } = await lerApoio();
    expect(sugestoes.map((s) => s.estado)).toEqual(['expirada']);
    expect(sugestoes[0]!.encerradaPor).toBe('tempo');
  });

  it('sugestão que nasce atrasada (a conversa andou enquanto o modelo pensava) não aparece', async () => {
    await salvarPerfil(PERFIL('discreto'), 0);
    const laco: ReturnType<typeof criarLaco> = criarLaco({
      adaptador: ADAPTADOR,
      agora,
      avaliar: (async (p: { falasConsolidadas: number }) => {
        // A conversa anda enquanto o modelo pensa: o laço recebe a entrada nova.
        void laco.aoMudar(entrada(60));
        return nova(p.falasConsolidadas);
      }) as never,
    });
    await laco.aoMudar(entrada(20));
    await laco.cutucar();
    const { sugestoes } = await lerApoio();
    expect(sugestoes).toHaveLength(1);
    // Nasceu velha para o corte de agora: expirou sem nunca ter sido mostrada.
    expect(sugestoes[0]).toMatchObject({ estado: 'expirada', encerradaPor: 'tempo' });
    expect(sugestoes[0]!.mostradaEm).toBeUndefined();
  });
});

describe('tarefa antiga e fim da reunião', () => {
  it('resultado que chega depois de a reunião mudar não é publicado', async () => {
    await salvarPerfil(PERFIL('discreto'), 0);
    let liberar!: () => void;
    const segura = new Promise<void>((r) => (liberar = r));
    const laco = criarLaco({
      adaptador: ADAPTADOR,
      agora,
      avaliar: (async (p: { falasConsolidadas: number }) => {
        await segura;
        return nova(p.falasConsolidadas);
      }) as never,
    });
    const primeira = laco.aoMudar(entrada(20));
    await new Promise((r) => setTimeout(r, 20));
    // O laço passa para outra reunião antes de o modelo responder.
    laco.parar();
    liberar();
    await primeira;
    expect((await lerApoio()).sugestoes).toEqual([]);
  });

  it('reunião encerrada: o que estava na tela e o que esperava expiram, e nada é chamado', async () => {
    await salvarPerfil(PERFIL('discreto'), 0);
    const g = gerador([nova(18)]);
    const laco = criarLaco({ adaptador: ADAPTADOR, agora, avaliar: g.avaliar });
    await laco.aoMudar(entrada(20));
    expect((await lerApoio()).sugestoes[0]!.estado).toBe('mostrada');
    await laco.aoMudar(entrada(40, { encerrada: true }));
    expect(g.chamadas).toHaveLength(1);
    expect((await lerApoio()).sugestoes[0]).toMatchObject({ estado: 'expirada', encerradaPor: 'tempo' });
  });

  it('o que a pessoa já tinha usado não é tocado pelo fim da reunião', async () => {
    await salvarPerfil(PERFIL('discreto'), 0);
    const g = gerador([nova(18)]);
    const laco = criarLaco({ adaptador: ADAPTADOR, agora, avaliar: g.avaliar });
    await laco.aoMudar(entrada(20));
    const id = (await lerApoio()).sugestoes[0]!.id;
    await mudarEstado(id, 'usada', 'pessoa');
    await laco.aoMudar(entrada(40, { encerrada: true }));
    expect((await lerApoio()).sugestoes[0]!.estado).toBe('usada');
  });
});
