/**
 * O segredo que a Claude e o ChatGPT apresentam para provar de quem é o
 * acervo.
 *
 * ── Por que não é o token do Google ───────────────────────────────────────
 *
 * Porque o token do Google é da EXTENSÃO: curto-vivo, renovado pelo Chrome,
 * e só existe dentro do navegador da pessoa. A Claude não tem como obtê-lo e
 * não deveria — ela é outro programa, num servidor de outra empresa.
 *
 * Então são duas credenciais para dois caminhos:
 *
 *   extensão → servidor   token do Google, verificado a cada uso
 *   Claude   → servidor   este token, criado pela pessoa, revogável
 *
 * ── Por que não OAuth ─────────────────────────────────────────────────────
 *
 * O jeito completo seria este servidor ser um servidor OAuth, com registro
 * dinâmico de cliente. É bastante máquina, e o requisito era "sem login". Um
 * token que a pessoa copia da página Conexões e cola ao adicionar o conector
 * faz o mesmo trabalho sem nenhuma tela de autenticação.
 *
 * O preço é honesto e vale estar escrito: é uma credencial ao portador. Quem
 * tiver a URL tem o acervo. As três coisas que tornam isso administrável
 * estão implementadas aqui — o token aparece UMA vez, o banco guarda só o
 * hash, e revogar é imediato.
 *
 * ── Hash, e por que não é bcrypt ──────────────────────────────────────────
 *
 * Senha precisa de hash lento porque é curta, escolhida por gente e
 * adivinhável. Isto é 256 bits de aleatoriedade de `randomBytes` — não há
 * dicionário, e força bruta contra SHA-256 sobre 2^256 não é uma ameaça que
 * um fator de trabalho melhore. O que importa é não guardar o original, e
 * comparar em tempo constante.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type Consultador, banco } from '@/lib/conector/banco';

/**
 * O prefixo existe para o token ser reconhecível fora de contexto — num
 * suporte, num log de alguém, numa captura de tela — e para um varredor de
 * segredo saber o que está olhando.
 */
const PREFIXO = 'taqciti_';

/** 32 bytes = 256 bits. Base64url para caber numa URL sem escapar nada. */
function sortearToken(): string {
  return PREFIXO + randomBytes(32).toString('base64url');
}

export function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface TokenCriado {
  /** O token em claro. É a ÚNICA vez que ele existe fora do navegador. */
  token: string;
  id: string;
}

/**
 * Cria um token para uma pessoa e devolve o valor em claro UMA vez.
 *
 * Quem chamar precisa entregá-lo à pessoa nessa mesma resposta: não há como
 * recuperá-lo depois, porque o banco só tem o hash. Perdeu, cria outro e
 * revoga o anterior.
 */
export async function criarTokenDoConector(
  pessoaId: string,
  rotulo?: string,
  pool: Consultador = banco(),
): Promise<TokenCriado> {
  const token = sortearToken();
  const { rows } = await pool.query(
    `insert into token_do_conector (pessoa_id, hash, rotulo)
     values ($1, $2, $3) returning id`,
    [pessoaId, hashDoToken(token), rotulo ?? null],
  );
  const id = rows[0]?.id;
  if (typeof id !== 'string') throw new Error('token_do_conector não devolveu id.');
  return { token, id };
}

/**
 * Resolve um token na pessoa dona dele, ou `null`.
 *
 * `null` e não exceção porque "token errado" é o caso comum de uma rota
 * pública: vira 401, não 500.
 *
 * A comparação é feita pelo banco, por igualdade de hash indexado — e isso
 * NÃO é um vazamento de tempo explorável, porque o que se compara já é a
 * saída do SHA-256. Um atacante não consegue caminhar byte a byte até o
 * token: ele teria que caminhar até o hash, e um hash parcialmente certo não
 * ajuda a construir a entrada que o produz. A comparação em tempo constante
 * abaixo é a do valor recalculado, por hábito e custo zero.
 */
export async function pessoaDoToken(
  token: string,
  pool: Consultador = banco(),
): Promise<string | null> {
  if (!token?.startsWith(PREFIXO)) return null;
  const hash = hashDoToken(token);

  const { rows } = await pool.query(
    `select pessoa_id, hash from token_do_conector
      where hash = $1 and revogado_em is null`,
    [hash],
  );
  const linha = rows[0];
  if (!linha) return null;

  const guardado = String(linha.hash);
  const a = Buffer.from(hash, 'utf8');
  const b = Buffer.from(guardado, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // `usado_em` alimenta a página Conexões ("último uso") e é o que permite
  // alguém notar um token que continua sendo usado depois de a pessoa achar
  // que tinha parado. Não bloqueia a resposta.
  void pool
    .query('update token_do_conector set usado_em = now() where hash = $1', [hash])
    .catch(() => {
      /* registrar o uso é conveniência; falhar nisso não pode negar acesso. */
    });

  return String(linha.pessoa_id);
}

export interface TokenListado {
  id: string;
  rotulo: string | null;
  criadoEm: string;
  usadoEm: string | null;
  revogadoEm: string | null;
}

/** O que a página Conexões mostra. Nunca o token — ele não existe mais aqui. */
export async function listarTokens(
  pessoaId: string,
  pool: Consultador = banco(),
): Promise<TokenListado[]> {
  const { rows } = await pool.query(
    `select id, rotulo, criado_em, usado_em, revogado_em
       from token_do_conector where pessoa_id = $1 order by criado_em desc`,
    [pessoaId],
  );
  return rows.map((l) => ({
    id: String(l.id),
    rotulo: l.rotulo === null || l.rotulo === undefined ? null : String(l.rotulo),
    criadoEm: new Date(l.criado_em as string).toISOString(),
    usadoEm: l.usado_em ? new Date(l.usado_em as string).toISOString() : null,
    revogadoEm: l.revogado_em ? new Date(l.revogado_em as string).toISOString() : null,
  }));
}

/**
 * Revoga um token. Idempotente, e devolve se algo mudou.
 *
 * `pessoa_id` no WHERE não é zelo: sem ele, saber o id de um token bastaria
 * para revogar o de outra pessoa.
 *
 * Marca em vez de apagar para a página poder mostrar "revogado em tal dia" —
 * um token que some sem deixar rastro é indistinguível de um que nunca
 * existiu, e é justamente no momento de desconfiança que se quer o histórico.
 */
export async function revogarToken(
  pessoaId: string,
  tokenId: string,
  pool: Consultador = banco(),
): Promise<boolean> {
  const { rows } = await pool.query(
    `update token_do_conector set revogado_em = now()
      where id = $1 and pessoa_id = $2 and revogado_em is null
      returning id`,
    [tokenId, pessoaId],
  );
  return rows.length > 0;
}
