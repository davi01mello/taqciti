/**
 * A guarda das rotas de IA: identidade do Google com cota por pessoa, e a ponte
 * do segredo antigo enquanto as extensões instaladas não atualizam.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { NextRequest, NextResponse } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Consultador } from './conector/banco';
import { garantirPessoa } from './conector/pessoa';

const doTeste = vi.hoisted(() => ({ pool: null as unknown as Consultador, pessoa: '' }));

vi.mock('./conector/banco', async (original) => ({
  ...(await original<typeof import('./conector/banco')>()),
  banco: () => doTeste.pool,
  bancoConfigurado: () => true,
}));

vi.mock('./identidade/rota', () => ({
  autenticar: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer bom'
      ? { ok: true, pessoaId: doTeste.pessoa, email: 'ana@citi.org.br' }
      : { ok: false, resposta: NextResponse.json({ error: 'recusado' }, { status: 401 }) },
}));

const { autorizarIa, registrarUsoDeIa } = await import('./guardaDeIa');

function pedido(cabecalhos: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '1000', ...cabecalhos },
    body: '{}',
  });
}

const ambiente = { ...process.env };

describe('autorizarIa', () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
    doTeste.pool = pglite as unknown as Consultador;
    await pglite.exec(readFileSync(join(process.cwd(), 'lib', 'conector', 'esquema.sql'), 'utf8'));
    doTeste.pessoa = await garantirPessoa({ googleSub: `guarda-${Date.now()}`, email: 'ana@citi.org.br' }, doTeste.pool);
  });

  afterAll(async () => {
    await pglite.close();
  });

  afterEach(() => {
    process.env = { ...ambiente };
  });

  it('com token do Google válido, passa e conta o uso do dia', async () => {
    const r = await autorizarIa(pedido({ authorization: 'Bearer bom' }), {});
    expect(r).toEqual({ ok: true, pessoaId: doTeste.pessoa });
    const uso = await registrarUsoDeIa(doTeste.pessoa, 0, doTeste.pool);
    expect(uso.chamadas).toBe(2);
    expect(uso.caracteres).toBe(1000);
  });

  it('token do Google recusado não cai para o segredo', async () => {
    process.env.DOCCITI_SHARED_KEY = 'segredo';
    const r = await autorizarIa(pedido({ authorization: 'Bearer ruim', 'x-docciti-key': 'segredo' }), {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.resposta.status).toBe(401);
  });

  it('passou da cota diária, 429', async () => {
    process.env.TAQCITI_IA_CHAMADAS_DIA = '1';
    const r = await autorizarIa(pedido({ authorization: 'Bearer bom' }), {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.resposta.status).toBe(429);
  });

  it('rota que não chama modelo não gasta cota', async () => {
    process.env.TAQCITI_IA_CHAMADAS_DIA = '1';
    const r = await autorizarIa(pedido({ authorization: 'Bearer bom' }), {}, { cobrar: false });
    expect(r.ok).toBe(true);
  });

  it('sem token, a ponte do segredo antigo vale enquanto não for desligada', async () => {
    process.env.DOCCITI_SHARED_KEY = 'segredo';
    expect((await autorizarIa(pedido({ 'x-docciti-key': 'segredo' }), {})).ok).toBe(true);
    expect((await autorizarIa(pedido({ 'x-docciti-key': 'errado' }), {})).ok).toBe(false);

    process.env.DOCCITI_CHAVE_LEGADA = 'recusar';
    const r = await autorizarIa(pedido({ 'x-docciti-key': 'segredo' }), {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.resposta.status).toBe(401);
  });
});
