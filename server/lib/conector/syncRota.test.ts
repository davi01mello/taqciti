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
import { PGlite } from '@electric-sql/pglite';
import { NextRequest, NextResponse } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Consultador } from './banco';
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

  it('a máquina B recebe o que a máquina A mandou, com o registro inteiro', async () => {
    const r = await enviar(ana, {
      itens: [
        { tipo: 'reuniao', item: reuniaoDoConector('m1') },
        { tipo: 'copia', item: { id: 'm1', colecao: 'reuniao', corpo: reuniaoFiel('m1') } },
      ],
      apagados: [],
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ gravados: 2, apagados: 0 });

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
