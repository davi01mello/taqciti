/**
 * Quem é a pessoa, provado pelo Google.
 *
 * A extensão pede um `id_token` com `chrome.identity.launchWebAuthFlow`
 * (`src/shared/services/identidade.ts`, do lado dela) e manda esse token
 * junto de cada sincronização. Este módulo é o que transforma "um token
 * chegou" em "é a Ana, e o Google confirma".
 *
 * ── Por que ID TOKEN, e não token de acesso ────────────────────────────────
 *
 * A versão anterior verificava um token de ACESSO (obtido via
 * `chrome.identity.getAuthToken`). Um `id_token` — o formato do OpenID
 * Connect — é mais direto para isto: ele já É a identidade, num JWT, e não só
 * uma chave para *acessar* algo em nome de alguém. A troca aconteceu quando
 * o lado da extensão migrou de `getAuthToken` para `launchWebAuthFlow` (ver o
 * cabeçalho de lá) — os dois mecanismos entregam formatos diferentes, e este
 * arquivo tem que verificar o que chega de verdade.
 *
 * ── O erro que este arquivo existe para não cometer ───────────────────────
 *
 * O caminho curto seria confiar no `email` de dentro do JWT sem checar para
 * quem ele foi emitido — parece resolver, e está errado.
 *
 * Um `id_token` legítimo, emitido pelo Google para QUALQUER OUTRO aplicativo
 * que a pessoa tenha autorizado, decodifica igualzinho e mostra o e-mail
 * dela. Se este servidor aceitasse qualquer `id_token` válido sem checar o
 * `aud`, qualquer desenvolvedor cujo app a pessoa tenha autorizado poderia
 * pegar o token dela e apresentá-lo aqui — e este servidor entregaria o
 * acervo, porque o token é mesmo dela. É o problema do delegado confuso, e
 * ele não aparece em teste nenhum: o caminho feliz funciona perfeitamente.
 *
 * `tokeninfo?id_token=` devolve `aud` — o `client_id` para quem o token foi
 * emitido. É por isso que este módulo o usa e RECUSA qualquer token cujo
 * `aud` não seja o nosso. Sem essa checagem, a autenticação inteira é
 * decorativa.
 *
 * ── Falha fechada ─────────────────────────────────────────────────────────
 *
 * Sem `GOOGLE_OAUTH_WEB_CLIENT_ID` configurado não há com o que comparar o
 * `aud`, e "não sei comparar" não pode virar "então deixa passar". Recusa.
 */
import { createHash } from 'node:crypto';
import type { IdentidadeVerificada } from '@/lib/conector/pessoa';

/** A porta para a rede, injetada. Ver o cabeçalho de `providers/openai.ts`. */
export type Transporte = (url: string, init?: RequestInit) => Promise<Response>;

// O tipo mora em `conector/pessoa.ts`, com quem o CONSOME: é
// `garantirPessoa` que define de que identidade ela precisa, e este módulo
// se conforma a isso. Reexportado para quem verifica não precisar saber de
// onde o contrato veio.
export type { IdentidadeVerificada };

/** Recusa esperada: token inválido, expirado, de outro app, domínio errado. */
export class IdentidadeRecusada extends Error {}

const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';

/**
 * O `client_id` para o qual o token tem que ter sido emitido.
 *
 * É o do cliente OAuth tipo "Aplicativo da Web" que a extensão usa em
 * `launchWebAuthFlow` (`VITE_GOOGLE_OAUTH_WEB_CLIENT_ID` do lado dela) —
 * NÃO o cliente tipo "Extensão do Chrome" do manifesto, que só serve para o
 * Google Docs e nunca é verificado aqui. Os dois clientes são independentes
 * de propósito: ver o cabeçalho de `identidade.ts` na extensão.
 *
 * Entra pelo ambiente do servidor porque `aud` é comparado do lado que
 * confia, nunca do lado que apresenta.
 */
