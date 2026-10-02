/**
 * O cliente das rotas do conector: criar, listar e revogar os tokens que a
 * Claude e o ChatGPT apresentam.
 *
 * Autenticação é o token do Google em `Authorization: Bearer`, e NÃO o
 * `x-docciti-key`: aquele segredo protege a cota de `/api/generate` (onde há
 * chave paga atrás) e viaja público dentro do bundle. Aqui a proteção é a
 * conta da pessoa, verificada contra o Google — somar o segredo por cima não
 * acrescentaria nada e criaria um modo de falhar a mais. Ver
 * `server/lib/identidade/rota.ts`.
 *
 * ── 401 é o único erro que vale tratar de forma especial ─────────────────
 *
 * Token do Google expira. Quando isso acontece o servidor devolve 401, e a
 * resposta certa NÃO é avisar a pessoa: é descartar o token do cache do
 * Chrome e pedir outro, silenciosamente. Sem isso, um token vencido viraria
 * uma falha permanente que nem reinstalar resolve, porque o cache é do
 * perfil do navegador.
 */
import { SERVER_BASE_URL } from '@/shared/config/serverConfig';
import { descartarToken, tokenDeIdentidade } from '@/shared/services/identidade';

export interface TokenDoConector {
  id: string;
  rotulo: string | null;
  criadoEm: string;
  usadoEm: string | null;
  /** Só vem de servidor anterior a revogar virar DELETE; o atual não manda. */
  revogadoEm?: string | null;
}

export interface TokenRecemCriado {
  id: string;
  /** Só existe nesta resposta. O servidor guarda o hash. */
  token: string;
  /** O endereço que se cola no cliente de MCP. */
  url: string;
}

export class ConectorIndisponivel extends Error {}

/**
 * Uma chamada autenticada, com uma única retentativa em 401.
 *
 * Uma, e não um laço: se o token recém-obtido também for recusado, o
 * problema não é validade — é configuração (cliente OAuth errado, domínio
 * barrado) e insistir só transformaria um erro claro numa espera.
 */
async function chamar(caminho: string, init: RequestInit = {}): Promise<Response> {
  const token = await tokenDeIdentidade(false);
  if (!token) {
    throw new ConectorIndisponivel(
      'Sincronização não está ligada, ou o Chrome não devolveu acesso à conta.',
    );
  }

  const pedir = (t: string) =>
    fetch(`${SERVER_BASE_URL}${caminho}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
        Authorization: `Bearer ${t}`,
      },
    });

  let resposta: Response;
  try {
    resposta = await pedir(token);
  } catch {
    // `fetch` que lança é rede/servidor fora, não resposta de erro.
    throw new ConectorIndisponivel('Não foi possível falar com o servidor do TaqCiti.');
  }

  if (resposta.status === 401) {
    await descartarToken();
    const novo = await tokenDeIdentidade(false);
    if (novo) {
      try {
        resposta = await pedir(novo);
      } catch {
        throw new ConectorIndisponivel('Não foi possível falar com o servidor do TaqCiti.');
      }
    }
  }

  return resposta;
}

/** Lê a mensagem que o servidor mandou, caindo para algo legível. */
async function erroDe(resposta: Response): Promise<string> {
  try {
    const corpo = (await resposta.json()) as { error?: unknown };
    if (typeof corpo.error === 'string' && corpo.error) return corpo.error;
  } catch {
    /* resposta sem JSON — cai no genérico. */
  }
  return `O servidor respondeu ${resposta.status}.`;
}

export interface EstadoNoServidor {
  email: string;
  tokens: TokenDoConector[];
}

export async function listarTokensDoConector(): Promise<EstadoNoServidor> {
  const resposta = await chamar('/api/conector/token');
  if (!resposta.ok) throw new ConectorIndisponivel(await erroDe(resposta));
  return (await resposta.json()) as EstadoNoServidor;
}

export async function criarTokenDoConector(rotulo?: string): Promise<TokenRecemCriado> {
  const resposta = await chamar('/api/conector/token', {
    method: 'POST',
    body: JSON.stringify({ rotulo }),
  });
  if (!resposta.ok) throw new ConectorIndisponivel(await erroDe(resposta));
  return (await resposta.json()) as TokenRecemCriado;
}

export async function revogarTokenDoConector(id: string): Promise<void> {
  const resposta = await chamar(`/api/conector/token?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!resposta.ok) throw new ConectorIndisponivel(await erroDe(resposta));
}
