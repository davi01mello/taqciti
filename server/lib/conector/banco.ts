/**
 * A conexão com o Postgres. Um pool por processo, criado na primeira
 * chamada.
 *
 * ── Por que preguiçoso, e não um `new Pool()` no topo do módulo ──────────
 *
 * Porque importar este arquivo não pode exigir banco. `lib/conector/` é
 * importado por testes que rodam contra `acervoDeMemoria` e nunca tocam o
 * Postgres; um pool no topo abriria socket (ou explodiria por falta de
 * `DATABASE_URL`) só de alguém importar um tipo daqui. Com a criação na
 * primeira chamada, quem não usa não paga.
 *
 * ── Uma instância, muitas pessoas ─────────────────────────────────────────
 *
 * O pool é do PROCESSO, não da pessoa. Todo acesso ao acervo passa por
 * `pessoa_id` no WHERE — é a única coisa que separa o acervo de um do acervo
 * de outro, e por isso `acervoPostgres.ts` recebe o `pessoaId` no construtor
 * e nenhuma consulta de lá o omite.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

/**
 * O mínimo que a camada de dados precisa de um driver.
 *
 * Existe para que `acervoPostgres.ts` e `escrita.ts` não dependam do pacote
 * `pg`, e o ganho é concreto: os testes rodam contra **PGlite** — o Postgres
 * de verdade compilado para WASM, dentro do processo, sem daemon nenhum. É
 * isso que faz o SQL ser verificado no `npm test` normal em vez de depender
 * de alguém lembrar de subir um contêiner.
 *
 * Os dois drivers não são idênticos, e a diferença que pega é esta:
 * `bigint` volta como **string** no `pg` (para não perder precisão acima de
 * 2^53) e como **number** no PGlite. Por isso todo epoch passa por `ms()`.
 */
export interface Consultador {
  query(
    texto: string,
    valores?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

let pool: Pool | null = null;

export function urlDoBanco(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL não está definida. No Railway ela vem do plugin de Postgres; ' +
        'em desenvolvimento, ver server/.env.example.',
    );
  }
  return url;
}

export function bancoConfigurado(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function banco(): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: urlDoBanco(),
    // O Postgres gerenciado do Railway fala TLS com certificado que a cadeia
    // padrão do Node não valida. `rejectUnauthorized: false` mantém a
    // conexão CIFRADA e dispensa a validação da cadeia — que é o que a
    // string de conexão do próprio Railway pressupõe. Em local (sem TLS)
    // isto é ignorado.
    ...(urlDoBanco().includes('localhost') || urlDoBanco().includes('127.0.0.1')
      ? {}
      : { ssl: { rejectUnauthorized: false } }),
    max: 5,
  });
  return pool;
}

/** Fecha o pool. Só os testes precisam disto — o servidor vive enquanto vive. */
export async function fecharBanco(): Promise<void> {
  if (!pool) return;
  const atual = pool;
  pool = null;
  await atual.end();
}

/**
 * Aplica `esquema.sql`. Idempotente: todo comando é `if not exists`.
 *
 * Chamado pelos testes de integração e disponível para um passo de deploy.
 * NÃO roda sozinho no boot do servidor: um processo que altera schema ao
 * subir é um processo que altera schema em toda réplica, ao mesmo tempo, na
 * hora do pico.
 */
export async function aplicarEsquema(): Promise<void> {
  const sql = readFileSync(join(process.cwd(), 'lib', 'conector', 'esquema.sql'), 'utf8');
  await banco().query(sql);
}
