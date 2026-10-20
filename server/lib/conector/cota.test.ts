import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Consultador } from './banco';
import { geracaoDe, invalidarCabeca, lembrarCabeca, limparCabecas, semNovidade } from './cabeca';
import { apagarCopia, gravarCopia, lerCopias } from './copia';
import {
  DIAS_DA_LAPIDE,
  bancoCheio,
  cotaDaPessoaBytes,
  limiteDoBancoBytes,
  purgarLapides,
  reiniciarDisjuntor,
  tamanhoAtual,
  usoDaPessoa,
} from './cota';
import { gravarHistorico, validarHistorico } from './historico';
import { garantirPessoa } from './pessoa';
import { apagarPrint, gravarPrint, validarPrint } from './prints';

const CORRIDA = `q${Date.now()}`;
const MB = 1024 * 1024;

const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n)]);
const print = (id: string, n: number) => {
  const r = validarPrint({
    id,
    meetingId: 'r1',
    dataUrl: `data:image/jpeg;base64,${jpeg(n).toString('base64')}`,
    at: 1,
    largura: 1,
    altura: 1,
  });
  if (!r.ok) throw new Error(r.motivo);
  return r.item;
};

describe('o ambiente da cota', () => {
  const guardado = { ...process.env };
  afterEach(() => {
    process.env = { ...guardado };
  });

  it('os padrões: 25 MB por pessoa e 400 MB no banco', () => {
    delete process.env.TAQCITI_COTA_MB;
    delete process.env.TAQCITI_LIMITE_BANCO_MB;
    expect(cotaDaPessoaBytes()).toBe(25 * MB);
    expect(limiteDoBancoBytes()).toBe(400 * MB);
  });

  it('os limites são sempre inteiros (bytes), mesmo com megabytes fracionários', () => {
    process.env.TAQCITI_COTA_MB = '0.3';
    process.env.TAQCITI_LIMITE_BANCO_MB = '0.7';
    expect(Number.isInteger(cotaDaPessoaBytes())).toBe(true);
    expect(cotaDaPessoaBytes()).toBe(314572);
    expect(Number.isInteger(limiteDoBancoBytes())).toBe(true);
  });

  it('lê o ambiente, e um valor torto volta ao padrão em vez de virar zero', () => {
    process.env.TAQCITI_COTA_MB = '10';
    expect(cotaDaPessoaBytes()).toBe(10 * MB);
    for (const torto of ['abc', '0', '-5', '']) {
      process.env.TAQCITI_COTA_MB = torto;
      expect(cotaDaPessoaBytes()).toBe(25 * MB);
    }
  });
});

