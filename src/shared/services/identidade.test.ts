/**
 * A identidade do lado da extensão.
 *
 * Quatro invariantes carregam o arquivo, e os quatro são sobre ATRITO — que é
 * o requisito aqui tanto quanto a corretude:
 *
 * - `drive.file` nunca é pedido junto com a identidade;
 * - nenhum caminho automático abre popup (`interactive: true`);
 * - `select_account` só no caminho interativo — o silencioso nunca força a
 *   tela a aparecer;
 * - token na mão não é consentimento: sem o "sim" explícito, fica desligada.
 *
 * ── Por que `vi.stubEnv`, e não mockar o manifesto ────────────────────────
 *
 * A versão anterior deste arquivo (baseada em `getAuthToken`) lia o cliente
 * OAuth do MANIFESTO, que os testes mockavam via `chrome.runtime.getManifest`.
 * O cliente de identidade agora é lido de `import.meta.env` — porque
 * `launchWebAuthFlow` não usa o `oauth2` do manifesto, monta a própria URL —
 * e por isso os testes usam `vi.stubEnv`, a forma correta do Vitest de mudar
 * uma variável de ambiente em tempo de teste.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import {
  desligarSincronizacao,
  estadoDaSincronizacao,
  identidadeConfigurada,
  ligarSincronizacao,
  tokenDeIdentidade,
  limparCacheDeIdentidadeLocal,
} from './identidade';

const WEB_CLIENT_ID = '123456-web.apps.googleusercontent.com';
const REDIRECT_URI = 'https://jalebpaefejnbacgncgkailhemkdpnhm.chromiumapp.org/';

/** Registra os pedidos para se poder afirmar sobre interatividade e URL. */
interface Pedido {
  url: string;
  interactive?: boolean;
}

/**
 * Monta um `chrome.identity.launchWebAuthFlow` que devolve um `id_token`
 * assinado o bastante para os testes: um JWT de mentira, com o PAYLOAD real
 * (é só ele que o código lê — a assinatura é verificada pelo SERVIDOR, nunca
 * aqui, ver o cabeçalho de `identidade.ts`).
 */
function jwtDeMentira(payload: Record<string, unknown>): string {
  const parte = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${parte({ alg: 'none' })}.${parte(payload)}.assinatura-fake`;
}

function montarChrome(
  opcoes: {
    /** `null` = o Google não devolveu URL nenhuma (fechou o popup, ou falhou). */
    idToken?: string | null;
    /** Quando ausente e `idToken` não é null, um token válido é gerado sozinho. */
    payload?: Record<string, unknown>;
    erro?: string;
  } = {},
) {
  const pedidos: Pedido[] = [];
  const g = globalThis as unknown as { chrome: Record<string, unknown> };

  g.chrome = {
    ...(g.chrome ?? {}),
    runtime: {
      ...((g.chrome?.runtime as object) ?? {}),
      // Como o Chrome de verdade: só existe DEPOIS da chamada, e só quando
      // ela falhou.
      lastError: opcoes.erro ? { message: opcoes.erro } : undefined,
    },
    identity: {
      getRedirectURL: () => REDIRECT_URI,
      launchWebAuthFlow: (detalhes: Pedido, cb: (url?: string) => void) => {
        pedidos.push(detalhes);
        if (opcoes.idToken === null) {
          cb(undefined);
          return;
        }
        // O nonce viaja na URL do PEDIDO — o mock devolve o mesmo nonce no
        // token, como o Google faria, para o teste normal não cair na
        // checagem de segurança por acidente.
        const nonceDoPedido = new URL(detalhes.url).searchParams.get('nonce');
        const token =
          opcoes.idToken ??
          jwtDeMentira({
            sub: '110011001100110011001',
            email: 'ana@citi.org.br',
            nonce: nonceDoPedido,
            exp: Math.floor(Date.now() / 1000) + 3600,
            ...opcoes.payload,
          });
        cb(`${REDIRECT_URI}#id_token=${token}`);
      },
    },
  };
  return { pedidos };
}

