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
    ...(urlDoBanco().includes('localhost') || urlDoBanco().includes('127.0.0.1')
      ? {}
      : { ssl: opcoesDeTls() }),
    max: 5,
  });
  return pool;
}

/**
 * TLS com o banco gerenciado.
 *
 * O certificado da Supabase é assinado pela CA PRÓPRIA dela, que a cadeia
 * padrão do Node não conhece. Sem essa CA, a única forma de conectar é
 * `rejectUnauthorized: false`: a conexão continua CIFRADA, mas não AUTENTICA o
 * servidor — alguém no meio do caminho pode se passar pelo banco e colher a
 * senha da `DATABASE_URL` e o acervo inteiro.
 *
 * Com `DATABASE_CA` (o PEM de "SSL Configuration → Download certificate" no
 * painel da Supabase, colado inteiro na variável), a cadeia é validada de
 * verdade. Sem ela, fica o modo antigo, com um aviso no log a cada instância
 * — para a troca não depender de uma janela de deploy coordenada.
 */
function opcoesDeTls(): { ca?: string; rejectUnauthorized: boolean } {
  const ca = process.env.DATABASE_CA?.trim();
  if (ca) return { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  console.warn('[banco] DATABASE_CA ausente: TLS sem validação do certificado do servidor.');
  return { rejectUnauthorized: false };
}
