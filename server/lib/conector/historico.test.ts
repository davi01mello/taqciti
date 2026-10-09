import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Consultador } from './banco';
import {
  MAX_VERSOES,
  apagarHistorico,
  gravarHistorico,
  lerHistorico,
  validarHistorico,
  type HistoricoDoDocumento,
} from './historico';
import { garantirPessoa } from './pessoa';

const CORRIDA = `h${Date.now()}`;

const arvore = (revisao: number, titulo = 'Proposta Aurora') => ({
  revisao,
  titulo,
  lacunas: [],
  blocos: [
    { tipo: 'capa', blockId: 'capa', titulo },
    { tipo: 'paragrafo', blockId: 'p1', texto: 'O gargalo é a integração.' },
  ],
});

const versao = (revisao: number, origem: 'geracao' | 'edicao' | 'restauracao' = 'edicao') => ({
  revisao,
  arvore: arvore(revisao),
  criadaEm: 1_790_000_000_000 + revisao,
  origem,
  pedido: `pedido ${revisao}`,
  manifesto: { revisaoDoConteudo: revisao, perfilId: 'citi', formatos: [{ formato: 'pdf', hash: 'a'.repeat(64) }] },
  problemas: 0,
});

const historico = (id = 'd1', revisoes = [1, 2]): unknown => ({
  id,
  variante: 'editorial',
  fontesIds: ['m1'],
  versoes: revisoes.map((r, i) => versao(r, i === 0 ? 'geracao' : 'edicao')),
});

const valido = (bruto: unknown): HistoricoDoDocumento => {
  const r = validarHistorico(bruto);
  if (!r.ok) throw new Error(r.motivo);
  return r.item;
};

describe('histórico dos documentos no servidor', () => {
  let pglite: PGlite;
  let pool: Consultador;
  let pessoaA: string;
  let pessoaB: string;

  beforeAll(async () => {
    pglite = new PGlite();
    pool = pglite as unknown as Consultador;
    const esquema = readFileSync(join(process.cwd(), 'lib', 'conector', 'esquema.sql'), 'utf8');
    await pglite.exec(esquema);
    // O esquema é aplicado inteiro, por cima de si mesmo: precisa ser idempotente.
    await pglite.exec(esquema);
    pessoaA = await garantirPessoa({ googleSub: `${CORRIDA}-a`, email: 'ana@citi.org.br' }, pool);
    pessoaB = await garantirPessoa({ googleSub: `${CORRIDA}-b`, email: 'bia@citi.org.br' }, pool);
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('grava e lê de volta: versões, variante, fontes e a revisão atual', async () => {
    await gravarHistorico(pessoaA, valido(historico('d1', [1, 2, 3])), pool);
    const lido = await lerHistorico(pessoaA, 'd1', pool);
    expect(lido).toMatchObject({ id: 'd1', variante: 'editorial', fontesIds: ['m1'], revisaoAtual: 3 });
    expect(lido!.versoes.map((v) => v.revisao)).toEqual([1, 2, 3]);
    expect(lido!.versoes[0]).toMatchObject({ origem: 'geracao', pedido: 'pedido 1' });
    expect(lido!.versoes[2]!.arvore.titulo).toBe('Proposta Aurora');
  });

  it('reenviar é upsert: substitui, não duplica', async () => {
    await gravarHistorico(pessoaA, valido(historico('d2', [1])), pool);
    await gravarHistorico(pessoaA, valido(historico('d2', [1, 2])), pool);
    const r = await pool.query('select count(*)::int as n from historico_do_documento where pessoa_id = $1 and id = $2', [pessoaA, 'd2']);
    expect((r.rows[0] as { n: number }).n).toBe(1);
    expect((await lerHistorico(pessoaA, 'd2', pool))!.revisaoAtual).toBe(2);
  });

  it('isolamento entre pessoas: o histórico de A não existe para B, e o mesmo id convive', async () => {
    await gravarHistorico(pessoaA, valido(historico('d3', [1])), pool);
    expect(await lerHistorico(pessoaB, 'd3', pool)).toBeNull();
    await gravarHistorico(pessoaB, valido(historico('d3', [1, 2, 3, 4])), pool);
    expect((await lerHistorico(pessoaA, 'd3', pool))!.revisaoAtual).toBe(1);
    expect((await lerHistorico(pessoaB, 'd3', pool))!.revisaoAtual).toBe(4);
    // Apagar o de B não toca o de A.
    await apagarHistorico(pessoaB, 'd3', pool);
    expect(await lerHistorico(pessoaB, 'd3', pool)).toBeNull();
    expect(await lerHistorico(pessoaA, 'd3', pool)).not.toBeNull();
  });

  it('apagar remove; apagar o que não existe é inofensivo', async () => {
    await gravarHistorico(pessoaA, valido(historico('d4', [1])), pool);
    await apagarHistorico(pessoaA, 'd4', pool);
    expect(await lerHistorico(pessoaA, 'd4', pool)).toBeNull();
    await expect(apagarHistorico(pessoaA, 'nao-existe', pool)).resolves.toBeUndefined();
  });

  it('apagar a pessoa leva o histórico junto (cascade)', async () => {
    const efemera = await garantirPessoa({ googleSub: `${CORRIDA}-c`, email: 'c@citi.org.br' }, pool);
    await gravarHistorico(efemera, valido(historico('d5', [1])), pool);
    await pool.query('delete from pessoa where id = $1', [efemera]);
    expect(await lerHistorico(efemera, 'd5', pool)).toBeNull();
  });

  it('a tabela tem RLS ligada, como as demais', async () => {
    const r = await pool.query("select relrowsecurity from pg_class where relname = 'historico_do_documento'");
    expect((r.rows[0] as { relrowsecurity: boolean }).relrowsecurity).toBe(true);
  });
});

describe('validarHistorico', () => {
  it('aceita o formato da extensão', () => {
    expect(validarHistorico(historico()).ok).toBe(true);
  });

  it.each([
    ['sem id', { ...(historico() as object), id: '' }],
    ['sem versões', { ...(historico() as object), versoes: [] }],
    ['árvore sem blocos válidos', { ...(historico() as { versoes: unknown[] }), versoes: [{ ...versao(1), arvore: { revisao: 1 } }] }],
    ['origem desconhecida', { ...(historico() as { versoes: unknown[] }), versoes: [{ ...versao(1), origem: 'magia' }] }],
    ['revisão repetida', { ...(historico() as object), versoes: [versao(2), versao(2)] }],
    ['revisão decrescente', { ...(historico() as object), versoes: [versao(3), versao(2)] }],
    ['lixo', 'não é objeto'],
  ])('recusa %s, com motivo e sem lançar', (_nome, bruto) => {
    const r = validarHistorico(bruto);
    expect(r.ok).toBe(false);
    expect((r as { motivo: string }).motivo).toContain('Histórico inválido');
  });

  it('recusa mais versões que o teto e histórico grande demais', () => {
    const muitas = { ...(historico() as object), versoes: Array.from({ length: MAX_VERSOES + 1 }, (_, i) => versao(i + 1)) };
    expect(validarHistorico(muitas).ok).toBe(false);

    const enorme = {
      ...(historico() as object),
      versoes: [{ ...versao(1), arvore: { ...arvore(1), blocos: [{ tipo: 'paragrafo', blockId: 'p', texto: 'x'.repeat(3.2 * 1024 * 1024) }] } }],
    };
    const r = validarHistorico(enorme);
    expect(r.ok).toBe(false);
    expect((r as { motivo: string }).motivo).toContain('acima de');
  });
});