function clientIdEsperado(): string {
  const id = process.env.GOOGLE_OAUTH_WEB_CLIENT_ID?.trim();
  if (!id) {
    throw new IdentidadeRecusada(
      'Servidor sem GOOGLE_OAUTH_WEB_CLIENT_ID. Sem ele não há como conferir para quem ' +
        'o token do Google foi emitido, e um token de outro aplicativo passaria. ' +
        'Ver server/.env.example.',
    );
  }
  return id;
}

/**
 * O domínio exigido no e-mail, quando houver.
 *
 * `TAQCITI_DOMINIO_PERMITIDO=citi.org.br` restringe o produto ao CITi. Vazio
 * aceita qualquer conta Google verificada — o que é legítimo em
 * desenvolvimento e não é o que se quer em produção, por isso a ausência é
 * registrada e não silenciosa.
 */
function dominioPermitido(): string | null {
  return process.env.TAQCITI_DOMINIO_PERMITIDO?.trim().toLowerCase() || null;
}

/**
 * A forma do que o `tokeninfo` devolve para um `id_token`. Só o que nos
 * interessa.
 *
 * `exp` aqui é um INSTANTE (segundos desde epoch), não uma DURAÇÃO — essa é
 * a diferença que importa em relação ao `tokeninfo` de token de acesso, que
 * devolve `expires_in` (segundos restantes). Confundir os dois faria o
 * cálculo do cache achar que um token já vencido ainda vale décadas.
 */
interface RespostaDoTokeninfo {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  exp?: string | number;
  error?: string;
  error_description?: string;
}

/** `"true"` e `true` são as duas formas em que o Google manda isto. */
function ehVerdade(v: string | boolean | undefined): boolean {
  return v === true || v === 'true';
}

export interface OpcoesDeVerificacao {
  /** A porta para a rede. O padrão é o `fetch` global. */
  transporte?: Transporte;
}

/**
 * Confere um token de acesso do Google e devolve quem é.
 *
 * Lança `IdentidadeRecusada` para tudo que é recusa legítima — token velho,
 * de outro app, e-mail não verificado, domínio de fora. Quem chama trata isso
 * como 401, não como 500: não é defeito do servidor.
 */
export async function verificarTokenDoGoogle(
  token: string,
  opcoes: OpcoesDeVerificacao = {},
): Promise<IdentidadeVerificada> {
  return (await verificar(token, opcoes)).identidade;
}

/** O mesmo, mas devolvendo também quanto o token ainda vale — para o cache. */
async function verificar(
  token: string,
  opcoes: OpcoesDeVerificacao,
): Promise<{ identidade: IdentidadeVerificada; validadeMs: number }> {
  const esperado = clientIdEsperado();
  if (!token?.trim()) throw new IdentidadeRecusada('Token ausente.');

  const transporte = opcoes.transporte ?? fetch;
  // `id_token=`, não `access_token=` — é assim que `tokeninfo` verifica um
  // JWT do OpenID Connect (assinatura, `exp`, `aud`) em vez de consultar um
  // token de acesso opaco. Ele é curto-vivo e a chamada é HTTPS; ainda
  // assim, nada de logá-lo.
  const resposta = await transporte(`${TOKENINFO}?id_token=${encodeURIComponent(token)}`);

  if (!resposta.ok) {
    // 400 do tokeninfo é token inválido ou expirado — recusa, não falha.
    if (resposta.status === 400 || resposta.status === 401) {
      throw new IdentidadeRecusada('Token do Google inválido ou expirado.');
    }
    throw new Error(`tokeninfo respondeu ${resposta.status}.`);
  }

  const dados = (await resposta.json()) as RespostaDoTokeninfo;
  if (dados.error) throw new IdentidadeRecusada('Token do Google inválido ou expirado.');

  // ── A checagem que não pode faltar ──────────────────────────────────────
  if (dados.aud !== esperado) {
    throw new IdentidadeRecusada(
      'Este token foi emitido para outro aplicativo. Ver o cabeçalho de ' +
        'lib/identidade/google.ts.',
    );
  }

  if (!dados.sub) throw new IdentidadeRecusada('Resposta do Google sem `sub`.');

  const email = dados.email?.trim().toLowerCase();
  if (!email) {
    throw new IdentidadeRecusada(
      'Token sem e-mail. O escopo `email` precisa estar no manifesto da extensão.',
    );
  }
  // Conta cujo e-mail o Google não confirmou não vale como identidade: o
  // e-mail é o que liga a pessoa ao CITi.
  if (!ehVerdade(dados.email_verified)) {
    throw new IdentidadeRecusada('E-mail não verificado pelo Google.');
  }

  const dominio = dominioPermitido();
  if (dominio && !email.endsWith(`@${dominio}`)) {
    throw new IdentidadeRecusada(`O TaqCiti está restrito a contas @${dominio}.`);
  }

  return {
    identidade: { googleSub: dados.sub, email },
    validadeMs: validadeDoCache(dados.exp),
  };
}

