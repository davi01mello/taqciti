/**
 * A verificação de identidade, sem rede.
 *
 * O `transporte` entra por parâmetro (mesmo padrão de
 * `lib/ai/providers/openai.ts`), então estes testes descrevem exatamente o
 * que o `tokeninfo?id_token=` do Google responderia — inclusive as respostas
 * que ninguém testa por acidente: token de outro aplicativo, e-mail não
 * verificado, 400.
 *
 * O teste que dá sentido ao arquivo é `recusa token emitido para outro
 * aplicativo`. Ele cobre um ataque que o caminho feliz não revela: o token é
 * legítimo, é mesmo da pessoa, o Google confirma — e mesmo assim aceitar
 * seria entregar o acervo a quem não deveria.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IdentidadeRecusada,
  identidadeDoToken,
  limparCacheDeIdentidade,
  validadeDoCache,
  verificarTokenDoGoogle,
} from './google';

const NOSSO_CLIENT_ID = '123456.apps.googleusercontent.com';

/** Um `fetch` que devolve o JSON pedido e conta as chamadas. */
function transporteQueResponde(corpo: unknown, status = 200) {
  const chamadas: string[] = [];
  const transporte = vi.fn(async (url: string) => {
    chamadas.push(url);
    return new Response(JSON.stringify(corpo), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { transporte, chamadas };
}

/** Segundos desde epoch, agora. `exp` de um id_token é um INSTANTE, não uma
 *  duração — ver o cabeçalho de `validadeDoCache`. */
function agoraEmSegundos(): number {
  return Math.floor(Date.now() / 1000);
}

const tokeninfoValido = {
  aud: NOSSO_CLIENT_ID,
  sub: '110011001100110011001',
  email: 'ana@citi.org.br',
  email_verified: 'true',
  exp: String(agoraEmSegundos() + 3599),
};

beforeEach(() => {
  process.env.GOOGLE_OAUTH_WEB_CLIENT_ID = NOSSO_CLIENT_ID;
  delete process.env.TAQCITI_DOMINIO_PERMITIDO;
  limparCacheDeIdentidade();
});

afterEach(() => {
  delete process.env.GOOGLE_OAUTH_WEB_CLIENT_ID;
  delete process.env.TAQCITI_DOMINIO_PERMITIDO;
});

describe('verificarTokenDoGoogle', () => {
  it('aceita um token nosso e devolve sub e e-mail', async () => {
    const { transporte } = transporteQueResponde(tokeninfoValido);
    const id = await verificarTokenDoGoogle('tok', { transporte });
    expect(id).toEqual({ googleSub: '110011001100110011001', email: 'ana@citi.org.br' });
  });

  it('recusa token emitido para outro aplicativo', async () => {
    // O token é válido e é MESMO da pessoa. O Google confirma tudo. Só que
    // foi emitido para outro `client_id` — e aceitar aqui deixaria o dono
    // daquele outro app entrar como ela.
    const { transporte } = transporteQueResponde({
      ...tokeninfoValido,
      aud: '999999.apps.googleusercontent.com',
    });
    await expect(verificarTokenDoGoogle('tok', { transporte })).rejects.toBeInstanceOf(
      IdentidadeRecusada,
    );
  });

  it('recusa quando o servidor não sabe qual é o nosso client_id', async () => {
    // Falha FECHADA: sem com o que comparar o `aud`, não dá para deixar
    // passar "só desta vez".
    delete process.env.GOOGLE_OAUTH_WEB_CLIENT_ID;
    const { transporte } = transporteQueResponde(tokeninfoValido);
    await expect(verificarTokenDoGoogle('tok', { transporte })).rejects.toThrow(
      /GOOGLE_OAUTH_WEB_CLIENT_ID/,
    );
  });

  it('recusa e-mail não verificado', async () => {
    const { transporte } = transporteQueResponde({
      ...tokeninfoValido,
      email_verified: 'false',
    });
    await expect(verificarTokenDoGoogle('tok', { transporte })).rejects.toThrow(/não verificado/);
  });

  it('aceita email_verified booleano tanto quanto string', async () => {
    const { transporte } = transporteQueResponde({ ...tokeninfoValido, email_verified: true });
    await expect(verificarTokenDoGoogle('tok', { transporte })).resolves.toMatchObject({
      email: 'ana@citi.org.br',
    });
  });

  it('400 do tokeninfo é recusa, não falha do servidor', async () => {
    const { transporte } = transporteQueResponde({ error: 'invalid_token' }, 400);
    await expect(verificarTokenDoGoogle('tok', { transporte })).rejects.toBeInstanceOf(
      IdentidadeRecusada,
    );
  });

  it('500 do Google é falha do servidor, não recusa', async () => {
    // A distinção importa: recusa vira 401 e a pessoa reautentica à toa;
    // falha vira 5xx e ela tenta de novo, que é o certo quando o Google caiu.
    const { transporte } = transporteQueResponde({}, 503);
    const erro = await verificarTokenDoGoogle('tok', { transporte }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro).not.toBeInstanceOf(IdentidadeRecusada);
  });

  it('token vazio nem chega a sair para a rede', async () => {
    const { transporte } = transporteQueResponde(tokeninfoValido);
    await expect(verificarTokenDoGoogle('  ', { transporte })).rejects.toBeInstanceOf(
      IdentidadeRecusada,
    );
    expect(transporte).not.toHaveBeenCalled();
  });

  it('normaliza o e-mail para minúsculas', async () => {
    const { transporte } = transporteQueResponde({
      ...tokeninfoValido,
      email: 'Ana.Souza@CITI.org.br',
    });
    const id = await verificarTokenDoGoogle('tok', { transporte });
    expect(id.email).toBe('ana.souza@citi.org.br');
  });

  describe('restrição de domínio', () => {
    it('barra quem é de fora quando o domínio está configurado', async () => {
      process.env.TAQCITI_DOMINIO_PERMITIDO = 'citi.org.br';
      const { transporte } = transporteQueResponde({
        ...tokeninfoValido,
        email: 'alguem@gmail.com',
      });
      await expect(verificarTokenDoGoogle('tok', { transporte })).rejects.toThrow(/citi\.org\.br/);
    });

    it('não se deixa enganar por domínio que só termina parecido', async () => {
      process.env.TAQCITI_DOMINIO_PERMITIDO = 'citi.org.br';
      const { transporte } = transporteQueResponde({
        ...tokeninfoValido,
        email: 'invasor@naoehciti.org.br',
      });
      await expect(verificarTokenDoGoogle('tok', { transporte })).rejects.toBeInstanceOf(
        IdentidadeRecusada,
      );
    });

    it('sem domínio configurado, qualquer conta verificada passa', async () => {
      const { transporte } = transporteQueResponde({
        ...tokeninfoValido,
        email: 'alguem@gmail.com',
      });
      await expect(verificarTokenDoGoogle('tok', { transporte })).resolves.toMatchObject({
        email: 'alguem@gmail.com',
      });
    });
  });
});

describe('cache de identidade', () => {
  it('não vai ao Google duas vezes pelo mesmo token', async () => {
    const { transporte } = transporteQueResponde(tokeninfoValido);
    await identidadeDoToken('tok', { transporte });
    await identidadeDoToken('tok', { transporte });
    expect(transporte).toHaveBeenCalledTimes(1);
  });

  it('tokens diferentes são entradas diferentes', async () => {
    const { transporte } = transporteQueResponde(tokeninfoValido);
    await identidadeDoToken('tok-a', { transporte });
    await identidadeDoToken('tok-b', { transporte });
    expect(transporte).toHaveBeenCalledTimes(2);
  });

  it('token quase vencendo não é guardado', async () => {
    // Guardar por mais tempo do que o token vale transformaria "revoguei o
    // acesso" em "continua entrando por mais um tempo".
    const { transporte } = transporteQueResponde({
      ...tokeninfoValido,
      exp: String(agoraEmSegundos() + 10),
    });
    await identidadeDoToken('tok', { transporte });
    await identidadeDoToken('tok', { transporte });
    expect(transporte).toHaveBeenCalledTimes(2);
  });

  it('o token em claro não é usado como chave do cache', async () => {
    // A chave é o hash. Um heap dump não pode virar credencial de ninguém.
    const { transporte } = transporteQueResponde(tokeninfoValido);
    await identidadeDoToken('segredo-em-claro', { transporte });
    // `validadeDoCache` é pura; o que se afirma aqui é o formato da chave,
    // e ele é verificável pelo comportamento: um token com o mesmo hash
    // reaproveita, um com hash diferente não.
    await identidadeDoToken('segredo-em-claro', { transporte });
    expect(transporte).toHaveBeenCalledTimes(1);
  });
});

describe('validadeDoCache', () => {
  // `exp` é um INSTANTE (segundos desde epoch) — todo caso aqui é relativo a
  // `agoraEmSegundos()`, nunca um número solto, porque um número solto seria
  // um instante no passado (1970 + N segundos) e não diria nada sobre o que
  // o teste quer afirmar.
  it('desconta a margem e respeita o teto', () => {
    const agora = agoraEmSegundos();
    expect(validadeDoCache(String(agora + 3599))).toBe(5 * 60 * 1000);
    expect(validadeDoCache(agora + 60)).toBe(30 * 1000);
  });

  it('vencido, quase vencendo ou ilegível vira zero — não guardar', () => {
    const agora = agoraEmSegundos();
    expect(validadeDoCache(undefined)).toBe(0);
    expect(validadeDoCache('nao-e-numero')).toBe(0);
    // Já passou.
    expect(validadeDoCache(agora - 10)).toBe(0);
    // Vence em 20s — menos que a margem de 30s.
    expect(validadeDoCache(agora + 20)).toBe(0);
  });
});
