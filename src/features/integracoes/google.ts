/**
 * O cliente HTTP das APIs do Google — um só, usado por e-mail, diretório e agenda.
 *
 * Três coisas que ele resolve num lugar e que cada API repetiria errado:
 *
 *   1. O TOKEN nunca sai daqui: entra no cabeçalho `Authorization` e não vai a
 *      log, a erro nem ao resultado.
 *   2. O 401 (token vencido no cache do Chrome) descarta o token e tenta de novo
 *      UMA vez: é recusa antes de qualquer efeito, então repetir é seguro. Rede,
 *      tempo esgotado e 5xx NUNCA são repetidos aqui.
 *   3. O DESFECHO: um 4xx diz "recusou, nada foi feito"; erro de rede, tempo
 *      esgotado e 5xx dizem "não sei". Quem escreve decide o que fazer com isso
 *      (ver `ErroDeIntegracao.desfechoIncerto`).
 *
 * As dependências (fetch, token, relógio) são trocáveis: os testes nunca falam
 * com o Google.
 */
import { ErroDeIntegracao } from './erros';
import { descartarToken, pedirToken } from './token';

export interface DependenciasDeRede {
  fetch: typeof fetch;
  token: (escopos: readonly string[], opcoes: { interativo: boolean }) => Promise<string>;
  descartar: (token: string) => Promise<void>;
  agora: () => number;
}

const padrao: DependenciasDeRede = {
  fetch: (...args) => fetch(...args),
  token: pedirToken,
  descartar: descartarToken,
  agora: () => Date.now(),
};

let atuais: DependenciasDeRede = padrao;

/** Troca as dependências (testes). Devolve o que restaura o padrão. */
export function trocarDependencias(parcial: Partial<DependenciasDeRede>): () => void {
  const anteriores = atuais;
  atuais = { ...atuais, ...parcial };
  return () => {
    atuais = anteriores;
  };
}

export function dependencias(): DependenciasDeRede {
  return atuais;
}

export const TEMPO_PADRAO_MS = 15_000;

export interface PedidoAoGoogle {
  url: string;
  metodo?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** JSON; vira o corpo. */
  corpo?: unknown;
  escopos: readonly string[];
  tempoMs?: number;
  /** Status que NÃO são erro para quem chama (ex.: 404 ao apagar o que já foi apagado). */
  aceitar?: readonly number[];
}

export interface RespostaDoGoogle<T> {
  status: number;
  dados: T;
}

function classificar(status: number): ErroDeIntegracao {
  if (status === 401)
    return new ErroDeIntegracao(
      'sem_autorizacao',
      'A autorização do Google venceu ou foi revogada. Conecte a conta de novo em Conexões.',
      status,
    );
  if (status === 403)
    return new ErroDeIntegracao(
      'recusado',
      'O Google recusou (403): a conta não tem essa permissão, ou a API não está ativada no projeto do Google Cloud.',
      status,
    );
  if (status === 429)
    return new ErroDeIntegracao('limite', 'O Google pediu para esperar (limite de uso). Tente em instantes.', status);
  if (status >= 500)
    return new ErroDeIntegracao('indisponivel', `O Google respondeu erro de servidor (${status}).`, status);
  return new ErroDeIntegracao('recusado', `O Google recusou o pedido (${status}).`, status);
}

async function umaTentativa<T>(p: PedidoAoGoogle, token: string): Promise<RespostaDoGoogle<T>> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), p.tempoMs ?? TEMPO_PADRAO_MS);
  let resposta: Response;
  try {
    resposta = await atuais.fetch(p.url, {
      method: p.metodo ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(p.corpo !== undefined ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}),
      },
      ...(p.corpo !== undefined ? { body: JSON.stringify(p.corpo) } : {}),
      signal: controle.signal,
    });
  } catch (e) {
    if (controle.signal.aborted || (e as { name?: string })?.name === 'AbortError')
      throw new ErroDeIntegracao('tempo_esgotado', 'O Google não respondeu a tempo.');
    throw new ErroDeIntegracao('sem_rede', 'Não foi possível falar com o Google.');
  } finally {
    clearTimeout(relogio);
  }

  if (!resposta.ok && !p.aceitar?.includes(resposta.status)) throw classificar(resposta.status);

  let dados: unknown = {};
  if (resposta.status !== 204) {
    try {
      const texto = await resposta.text();
      dados = texto ? JSON.parse(texto) : {};
    } catch {
      // Um 2xx sem JSON legível: a escrita pode ter acontecido.
      if (resposta.ok) throw new ErroDeIntegracao('resposta_invalida', 'A resposta do Google veio ilegível.');
    }
  }
  return { status: resposta.status, dados: dados as T };
}

export async function chamarGoogle<T = Record<string, unknown>>(p: PedidoAoGoogle): Promise<RespostaDoGoogle<T>> {
  // Sem tela de consentimento aqui: pedir permissão é da tela Conexões.
  let token = await atuais.token(p.escopos, { interativo: false });
  try {
    return await umaTentativa<T>(p, token);
  } catch (e) {
    // 401 é recusa ANTES de qualquer efeito: repetir com token novo é seguro
    // mesmo para uma escrita. Já 5xx, rede e tempo esgotado nunca se repetem aqui.
    if (e instanceof ErroDeIntegracao && e.http === 401) {
      await atuais.descartar(token);
      token = await atuais.token(p.escopos, { interativo: false });
      return umaTentativa<T>(p, token);
    }
    throw e;
  }
}