// --------------------------------------------------------------- o cache

/**
 * Um token verificado não precisa ser reverificado a cada chamada.
 *
 * Sem cache, uma sincronização de trinta reuniões vira trinta idas ao Google:
 * lento, e sujeito a limite de taxa numa operação que o usuário percebe como
 * uma coisa só. Com cache, é uma.
 *
 * ── Os dois cuidados que fazem isto ser seguro ────────────────────────────
 *
 * 1. A chave é o HASH do token, nunca o token. Um heap dump, um log de
 *    depuração ou um inspetor aberto não podem virar credencial de ninguém.
 * 2. A validade do cache é limitada pelo `exp` do PRÓPRIO token, com uma
 *    margem. Guardar por mais tempo que o token vale transformaria "revoguei
 *    o acesso" em "continua entrando por mais uma hora".
 */
const TETO_DO_CACHE_MS = 5 * 60 * 1000;
const MARGEM_MS = 30 * 1000;

interface Lembrete {
  identidade: IdentidadeVerificada;
  valeAte: number;
}

const cache = new Map<string, Lembrete>();

function chave(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Esvazia o cache. Só os testes precisam — em produção ele expira sozinho. */
export function limparCacheDeIdentidade(): void {
  cache.clear();
}

export async function identidadeDoToken(
  token: string,
  opcoes: OpcoesDeVerificacao = {},
): Promise<IdentidadeVerificada> {
  const k = chave(token);
  const agora = Date.now();

  const lembrado = cache.get(k);
  if (lembrado && lembrado.valeAte > agora) return lembrado.identidade;

  const { identidade, validadeMs } = await verificar(token, opcoes);
  // Validade zero (token quase vencendo, vencido, ou `exp` ausente) significa
  // não guardar: é melhor pagar outra ida ao Google do que servir uma
  // identidade a partir de um token que já não vale.
  if (validadeMs > 0) cache.set(k, { identidade, valeAte: agora + validadeMs });

  // Um Map sem poda cresce com cada token distinto que já passou. A poda é
  // preguiçosa de propósito: sem temporizador, sem processo de fundo, e o
  // custo cai em quem já está pagando uma ida à rede.
  if (cache.size > 500) {
    for (const [outro, l] of cache) {
      if (l.valeAte <= agora) cache.delete(outro);
    }
  }

  return identidade;
}

/**
 * Quanto tempo um token ainda vale, para o cache não passar da conta.
 *
 * `exp` de um `id_token` é um INSTANTE (segundos desde epoch), não uma
 * duração — diferente do `expires_in` de um token de acesso. Por isso o
 * cálculo é `exp - agora`, não `exp` direto.
 */
export function validadeDoCache(exp: string | number | undefined): number {
  const segundosDesdeEpoch = typeof exp === 'string' ? Number.parseInt(exp, 10) : exp;
  if (!Number.isFinite(segundosDesdeEpoch)) return 0;
  const restanteMs = (segundosDesdeEpoch as number) * 1000 - Date.now();
  if (restanteMs <= 0) return 0;
  return Math.max(0, Math.min(TETO_DO_CACHE_MS, restanteMs - MARGEM_MS));
}
