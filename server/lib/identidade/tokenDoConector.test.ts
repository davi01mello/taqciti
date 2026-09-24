/**
 * Os tokens do conector, contra Postgres de verdade (PGlite — ver o cabeçalho
 * de `lib/conector/acervoPostgres.test.ts`).
 *
 * Dois testes carregam o peso, e os dois são sobre falhas que não fazem
 * barulho:
 *
 * - `o token em claro não fica no banco` — se ficasse, um vazamento do banco
 *   viraria acesso ao acervo de todo mundo, e nada no comportamento normal
 *   denunciaria isso.
 * - `não dá para revogar o token de outra pessoa` — um `pessoa_id` esquecido
 *   no WHERE deixaria qualquer um derrubar o acesso alheio sabendo só um id.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Consultador } from '@/lib/conector/banco';
import { garantirPessoa } from '@/lib/conector/pessoa';
import {
  criarTokenDoConector,
  hashDoToken,
  listarTokens,
  pessoaDoToken,
  revogarToken,
} from './tokenDoConector';

/** PGlite é em processo, mas a gravação de `usado_em` é disparada sem espera. */
async function ateQue(condicao: () => Promise<boolean>, tentativas = 50): Promise<boolean> {
  for (let i = 0; i < tentativas; i++) {
    if (await condicao()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

describe('token do conector', () => {
  let pglite: PGlite;
  let pool: Consultador;
  let ana: string;
  let bia: string;

  beforeAll(async () => {
    pglite = new PGlite();
    pool = pglite as unknown as Consultador;
    await pglite.exec(
      readFileSync(join(process.cwd(), 'lib', 'conector', 'esquema.sql'), 'utf8'),
    );
    ana = await garantirPessoa({ googleSub: 'sub-ana', email: 'ana@citi.org.br' }, pool);
    bia = await garantirPessoa({ googleSub: 'sub-bia', email: 'bia@citi.org.br' }, pool);
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('o token nasce reconhecível e resolve na pessoa', async () => {
    const { token } = await criarTokenDoConector(ana, 'Claude no desktop', pool);
    expect(token.startsWith('taqciti_')).toBe(true);
    // 32 bytes em base64url dão 43 caracteres, mais o prefixo.
    expect(token.length).toBe('taqciti_'.length + 43);
    expect(await pessoaDoToken(token, pool)).toBe(ana);
  });

  it('o token em claro não fica no banco', async () => {
    const { token } = await criarTokenDoConector(ana, undefined, pool);
    const { rows } = await pool.query('select hash from token_do_conector');
    const hashes = rows.map((r) => String(r.hash));
    expect(hashes).not.toContain(token);
    expect(hashes).toContain(hashDoToken(token));
  });

  it('dois tokens nunca saem iguais', async () => {
    const a = await criarTokenDoConector(ana, undefined, pool);
    const b = await criarTokenDoConector(ana, undefined, pool);
    expect(a.token).not.toBe(b.token);
  });

  it('token inventado, vazio ou sem o prefixo devolve null', async () => {
    expect(await pessoaDoToken('taqciti_naoexiste', pool)).toBeNull();
    expect(await pessoaDoToken('', pool)).toBeNull();
    expect(await pessoaDoToken('sem-prefixo-nenhum', pool)).toBeNull();
  });

  it('registra o último uso', async () => {
    const { token, id } = await criarTokenDoConector(ana, undefined, pool);
    expect(await pessoaDoToken(token, pool)).toBe(ana);
    const registrou = await ateQue(async () => {
      const { rows } = await pool.query('select usado_em from token_do_conector where id = $1', [
        id,
      ]);
      return rows[0]?.usado_em != null;
    });
    expect(registrou).toBe(true);
  });

  it('revogar derruba o acesso na hora', async () => {
    const { token, id } = await criarTokenDoConector(ana, undefined, pool);
    expect(await pessoaDoToken(token, pool)).toBe(ana);

    expect(await revogarToken(ana, id, pool)).toBe(true);
    expect(await pessoaDoToken(token, pool)).toBeNull();
  });

  it('revogar duas vezes não mente na segunda', async () => {
    const { id } = await criarTokenDoConector(ana, undefined, pool);
    expect(await revogarToken(ana, id, pool)).toBe(true);
    expect(await revogarToken(ana, id, pool)).toBe(false);
  });

  it('não dá para revogar o token de outra pessoa', async () => {
    const { token, id } = await criarTokenDoConector(ana, undefined, pool);
    // A Bia sabe o id — e mesmo assim não derruba.
    expect(await revogarToken(bia, id, pool)).toBe(false);
    expect(await pessoaDoToken(token, pool)).toBe(ana);
  });

  it('a listagem esquece o revogado e nunca mostra o token', async () => {
    const pool2 = pglite as unknown as Consultador;
    const carlos = await garantirPessoa(
      { googleSub: 'sub-carlos', email: 'carlos@citi.org.br' },
      pool2,
    );
    const { token } = await criarTokenDoConector(carlos, 'ChatGPT', pool2);
    const { id } = await criarTokenDoConector(carlos, 'Claude', pool2);
    await revogarToken(carlos, id, pool2);

    const lista = await listarTokens(carlos, pool2);
    expect(lista).toHaveLength(1);
    expect(lista[0]?.rotulo).toBe('ChatGPT');
    // Nem o token, nem o hash dele, aparecem no que a página vai desenhar.
    const serializado = JSON.stringify(lista);
    expect(serializado).not.toContain(token);
    expect(serializado).not.toContain(hashDoToken(token));
  });

  it('cada pessoa só vê os seus', async () => {
    const daBia = await listarTokens(bia, pool);
    expect(daBia).toEqual([]);
  });
});
