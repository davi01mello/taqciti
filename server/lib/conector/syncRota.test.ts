/**
 * `/api/sync` de ponta a ponta: as rotas de verdade (POST e GET), sobre um
 * Postgres de verdade (PGlite). Só a identidade é trocada — o cabeçalho
 * `x-teste-pessoa` diz de quem é a chamada, no lugar do token do Google.
 *
 * É o teste do requisito "a conta traz o que é dela em qualquer máquina": a
 * máquina A manda, a máquina B (outra requisição, mesma conta) recebe, e a
 * conta C não vê nada.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { NextRequest, NextResponse } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Consultador } from './banco';
import { limparCabecas } from './cabeca';
import { reiniciarDisjuntor } from './cota';
import { garantirPessoa } from './pessoa';

const doTeste = vi.hoisted(() => ({ pool: null as unknown as Consultador }));

vi.mock('./banco', async (original) => ({
  ...(await original<typeof import('./banco')>()),
  banco: () => doTeste.pool,
  bancoConfigurado: () => true,
}));

vi.mock('@/lib/identidade/rota', () => ({
  autenticar: async (request: Request) => {
    const pessoaId = request.headers.get('x-teste-pessoa');
    return pessoaId
      ? { ok: true, pessoaId, email: 'x@citi.org.br' }
      : { ok: false, resposta: NextResponse.json({ error: 'sem token' }, { status: 401 }) };
  },
}));

const { GET, POST } = await import('@/app/api/sync/route');

const CORRIDA = `s${Date.now()}`;

function enviar(pessoa: string | null, corpo: unknown): Promise<NextResponse> {
  return POST(
    new NextRequest('http://localhost/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(pessoa ? { 'x-teste-pessoa': pessoa } : {}) },
      body: JSON.stringify(corpo),
    }),
  );
}

function receber(pessoa: string | null, desde?: string): Promise<NextResponse> {
  const qs = desde === undefined ? '' : `?desde=${desde}`;
  return GET(
    new NextRequest(`http://localhost/api/sync${qs}`, {
      headers: pessoa ? { 'x-teste-pessoa': pessoa } : {},
    }),
  );
}

const reuniaoDoConector = (id: string) => ({
  id,
  titulo: `Reunião ${id}`,
  inicioMs: 1,
  duracaoSegundos: 60,
  participantes: ['Ana'],
  falas: [{ falante: 'Ana', texto: 'olá', offsetMs: 0 }],
});

const reuniaoFiel = (id: string) => ({
  id,
  title: `Reunião ${id}`,
  startedAt: 1,
  endedAt: 61_000,
  durationSeconds: 60,
  participants: [{ name: 'Ana', isHost: true }],
  segments: [{ speaker: 'Ana', text: 'olá', startOffsetMs: 0, endOffsetMs: 900, captionId: 'c0' }],
  status: 'ready',
  metadata: { capturedCaptions: true, droppedSegments: 0 },
});

describe('/api/sync — ida e volta entre máquinas', () => {
  let pglite: PGlite;
  let ana: string;
  let bia: string;

  beforeAll(async () => {
    pglite = new PGlite();
    doTeste.pool = pglite as unknown as Consultador;
    await pglite.exec(readFileSync(join(process.cwd(), 'lib', 'conector', 'esquema.sql'), 'utf8'));
    ana = await garantirPessoa({ googleSub: `${CORRIDA}-a`, email: 'ana@citi.org.br' }, doTeste.pool);
    bia = await garantirPessoa({ googleSub: `${CORRIDA}-b`, email: 'bia@citi.org.br' }, doTeste.pool);
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('projeção fora do formato é recusada sem derrubar o lote, e id gigante em apagado é 400', async () => {
    const r = await enviar(ana, {
      itens: [
        { tipo: 'reuniao', item: { ...reuniaoDoConector('ok1') } },
        { tipo: 'reuniao', item: { ...reuniaoDoConector('ruim1'), falas: 'não é lista' } },
        { tipo: 'nota', item: { id: 'x'.repeat(500), reuniaoId: 'r', reuniaoTitulo: 't', texto: '', atualizadaMs: 1, marcacoes: {}, prints: 0 } },
      ],
      apagados: [],
    });
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { gravados: number; recusados: { tipo: string; motivo: string }[] };
    expect(corpo.gravados).toBe(1);
    expect(corpo.recusados).toHaveLength(2);
    expect(corpo.recusados.every((x) => x.motivo.startsWith('formato'))).toBe(true);

    const apagado = await enviar(ana, { itens: [], apagados: [{ tipo: 'reuniao', id: 'y'.repeat(500) }] });
    expect(apagado.status).toBe(400);
  });

  it('a máquina B recebe o que a máquina A mandou, com o registro inteiro', async () => {
    const r = await enviar(ana, {
      itens: [
        { tipo: 'reuniao', item: reuniaoDoConector('m1') },
        { tipo: 'copia', item: { id: 'm1', colecao: 'reuniao', corpo: reuniaoFiel('m1') } },
      ],
      apagados: [],
    });
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { gravados: number; apagados: number; uso: { bytes: number; cota: number } };
    expect(corpo).toMatchObject({ gravados: 2, apagados: 0 });
    // A resposta diz quanto da cota a conta ocupa (só a cópia fiel conta, não a projeção).
    expect(corpo.uso.bytes).toBeGreaterThan(0);
    expect(corpo.uso.cota).toBeGreaterThan(corpo.uso.bytes);

    // "Máquina B": outra requisição, sem nenhum estado compartilhado com a A.
    const volta = await receber(ana, '0');
    expect(volta.status).toBe(200);
    const pagina = (await volta.json()) as { itens: { colecao: string; id: string; corpo: unknown }[]; fim: boolean };
    expect(pagina.fim).toBe(true);
    expect(pagina.itens).toHaveLength(1); // a projeção do conector NÃO volta, só a cópia fiel
    expect(pagina.itens[0]).toMatchObject({ colecao: 'reuniao', id: 'm1', corpo: reuniaoFiel('m1') });
  });

  it('a outra conta não vê nada disso', async () => {
    const volta = await receber(bia, '0');
    expect(await volta.json()).toMatchObject({ itens: [], fim: true });
  });

  it('apagar na A chega à B como lápide', async () => {
    const primeira = (await (await receber(ana, '0')).json()) as { proximo: number };

    const r = await enviar(ana, { itens: [], apagados: [{ tipo: 'reuniao', id: 'm1' }] });
    expect(r.status).toBe(200);

    const volta = (await (await receber(ana, String(primeira.proximo))).json()) as {
      itens: { id: string; apagado: boolean; corpo: unknown }[];
    };
    expect(volta.itens).toEqual([expect.objectContaining({ id: 'm1', apagado: true, corpo: null })]);
  });

  it('uma cópia torta é recusada com motivo, sem derrubar o resto do lote', async () => {
    const r = await enviar(ana, {
      itens: [
        { tipo: 'copia', item: { id: 'ruim', colecao: 'prints', corpo: {} } },
        { tipo: 'copia', item: { id: 'boa', colecao: 'documento', corpo: { id: 'boa' } } },
      ],
      apagados: [],
    });
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { gravados: number; recusados: { id: string }[] };
    expect(corpo.gravados).toBe(1);
    expect(corpo.recusados.map((x) => x.id)).toEqual(['ruim']);
  });

  it('sem credencial, nem POST nem GET passam', async () => {
    expect((await enviar(null, { itens: [] })).status).toBe(401);
    expect((await receber(null, '0')).status).toBe(401);
  });

  it.each(['-1', 'abc', '1.5'])('recusa `desde=%s`', async (desde) => {
    expect((await receber(ana, desde)).status).toBe(400);
  });

  it('o GET nunca é cacheado', async () => {
    expect((await receber(ana, '0')).headers.get('cache-control')).toBe('no-store');
  });

  it('o preflight anuncia o GET', async () => {
    const { OPTIONS } = await import('@/app/api/sync/route');
    const r = OPTIONS(new NextRequest('http://localhost/api/sync', { method: 'OPTIONS' }));
    expect(r.headers.get('access-control-allow-methods')).toContain('GET');
  });
});

describe('o esquema novo sobre um banco que já tinha dados', () => {
  it('dá um seq a cada histórico que já existia, e todos diferentes', async () => {
    const velho = new PGlite();
    const esquema = readFileSync(join(process.cwd(), 'lib', 'conector', 'esquema.sql'), 'utf8');
    // O esquema ANTES desta funcionalidade: tudo até o marcador da cópia fiel.
    const marcador = esquema.indexOf('-- ------------------------------------------------- a cópia fiel');
    expect(marcador).toBeGreaterThan(0);
    await velho.exec(esquema.slice(0, marcador));

    const [{ id: pessoa }] = (await velho.query<{ id: string }>(
      `insert into pessoa (google_sub, email) values ('s', 'e@citi.org.br') returning id`,
    )).rows;
    for (const id of ['d1', 'd2', 'd3']) {
      await velho.query(
        `insert into historico_do_documento (pessoa_id, id, revisao_atual, atualizado_ms) values ($1, $2, 1, 1)`,
        [pessoa, id],
      );
    }

    await velho.exec(esquema);

    const { rows } = await velho.query<{ seq: string | number }>(
      'select seq from historico_do_documento order by id',
    );
    const seqs = rows.map((r) => Number(r.seq));
    expect(new Set(seqs).size).toBe(3);
    expect(seqs.every((s) => s > 0)).toBe(true);
    await velho.close();
  });
});

// ---------------------------------------------------------- prints e cotas

const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n)]);
const printDaExtensao = (id: string, n: number) => ({
  id,
  meetingId: 'r1',
  dataUrl: `data:image/jpeg;base64,${jpeg(n).toString('base64')}`,
  at: 1_790_000_000_000,
  largura: 1440,
  altura: 900,
});
const copiaDe = (id: string, texto: string, colecao = 'documento') => ({
  tipo: 'copia',
  item: { id, colecao, corpo: { id, texto } },
});

describe('/api/sync — prints e cotas', () => {
  let pglite: PGlite;
  let n = 0;
  const guardado = { ...process.env };
  /** Uma conta nova por teste: a cota é por conta, e o banco é compartilhado. */
  const conta = () => garantirPessoa({ googleSub: `${CORRIDA}-cota-${++n}`, email: `c${n}@citi.org.br` }, doTeste.pool);

  beforeAll(async () => {
    pglite = new PGlite();
    doTeste.pool = pglite as unknown as Consultador;
    await pglite.exec(readFileSync(join(process.cwd(), 'lib', 'conector', 'esquema.sql'), 'utf8'));
  });

  beforeEach(() => {
    limparCabecas();
    reiniciarDisjuntor();
  });

  afterEach(() => {
    process.env = { ...guardado };
  });

  afterAll(async () => {
    await pglite.close();
  });

  type Corpo = {
    gravados: number;
    uso?: { bytes: number; cota: number };
    recusados?: { tipo: string; id: string; motivo: string; chave?: string; temporario?: boolean }[];
  };
  const mandar = async (pessoa: string, corpo: unknown) => ({ status: (await enviar(pessoa, corpo)).status });
  const mandarLendo = async (pessoa: string, corpo: unknown) => {
    const r = await enviar(pessoa, corpo);
    return { status: r.status, corpo: (await r.json()) as Corpo };
  };

  it('um print sobe como imagem e volta byte a byte, para outra máquina da conta', async () => {
    const pessoa = await conta();
    const p = printDaExtensao('foto1', 30_000);
    const r = await mandarLendo(pessoa, { itens: [{ tipo: 'print', item: p }] });
    expect(r.corpo).toMatchObject({ gravados: 1 });

    const pagina = (await (await receber(pessoa, '0')).json()) as { itens: { colecao: string; corpo: unknown }[] };
    expect(pagina.itens).toHaveLength(1);
    expect(pagina.itens[0]).toMatchObject({ colecao: 'print', corpo: p });
  });

  it('apagar um print chega como lápide', async () => {
    const pessoa = await conta();
    await enviar(pessoa, { itens: [{ tipo: 'print', item: printDaExtensao('foto2', 1000) }] });
    const antes = (await (await receber(pessoa, '0')).json()) as { proximo: number };
    expect((await mandar(pessoa, { itens: [], apagados: [{ tipo: 'print', id: 'foto2' }] })).status).toBe(200);
    const depois = (await (await receber(pessoa, String(antes.proximo))).json()) as { itens: { id: string; apagado: boolean }[] };
    expect(depois.itens).toEqual([expect.objectContaining({ id: 'foto2', apagado: true })]);
  });

  it('uma imagem que não é imagem é recusada com motivo, sem derrubar o resto', async () => {
    const pessoa = await conta();
    const r = await mandarLendo(pessoa, {
      itens: [
        { tipo: 'print', item: { ...printDaExtensao('lixo', 10), dataUrl: 'data:image/jpeg;base64,aGVsbG8=' } },
        copiaDe('ok', 'texto'),
      ],
    });
    expect(r.corpo.gravados).toBe(1);
    expect(r.corpo.recusados).toEqual([expect.objectContaining({ tipo: 'print', id: 'lixo' })]);
    // Recusa por formato é definitiva: nada de `temporario`.
    expect(r.corpo.recusados![0]!.temporario).toBeUndefined();
  });

  describe('a cota por pessoa', () => {
    it('recusa o que passa do teto, TEMPORARIAMENTE, dizendo a chave para a extensão não dar como enviado', async () => {
      process.env.TAQCITI_COTA_MB = '0.01'; // ~10 KB
      const pessoa = await conta();
      const r = await mandarLendo(pessoa, {
        itens: [copiaDe('a', 'x'.repeat(4000)), copiaDe('b', 'y'.repeat(4000)), copiaDe('c', 'z'.repeat(4000))],
      });
      expect(r.corpo.gravados).toBe(2);
      expect(r.corpo.recusados).toEqual([
        expect.objectContaining({ tipo: 'copia', id: 'c', chave: 'documento:c', temporario: true, motivo: expect.stringContaining('cota') }),
      ]);
      expect(r.corpo.uso!.bytes).toBeLessThanOrEqual(r.corpo.uso!.cota);
      // O recusado NÃO foi gravado.
      const ids = ((await (await receber(pessoa, '0')).json()) as { itens: { id: string }[] }).itens.map((i) => i.id);
      expect(ids).toEqual(['a', 'b']);
    });

    it('a imagem entra na conta pelo tamanho dela', async () => {
      process.env.TAQCITI_COTA_MB = '0.05'; // ~50 KB
      const pessoa = await conta();
      const r = await mandarLendo(pessoa, {
        itens: [
          { tipo: 'print', item: printDaExtensao('cabe', 20_000) },
          { tipo: 'print', item: printDaExtensao('nao-cabe', 40_000) },
        ],
      });
      expect(r.corpo.gravados).toBe(1);
      expect(r.corpo.recusados).toEqual([expect.objectContaining({ chave: 'print:nao-cabe', temporario: true })]);
    });

    it('editar perto do teto só cobra a diferença: reescrever o mesmo tamanho passa', async () => {
      process.env.TAQCITI_COTA_MB = '0.01';
      const pessoa = await conta();
      expect((await mandarLendo(pessoa, { itens: [copiaDe('doc', 'x'.repeat(8000))] })).corpo.gravados).toBe(1);
      // Está a ~80% do teto; reescrever com outro texto do MESMO tamanho não pode ser barrado.
      const r = await mandarLendo(pessoa, { itens: [copiaDe('doc', 'y'.repeat(8000))] });
      expect(r.corpo.gravados).toBe(1);
      expect(r.corpo.recusados).toBeUndefined();
      // Já crescer 5 KB passa do teto.
      const cresceu = await mandarLendo(pessoa, { itens: [copiaDe('doc', 'z'.repeat(13_000))] });
      expect(cresceu.corpo.recusados).toEqual([expect.objectContaining({ temporario: true })]);
    });

    it('apagar SEMPRE passa, e libera espaço para o que foi recusado', async () => {
      process.env.TAQCITI_COTA_MB = '0.01';
      const pessoa = await conta();
      await enviar(pessoa, { itens: [copiaDe('grande', 'x'.repeat(9000))] });
      const cheio = await mandarLendo(pessoa, { itens: [copiaDe('novo', 'y'.repeat(4000))] });
      expect(cheio.corpo.recusados).toHaveLength(1);

      expect((await mandar(pessoa, { itens: [], apagados: [{ tipo: 'documento', id: 'grande' }] })).status).toBe(200);
      const livre = await mandarLendo(pessoa, { itens: [copiaDe('novo', 'y'.repeat(4000))] });
      expect(livre.corpo.gravados).toBe(1);
      expect(livre.corpo.recusados).toBeUndefined();
    });

    it('apagar e mandar no MESMO lote: o espaço liberado vale para o que entra', async () => {
      process.env.TAQCITI_COTA_MB = '0.01';
      const pessoa = await conta();
      await enviar(pessoa, { itens: [copiaDe('velho', 'x'.repeat(9000))] });
      // Cheia: nova cópia de 9 KB não caberia sem apagar a velha...
      expect((await mandarLendo(pessoa, { itens: [copiaDe('novo', 'y'.repeat(9000))] })).corpo.recusados).toHaveLength(1);
      // ...e cabe quando a exclusão da velha viaja junto.
      const r = await mandarLendo(pessoa, {
        itens: [copiaDe('novo', 'y'.repeat(9000))],
        apagados: [{ tipo: 'documento', id: 'velho' }],
      });
      expect(r.corpo.gravados).toBe(1);
      expect(r.corpo.recusados).toBeUndefined();
      const ids = ((await (await receber(pessoa, '0')).json()) as { itens: { id: string; apagado: boolean }[] }).itens;
      expect(ids.find((i) => i.id === 'novo')).toMatchObject({ apagado: false });
      expect(ids.find((i) => i.id === 'velho')).toMatchObject({ apagado: true });
    });
    it('a cota é por conta: a cheia de uma não barra a outra', async () => {
      process.env.TAQCITI_COTA_MB = '0.01';
      const a = await conta();
      const b = await conta();
      await enviar(a, { itens: [copiaDe('x', 'x'.repeat(9500))] });
      expect((await mandarLendo(a, { itens: [copiaDe('y', 'y'.repeat(4000))] })).corpo.recusados).toHaveLength(1);
      expect((await mandarLendo(b, { itens: [copiaDe('y', 'y'.repeat(4000))] })).corpo.gravados).toBe(1);
    });

    it('a projeção do conector não paga cota: só a cópia, o print e o histórico', async () => {
      process.env.TAQCITI_COTA_MB = '0.001';
      const pessoa = await conta();
      const r = await mandarLendo(pessoa, {
        itens: [
          {
            tipo: 'documento',
            item: { id: 'dp', titulo: 't', texto: 'x'.repeat(20_000), criadoMs: 1, atualizadoMs: 1 },
          },
        ],
      });
      expect(r.corpo).toMatchObject({ gravados: 1 });
      expect(r.corpo.uso).toBeUndefined();
    });
  });

  describe('o disjuntor global', () => {
    it('com o banco cheio, escritas novas são recusadas (temporariamente) e exclusões passam', async () => {
      const pessoa = await conta();
      await enviar(pessoa, { itens: [copiaDe('antes', 'x'.repeat(100))] });

      process.env.TAQCITI_LIMITE_BANCO_MB = '0.001';
      reiniciarDisjuntor();
      const r = await mandarLendo(pessoa, { itens: [copiaDe('depois', 'y'.repeat(100))] });
      expect(r.corpo.gravados).toBe(0);
      expect(r.corpo.recusados).toEqual([
        expect.objectContaining({ chave: 'documento:depois', temporario: true, motivo: expect.stringContaining('cota-global') }),
      ]);

      // Excluir é o que o libera para voltar a caber.
      expect((await mandar(pessoa, { itens: [], apagados: [{ tipo: 'documento', id: 'antes' }] })).status).toBe(200);

      // Voltou ao normal: aceita.
      process.env.TAQCITI_LIMITE_BANCO_MB = '100000';
      reiniciarDisjuntor();
      expect((await mandarLendo(pessoa, { itens: [copiaDe('depois', 'y'.repeat(100))] })).corpo.gravados).toBe(1);
    });

    it('reescrever algo que não cresce passa mesmo com o banco cheio', async () => {
      const pessoa = await conta();
      await enviar(pessoa, { itens: [copiaDe('igual', 'x'.repeat(500))] });
      process.env.TAQCITI_LIMITE_BANCO_MB = '0.001';
      reiniciarDisjuntor();
      const r = await mandarLendo(pessoa, { itens: [copiaDe('igual', 'y'.repeat(500))] });
      expect(r.corpo.gravados).toBe(1);
    });
  });

  it('o polling sem novidade não chega ao banco, e uma escrita o acorda', async () => {
    const pessoa = await conta();
    expect(await (await receber(pessoa, '0')).json()).toMatchObject({ itens: [], fim: true });
    expect(await (await receber(pessoa, '0')).json()).toMatchObject({ itens: [], fim: true });
    await enviar(pessoa, { itens: [copiaDe('chegou', 'x')] });
    const r = (await (await receber(pessoa, '0')).json()) as { itens: { id: string }[] };
    expect(r.itens.map((i) => i.id)).toEqual(['chegou']);
  });
});