beforeEach(() => {
  installChromeStorageMock();
  limparCacheDeIdentidadeLocal();
  vi.stubEnv('VITE_GOOGLE_OAUTH_WEB_CLIENT_ID', WEB_CLIENT_ID);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('identidadeConfigurada', () => {
  it('reconhece quando o cliente de identidade não foi configurado', () => {
    vi.stubEnv('VITE_GOOGLE_OAUTH_WEB_CLIENT_ID', '');
    expect(identidadeConfigurada()).toBe(false);
  });

  it('reconhece um cliente de verdade', () => {
    expect(identidadeConfigurada()).toBe(true);
  });
});

describe('escopo e forma do pedido', () => {
  it('a URL pede só openid e email — nunca o Drive', async () => {
    const { pedidos } = montarChrome();
    await tokenDeIdentidade(false);
    const params = new URL(pedidos[0]!.url).searchParams;
    expect(params.get('scope')).toBe('openid email');
    expect(params.get('scope')).not.toContain('drive');
  });

  it('usa o redirect oficial do Chrome, não uma URL montada à mão', async () => {
    const { pedidos } = montarChrome();
    await tokenDeIdentidade(false);
    expect(new URL(pedidos[0]!.url).searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
  });

  it('select_account só no caminho INTERATIVO', async () => {
    // O silencioso manda `prompt=none` — o oposto de `select_account`, e não
    // a ausência de `prompt`, que era o que este teste afirmava antes.
    // Ausência deixava o Google livre para decidir mostrar tela; `none` diz
    // explicitamente que não há onde mostrar. A invariante é a mesma: tela de
    // escolha de conta, só quando alguém clicou.
    const { pedidos } = montarChrome();
    await tokenDeIdentidade(false);
    await ligarSincronizacao();
    expect(new URL(pedidos[0]!.url).searchParams.get('prompt')).toBe('none');
    expect(new URL(pedidos[1]!.url).searchParams.get('prompt')).toBe('select_account');
  });

  it('sem cliente configurado nem tenta', async () => {
    vi.stubEnv('VITE_GOOGLE_OAUTH_WEB_CLIENT_ID', '');
    const { pedidos } = montarChrome();
    expect(await tokenDeIdentidade(true)).toBeNull();
    expect(pedidos).toHaveLength(0);
  });
});

describe('estadoDaSincronizacao', () => {
  it('sem cliente configurado, diz sem-oauth', async () => {
    vi.stubEnv('VITE_GOOGLE_OAUTH_WEB_CLIENT_ID', '');
    montarChrome();
    expect(await estadoDaSincronizacao()).toEqual({ situacao: 'sem-oauth' });
  });

  it('começa desligada', async () => {
    montarChrome();
    expect(await estadoDaSincronizacao()).toEqual({ situacao: 'desligada' });
  });

  it('identidade na mão NÃO é consentimento', async () => {
    // O caminho silencioso poderia até funcionar (sessão do Google viva) sem
    // que a pessoa jamais tenha dito que quer as transcrições num servidor.
    const { pedidos } = montarChrome();
    expect(await estadoDaSincronizacao()).toEqual({ situacao: 'desligada' });
    // Nem chega a tentar para quem não ligou nada.
    expect(pedidos).toHaveLength(0);
  });

  it('NUNCA abre popup', async () => {
    const { pedidos } = montarChrome();
    await ligarSincronizacao();
    pedidos.length = 0;

    await estadoDaSincronizacao();
    expect(pedidos.every((p) => p.interactive === false)).toBe(true);
  });

  it('ligada quando há sim e identidade', async () => {
    montarChrome();
    await ligarSincronizacao();
    expect(await estadoDaSincronizacao()).toEqual({
      situacao: 'ligada',
      email: 'ana@citi.org.br',
    });
  });

  it('sim guardado mas sem identidade vira precisa-permissao, não desligada', async () => {
    // Distinção que importa na tela: "você desligou" e "a sessão do Google
    // caducou" pedem respostas diferentes de quem está lendo.
    montarChrome();
    await ligarSincronizacao();

    montarChrome({ idToken: null });
    limparCacheDeIdentidadeLocal();
    expect(await estadoDaSincronizacao()).toEqual({
      situacao: 'precisa-permissao',
      email: 'ana@citi.org.br',
    });
  });
});

describe('ligar e desligar', () => {
  it('ligar usa o caminho interativo — é o único que pode', async () => {
    const { pedidos } = montarChrome();
    await ligarSincronizacao();
    expect(pedidos[0]?.interactive).toBe(true);
  });

  it('fechar o popup do Google não deixa a extensão achando que ligou', async () => {
    montarChrome({ idToken: null });
    expect(await ligarSincronizacao()).toEqual({ situacao: 'desligada' });
    const guardado = await chrome.storage.local.get(STORAGE_KEYS.sync);
    expect(guardado[STORAGE_KEYS.sync]).toBeUndefined();
  });

  it('quando o Google recusa, a pessoa vê o motivo — não uma tela muda', async () => {
    // Este é o bug que "clicar e não acontecer nada" era: `motivo` ausente
    // faz esta falha parecer IDÊNTICA a nunca ter clicado.
    montarChrome({ idToken: null, erro: 'OAuth2 not granted or revoked.' });
    expect(await ligarSincronizacao()).toEqual({
      situacao: 'desligada',
      motivo: 'OAuth2 not granted or revoked.',
    });
  });

  it('resposta com nonce trocado é recusada — não é a resposta deste pedido', async () => {
    montarChrome({ payload: { nonce: 'nonce-de-outro-pedido' } });
    const estado = await ligarSincronizacao();
    expect(estado.situacao).toBe('desligada');
    expect((estado as { motivo?: string }).motivo).toMatch(/não confere/);
  });

  it('o caminho SILENCIOSO nunca vaza o motivo bruto do Chrome', async () => {
    // `precisa-permissao` não tem campo `motivo` no tipo — a mensagem bruta
    // é ruído aqui, porque a recusa silenciosa é o resultado ESPERADO.
    montarChrome();
    await ligarSincronizacao();

    montarChrome({ idToken: null, erro: 'qualquer coisa que o Chrome disser' });
    limparCacheDeIdentidadeLocal();
    const estado = await estadoDaSincronizacao();
    expect(estado).toEqual({ situacao: 'precisa-permissao', email: 'ana@citi.org.br' });
    expect(JSON.stringify(estado)).not.toContain('qualquer coisa');
  });

  it('desligar apaga o sim e o cache local', async () => {
    montarChrome();
    await ligarSincronizacao();

    await desligarSincronizacao();
    // Sem o cache limpo, `estadoDaSincronizacao` acharia que ainda tem uma
    // identidade válida em mãos mesmo com o sim apagado.
    montarChrome({ idToken: null });
    expect(await estadoDaSincronizacao()).toEqual({ situacao: 'desligada' });
  });
});

describe('o caminho silencioso sobrevive ao service worker morrer', () => {
  /**
   * O cache de identidade vive em MEMÓRIA, e no MV3 o service worker morre
   * por ociosidade o tempo todo. Ou seja: o caminho silencioso não é o caso
   * raro — é o caso NORMAL, percorrido a cada sincronização.
   *
   * E ele falhava. Sem dizer ao Google QUAL conta usar, um navegador com mais
   * de uma conta logada (a do CITi e a pessoal, o arranjo comum) recebe o
   * seletor de contas como resposta — que em modo silencioso não tem onde
   * aparecer, então a tentativa morre. O sintoma era a sincronização pedir
   * permissão de novo sem parar, como se a conta não se mantivesse.
   */
  it('manda login_hint com a conta já escolhida', async () => {
    montarChrome();
    await ligarSincronizacao();
    limparCacheDeIdentidadeLocal();

    const { pedidos } = montarChrome();
    await tokenDeIdentidade(false);

    const url = new URL(pedidos[0]!.url);
    expect(url.searchParams.get('login_hint')).toBe('ana@citi.org.br');
  });

  it('manda prompt=none — promete ao Google que não há onde mostrar tela', async () => {
    montarChrome();
    await ligarSincronizacao();
    limparCacheDeIdentidadeLocal();

    const { pedidos } = montarChrome();
    await tokenDeIdentidade(false);

    const url = new URL(pedidos[0]!.url);
    expect(url.searchParams.get('prompt')).toBe('none');
  });

  it('o interativo continua pedindo select_account, e NÃO manda login_hint', async () => {
    // Travar a conta no caminho interativo tiraria justamente a escolha que
    // faz este fluxo existir — ver o cabeçalho de `identidade.ts`.
    const { pedidos } = montarChrome();
    await ligarSincronizacao();

    const url = new URL(pedidos[0]!.url);
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('login_hint')).toBeNull();
  });

  it('o e-mail guardado vem do TOKEN, não de quem chamou', async () => {
    // Antes era um parâmetro opcional que a página nunca passava: o "sim"
    // ficava sem e-mail, e sem e-mail não há `login_hint`. Tirar o parâmetro
    // torna impossível esquecer.
    montarChrome({ payload: { email: 'outra.pessoa@citi.org.br' } });
    const estado = await ligarSincronizacao();

    expect(estado).toEqual({ situacao: 'ligada', email: 'outra.pessoa@citi.org.br' });
    const guardado = await chrome.storage.local.get(STORAGE_KEYS.sync);
    expect(guardado[STORAGE_KEYS.sync]).toMatchObject({ email: 'outra.pessoa@citi.org.br' });
  });
});

describe('cache local da identidade', () => {
  it('não abre popup de novo enquanto o id_token não vence', async () => {
    const { pedidos } = montarChrome();
    await tokenDeIdentidade(false);
    await tokenDeIdentidade(false);
    expect(pedidos).toHaveLength(1);
  });

  it('um id_token quase vencendo não é guardado', async () => {
    const { pedidos } = montarChrome({ payload: { exp: Math.floor(Date.now() / 1000) + 5 } });
    await tokenDeIdentidade(false);
    await tokenDeIdentidade(false);
    expect(pedidos).toHaveLength(2);
  });
});

describe('ruído no console', () => {
  it('lê lastError na falha silenciosa', async () => {
    // Sem ler `lastError`, o Chrome despeja "unchecked runtime.lastError" a
    // cada tentativa silenciosa que falha — que é o caso NORMAL de quem não
    // ligou a sincronização.
    montarChrome({ idToken: null });
    const g = globalThis as unknown as { chrome: { runtime: Record<string, unknown> } };
    let lido = false;
    Object.defineProperty(g.chrome.runtime, 'lastError', {
      get() {
        lido = true;
        return { message: 'não autorizado' };
      },
      configurable: true,
    });

    await tokenDeIdentidade(false);
    expect(lido).toBe(true);
  });
});

describe('integração com o mock de storage', () => {
  it('o sim sobrevive a uma releitura', async () => {
    montarChrome();
    await ligarSincronizacao();
    const guardado = await chrome.storage.local.get(STORAGE_KEYS.sync);
    expect(guardado[STORAGE_KEYS.sync]).toMatchObject({
      ligada: true,
      email: 'ana@citi.org.br',
    });
  });
});