describe('cota, disjuntor e lápides no Postgres', () => {
  let pglite: PGlite;
  let pool: Consultador;
  const guardado = { ...process.env };

  beforeAll(async () => {
    pglite = new PGlite();
    pool = pglite as unknown as Consultador;
    await pglite.exec(readFileSync(join(process.cwd(), 'lib', 'conector', 'esquema.sql'), 'utf8'));
  });

  beforeEach(() => {
    reiniciarDisjuntor();
    limparCabecas();
  });

  afterEach(() => {
    process.env = { ...guardado };
  });

  afterAll(async () => {
    await pglite.close();
  });

  const pessoa = (nome: string) => garantirPessoa({ googleSub: `${CORRIDA}-${nome}`, email: `${nome}@citi.org.br` }, pool);

  it('o uso soma cópias, prints e histórico — e não conta lápides nem outras contas', async () => {
    const ana = await pessoa('uso-a');
    const bia = await pessoa('uso-b');
    expect(await usoDaPessoa(ana, pool)).toBe(0);

    await gravarCopia(ana, { id: 'd1', colecao: 'documento', corpo: { t: 'x'.repeat(1000) } }, pool);
    await gravarPrint(ana, print('p1', 5000), pool);
    const h = validarHistorico({
      id: 'dh',
      fontesIds: [],
      versoes: [{ revisao: 1, arvore: { revisao: 1, titulo: 'T', lacunas: [], blocos: [] }, criadaEm: 1, origem: 'geracao', problemas: 0 }],
    });
    if (!h.ok) throw new Error(h.motivo);
    await gravarHistorico(ana, h.item, pool);
    await gravarCopia(bia, { id: 'd1', colecao: 'documento', corpo: { t: 'y'.repeat(9999) } }, pool);

    const uso = await usoDaPessoa(ana, pool);
    expect(uso).toBeGreaterThan(1000 + 5000);
    expect(uso).toBeLessThan(1000 + 5004 + 400);

    await apagarCopia(ana, 'documento', 'd1', pool);
    await apagarPrint(ana, 'p1', pool);
    const depois = await usoDaPessoa(ana, pool);
    expect(depois).toBeLessThan(400); // sobrou só o histórico
    expect(await usoDaPessoa(bia, pool)).toBeGreaterThan(9999);
  });

  it('uma edição cobra só a diferença: tamanhoAtual devolve o que já existe', async () => {
    const ana = await pessoa('delta');
    expect(await tamanhoAtual('copia_local', ana, { colecao: 'nota', id: 'n1' }, pool)).toBe(0);
    await gravarCopia(ana, { id: 'n1', colecao: 'nota', corpo: { t: 'x'.repeat(500) } }, pool);
    const t = await tamanhoAtual('copia_local', ana, { colecao: 'nota', id: 'n1' }, pool);
    expect(t).toBeGreaterThan(500);
    // Outra coleção com o mesmo id é outro registro.
    expect(await tamanhoAtual('copia_local', ana, { colecao: 'documento', id: 'n1' }, pool)).toBe(0);
    // Lápide não ocupa.
    await apagarCopia(ana, 'nota', 'n1', pool);
    expect(await tamanhoAtual('copia_local', ana, { colecao: 'nota', id: 'n1' }, pool)).toBe(0);
  });

  describe('lápides', () => {
    it(`as de mais de ${DIAS_DA_LAPIDE} dias saem; as recentes e as vivas ficam`, async () => {
      const ana = await pessoa('lapide');
      await gravarCopia(ana, { id: 'viva', colecao: 'documento', corpo: { a: 1 } }, pool);
      await gravarCopia(ana, { id: 'velha', colecao: 'documento', corpo: { a: 1 } }, pool);
      await gravarCopia(ana, { id: 'recente', colecao: 'documento', corpo: { a: 1 } }, pool);
      await apagarCopia(ana, 'documento', 'velha', pool);
      await apagarCopia(ana, 'documento', 'recente', pool);
      await gravarPrint(ana, print('pvelho', 100), pool);
      await apagarPrint(ana, 'pvelho', pool);

      // Envelhece só as duas "velhas".
      await pglite.query(
        `update copia_local set atualizado_em = now() - interval '${DIAS_DA_LAPIDE + 1} days' where pessoa_id = $1 and id = 'velha'`,
        [ana],
      );
      await pglite.query(
        `update print_local set atualizado_em = now() - interval '${DIAS_DA_LAPIDE + 1} days' where pessoa_id = $1 and id = 'pvelho'`,
        [ana],
      );

      expect(await purgarLapides(ana, pool)).toBe(2);
      const ids = (await lerCopias(ana, 0, {}, pool)).itens.map((i) => i.id).sort();
      expect(ids).toEqual(['recente', 'viva']);
    });

    it('só mexe nas lápides da pessoa pedida', async () => {
      const ana = await pessoa('lap-a');
      const bia = await pessoa('lap-b');
      for (const p of [ana, bia]) {
        await gravarCopia(p, { id: 'x', colecao: 'nota', corpo: {} }, pool);
        await apagarCopia(p, 'nota', 'x', pool);
      }
      await pglite.query(`update copia_local set atualizado_em = now() - interval '200 days'`);
      expect(await purgarLapides(ana, pool)).toBe(1);
      expect(await purgarLapides(bia, pool)).toBe(1);
    });
  });

  describe('o disjuntor global', () => {
    it('fecha quando o banco passa do limite e reabre quando volta', async () => {
      process.env.TAQCITI_LIMITE_BANCO_MB = '0.001';
      expect(await bancoCheio(pool)).toBe(true);
      reiniciarDisjuntor();
      process.env.TAQCITI_LIMITE_BANCO_MB = '100000';
      expect(await bancoCheio(pool)).toBe(false);
    });

    it('reabre sozinho: a medida vence em um minuto, sem ninguém reiniciar nada', async () => {
      const agora = Date.now();
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(agora);
        process.env.TAQCITI_LIMITE_BANCO_MB = '0.001';
        expect(await bancoCheio(pool)).toBe(true);

        // O banco "esvaziou", mas dentro do minuto a instância ainda confia na medida.
        process.env.TAQCITI_LIMITE_BANCO_MB = '100000';
        vi.setSystemTime(agora + 30_000);
        expect(await bancoCheio(pool)).toBe(true);

        vi.setSystemTime(agora + 61_000);
        expect(await bancoCheio(pool)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
    it('mede no máximo uma vez por minuto', async () => {
      process.env.TAQCITI_LIMITE_BANCO_MB = '100000';
      let medidas = 0;
      const contador: Consultador = {
        query: (t, v) => {
          medidas += 1;
          return pglite.query(t, v as unknown[]) as never;
        },
      };
      await bancoCheio(contador);
      await bancoCheio(contador);
      await bancoCheio(contador);
      expect(medidas).toBe(1);
    });

    it('falha ABERTA: se não conseguir medir, não trava a sincronização', async () => {
      const quebrado: Consultador = { query: () => Promise.reject(new Error('sem catálogo')) };
      const silencio = console.error;
      console.error = () => {};
      try {
        expect(await bancoCheio(quebrado)).toBe(false);
      } finally {
        console.error = silencio;
      }
    });
  });

  describe('a cabeça do cursor (polling sem banco)', () => {
    /** Conta as consultas que chegam ao banco. */
    const contando = () => {
      const c = { n: 0 };
      const p: Consultador = {
        query: (t, v) => {
          c.n += 1;
          return pglite.query(t, v as unknown[]) as never;
        },
      };
      return { c, p };
    };

    it('depois de uma leitura vazia, a seguinte não toca no banco', async () => {
      const ana = await pessoa('cab-vazia');
      const { c, p } = contando();
      expect(await lerCopias(ana, 0, {}, p)).toEqual({ itens: [], proximo: 0, fim: true });
      const primeira = c.n;
      expect(primeira).toBeGreaterThan(0);
      for (let i = 0; i < 5; i++) expect(await lerCopias(ana, 0, {}, p)).toEqual({ itens: [], proximo: 0, fim: true });
      expect(c.n).toBe(primeira);
    });

    it('uma escrita da mesma instância invalida: a próxima leitura enxerga a novidade', async () => {
      const ana = await pessoa('cab-escrita');
      const { c, p } = contando();
      await lerCopias(ana, 0, {}, p);
      await gravarCopia(ana, { id: 'novo', colecao: 'nota', corpo: { a: 1 } }, p);
      const antes = c.n;
      const r = await lerCopias(ana, 0, {}, p);
      expect(r.itens.map((i) => i.id)).toEqual(['novo']);
      expect(c.n).toBeGreaterThan(antes);
    });

    it('cada conta tem a sua cabeça: o silêncio de uma não cala a outra', async () => {
      const ana = await pessoa('cab-a');
      const bia = await pessoa('cab-b');
      await lerCopias(ana, 0, {}, pool);
      await gravarCopia(bia, { id: 'b1', colecao: 'nota', corpo: {} }, pool);
      expect((await lerCopias(bia, 0, {}, pool)).itens).toHaveLength(1);
    });

    it('a corrida: uma escrita ENTRE a consulta e o registro impede de afirmar "nada de novo"', () => {
      const id = 'pessoa-corrida';
      const geracao = geracaoDe(id);
      // ... a consulta achou o banco vazio; antes de registrar, alguém escreve:
      invalidarCabeca(id);
      lembrarCabeca(id, 0, geracao);
      expect(semNovidade(id, 0)).toBe(false);
      // Sem escrita no meio, o registro vale.
      lembrarCabeca(id, 0, geracaoDe(id));
      expect(semNovidade(id, 0)).toBe(true);
    });

    it('só responde "nada de novo" para cursores que já alcançaram a cabeça', () => {
      lembrarCabeca('p', 10, geracaoDe('p'));
      expect(semNovidade('p', 10)).toBe(true);
      expect(semNovidade('p', 11)).toBe(true);
      expect(semNovidade('p', 9)).toBe(false);
    });
  });
});
