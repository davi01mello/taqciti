/**
 * A conta do Google, do lado da extensão — a identidade que diz de quem é o
 * acervo no servidor.
 *
 * ── Por que `launchWebAuthFlow`, e não `getAuthToken` ─────────────────────
 *
 * A primeira versão deste arquivo usava `chrome.identity.getAuthToken`, que
 * depende do cliente OAuth tipo "Extensão do Chrome" declarado no manifesto
 * — o mesmo que `document/googleDocs.ts` usa para o Google Docs. Dois
 * problemas apareceram em uso real, e os dois são do próprio mecanismo, não
 * desta extensão:
 *
 *   1. `getAuthToken` usa SEMPRE a conta com que o Chrome (o programa, o
 *      perfil) está conectado — nunca oferece escolher entre contas, mesmo
 *      com várias na máquina. Não há como acionar o seletor do Google por
 *      essa API.
 *   2. O cliente tipo "Extensão do Chrome" tem um campo de configuração (o ID
 *      do item, no Google Cloud Console) que é digitado à mão e não aparece
 *      em lugar nenhum do código — um erro ali produz uma recusa sobre
 *      "cliente" que nada aqui consegue diagnosticar ou contornar.
 *
 * `launchWebAuthFlow` é outro mecanismo: abre um popup de verdade em
 * `accounts.google.com`, com `prompt=select_account` — a mesma tela de
 * escolha de conta que qualquer site mostra. Ele usa um cliente OAuth tipo
 * "Aplicativo da Web" (`VITE_GOOGLE_OAUTH_WEB_CLIENT_ID`), independente do
 * cliente do Google Docs — os dois não se tocam, e um problema num não
 * contamina o outro.
 *
 * O Google Docs continua em `getAuthToken` — não há motivo para mexer nele
 * agora, e ele é usado bem menos (só ao clicar "enviar para o Docs").
 *
 * ── O atrito que este arquivo existe para evitar ──────────────────────────
 *
 * **1. Não pedir o Drive para quem só quer sincronizar.** O escopo pedido
 * aqui é só `openid email` — nunca `drive.file`. Ver `document/googleDocs.ts`
 * para onde o Drive é pedido, e só ali.
 *
 * **2. Nenhum diálogo sem clique.** `estadoDaSincronizacao()` só tenta o
 * caminho silencioso (`interactive: false`). A janela do Google só aparece em
 * `ligarSincronizacao()`, que nasce de um clique na página Conexões.
 *
 * ── O "sim" é separado da identidade ──────────────────────────────────────
 *
 * Ter uma identidade válida na mão não é a pessoa dizendo que quer as
 * transcrições dela num servidor. Por isso existe `taq:sync`: o SIM
 * explícito, dado uma vez, na página Conexões. Sem ele, nada sobe, mesmo com
 * identidade válida.
 *
 * ── O que NÃO é verificado aqui ────────────────────────────────────────────
 *
 * O `id_token` que sai deste arquivo não é validado por assinatura — só o
 * `nonce` é conferido, como higiene contra uma resposta reaproveitada. A
 * verificação de verdade (assinatura, `aud`, `email_verified`, expiração) é
 * do SERVIDOR, em `server/lib/identidade/google.ts`. Um cliente nunca é a
 * fronteira de segurança do próprio token que ele mesmo pediu.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, writeLocal } from '@/shared/services/storage';

/** Só o necessário para dizer quem é. `drive.file` NÃO entra aqui — ver o cabeçalho. */
const ESCOPO = 'openid email';

/**
 * O cliente OAuth tipo "Aplicativo da Web", só para este fluxo. Diferente do
 * `client_id` do manifesto (tipo "Extensão do Chrome", só para o Docs).
 *
 * Lido a cada chamada, e não guardado num `const` de topo de módulo: um
 * `const` travaria o valor no que `import.meta.env` era na primeira
 * importação, e os testes usam `vi.stubEnv` para simular "configurado" e
 * "não configurado" no mesmo arquivo — o que só funciona lendo ao vivo.
 */
function webClientId(): string | undefined {
  return (import.meta.env.VITE_GOOGLE_OAUTH_WEB_CLIENT_ID as string | undefined)?.trim() || undefined;
}

/**
 * Existe cliente de identidade configurado?
 *
 * Sem isto, `pedirIdentidade` montaria uma URL com `client_id=` vazio, e o
 * Google recusaria de um jeito que não diz nada sobre a causa real.
 */
export function identidadeConfigurada(): boolean {
  return Boolean(webClientId());
}

interface ResultadoDeLogin {
  idToken: string | null;
  /** A mensagem do Chrome ou do Google. Só quem pede SABENDO que quer saber a lê. */
  erro?: string;
}

/** Decodifica o PAYLOAD de um JWT, sem checar assinatura — isso é sempre
 *  trabalho do servidor. Aqui serve só para o `nonce` e o `exp`. */
function payloadDoJwt(idToken: string): Record<string, unknown> | null {
  try {
    const bruto = idToken.split('.')[1];
    if (!bruto) return null;
    const base64 = bruto.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * O pedido cru ao Google. Sempre LÊ `chrome.runtime.lastError` — obrigatório
 * mesmo para quem descarta o valor, senão o Chrome registra "unchecked
 * runtime.lastError" no console a cada tentativa silenciosa que falha, que é
 * o caso NORMAL do caminho de fundo.
 *
 * ── Os dois caminhos pedem coisas diferentes ao Google ───────────────────
 *
 * **Interativo** (`prompt=select_account`): a tela de escolha de conta, que é
 * o ponto inteiro de usar `launchWebAuthFlow` — ver o cabeçalho do arquivo.
 *
 * **Silencioso** (`prompt=none` + `login_hint`): nenhuma tela, nunca. E o
 * `login_hint` é o que faz este caminho FUNCIONAR em vez de falhar sempre:
 *
 *   Sem ele, quando há mais de uma conta Google no navegador — o caso comum,
 *   porque a pessoa tem a do CITi e a pessoal — o Google não tem como saber
 *   qual usar e responde com o seletor de contas. Em modo silencioso não há
 *   onde mostrar seletor, então a tentativa simplesmente falha. O resultado
 *   visível era a sincronização "desligar sozinha" e pedir permissão de novo
 *   a cada vez que o service worker morria, que no MV3 é o tempo todo.
 *
 *   Com o `login_hint`, o Google sabe qual conta é e devolve direto.
 *
 * `prompt=none` é o par disso: diz explicitamente "não me mostre nada". Sem
 * ele, o Google poderia tentar abrir tela dentro de um fluxo que já se
 * comprometeu a não abrir nenhuma, e a falha viria mais lenta e mais confusa.
 */
function pedirIdentidade(interativo: boolean, dicaDeConta?: string): Promise<ResultadoDeLogin> {
  const clientId = webClientId();
  if (!clientId) {
    return Promise.resolve({
      idToken: null,
      erro: 'VITE_GOOGLE_OAUTH_WEB_CLIENT_ID não configurado na build.',
    });
  }

  const nonce = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'id_token',
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: ESCOPO,
    nonce,
    ...(interativo ? { prompt: 'select_account' } : { prompt: 'none' }),
    ...(dicaDeConta ? { login_hint: dicaDeConta } : {}),
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return new Promise((resolve) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: interativo }, (redirecionadoPara) => {
      const erroDoChrome = chrome.runtime.lastError?.message;
      if (!redirecionadoPara) {
        resolve({ idToken: null, ...(erroDoChrome ? { erro: erroDoChrome } : {}) });
        return;
      }

      // O id_token vem no FRAGMENTO da URL de retorno (`#id_token=...`), não
      // na query — é assim que o `response_type=id_token` do Google entrega.
      const fragmento = new URL(redirecionadoPara).hash.replace(/^#/, '');
      const idToken = new URLSearchParams(fragmento).get('id_token');
      if (!idToken) {
        resolve({ idToken: null, erro: 'O Google não devolveu uma identidade.' });
        return;
      }

      const payload = payloadDoJwt(idToken);
      if (payload?.nonce !== nonce) {
        // Não deveria acontecer nunca — é a checagem de que a resposta é
        // desta chamada, e não uma sobrando de uma anterior.
        resolve({ idToken: null, erro: 'A resposta do Google não confere com o pedido.' });
        return;
      }

      resolve({ idToken });
    });
  });
}

// ------------------------------------------------------- cache em memória

/**
 * Um `id_token` dura cerca de uma hora, e não há um "token de atualização"
 * neste fluxo — diferente de `getAuthToken`, que o Chrome cacheia e renova
 * sozinho. Sem cache próprio, CADA chamada a uma rota do servidor abriria
 * `launchWebAuthFlow` de novo.
 *
 * Em memória, nunca em `chrome.storage`: é um token de curta duração, e
 * persistir credencial de qualquer duração é superfície de vazamento que a
 * conveniência de sobreviver a um restart do service worker não paga.
 */
let emCache: { idToken: string; validoAte: number } | null = null;

/** Margem antes do vencimento, para uma chamada não começar com um token que
 *  expira no meio do caminho até o servidor. */
const MARGEM_MS = 30_000;

function doCache(): string | null {
  if (emCache && emCache.validoAte > Date.now()) return emCache.idToken;
  return null;
}

function guardarNoCache(idToken: string): void {
  const payload = payloadDoJwt(idToken);
  const exp = typeof payload?.exp === 'number' ? payload.exp * 1000 : Date.now();
  const validoAte = exp - MARGEM_MS;
  // Um token cujo `exp` já é passado (ou ilegível) não é guardado: é melhor
  // pedir de novo do que servir algo que o servidor vai recusar de qualquer jeito.
  emCache = validoAte > Date.now() ? { idToken, validoAte } : null;
}

/** Só os testes precisam limpar entre casos; em produção o cache expira sozinho. */
export function limparCacheDeIdentidadeLocal(): void {
  emCache = null;
}

/**
 * Pede uma identidade, DESCARTANDO o motivo de uma falha.
 *
 * Correto para o caminho silencioso (`estadoDaSincronizacao`,
 * `desligarSincronizacao`): ali a recusa é o resultado ESPERADO — ninguém
 * autorizou ainda, ou a sessão do Google expirou — e mostrar o motivo bruto
 * confundiria mais do que ajudaria.
 *
 * NÃO é o caminho certo para o clique em "Ligar sincronização": ali falhar
 * NÃO é esperado. Esse caminho usa `pedirIdentidade` diretamente, em
 * `ligarSincronizacao`, e propaga o `erro` até a tela.
 */
export async function tokenDeIdentidade(interativo: boolean): Promise<string | null> {
  const guardado = doCache();
  if (guardado) return guardado;

  // A dica de conta vem do "sim" guardado, e é o que sustenta o caminho
  // silencioso entre mortes do service worker — ver `pedirIdentidade`. Não é
  // credencial: é só o endereço de e-mail que a pessoa já escolheu uma vez.
  const dica = interativo ? undefined : (await lerSim()).email;

  const { idToken } = await pedirIdentidade(interativo, dica);
  if (idToken) guardarNoCache(idToken);
  return idToken;
}

/**
 * Descarta a identidade em cache — chamado quando o SERVIDOR recusa um
 * token (401): o cache local pode estar desatualizado em relação ao que o
 * servidor aceita, e insistir com o mesmo valor só repetiria a recusa.
 *
 * Sem argumento, de propósito: diferente do cache do `getAuthToken` (que era
 * do Chrome, por token), este é nosso e vale só um de cada vez — não há "qual
 * token" para especificar.
 */
export function descartarToken(): Promise<void> {
  emCache = null;
  return Promise.resolve();
}

// ------------------------------------------------------------- o "sim"

interface SimGuardado {
  ligada: boolean;
  /** O e-mail no momento do sim. Só para mostrar na tela — nunca autoridade. */
  email?: string;
  emMs?: number;
}

export type EstadoDaSincronizacao =
  /** Não há cliente de identidade configurado; nem dá para tentar. */
  | { situacao: 'sem-oauth' }
  /**
   * Ninguém ligou. É o padrão, e o produto funciona inteiro assim.
   *
   * `motivo` é o que faz esta tela não ficar muda quando um CLIQUE em "Ligar"
   * falha: ausente é o estado normal de quem nunca tentou; presente é "você
   * tentou agora mesmo e o Google recusou, e foi por isto". Ver
   * `ligarSincronizacao`.
   */
  | { situacao: 'desligada'; motivo?: string }
  /** Ligada e com identidade na mão. */
  | { situacao: 'ligada'; email?: string }
  /**
   * Ligada, mas o caminho silencioso não devolve identidade — a sessão do
   * Google expirou, ou a pessoa revogou o acesso. Precisa de um clique.
   */
  | { situacao: 'precisa-permissao'; email?: string };

async function lerSim(): Promise<SimGuardado> {
  const bruto = await readLocal<SimGuardado>(STORAGE_KEYS.sync);
  return bruto && typeof bruto === 'object' && typeof bruto.ligada === 'boolean'
    ? bruto
    : { ligada: false };
}

/**
 * Onde a sincronização está, SEM abrir diálogo nenhum.
 *
 * É o que a página Conexões chama ao abrir. O caminho silencioso só é
 * tentado quando o sim já foi dado: pedir identidade para quem não ligou
 * nada seria trabalho à toa.
 */
export async function estadoDaSincronizacao(): Promise<EstadoDaSincronizacao> {
  if (!identidadeConfigurada()) return { situacao: 'sem-oauth' };

  const sim = await lerSim();
  if (!sim.ligada) return { situacao: 'desligada' };

  const token = await tokenDeIdentidade(false);
  const email = sim.email;
  return token
    ? { situacao: 'ligada', ...(email ? { email } : {}) }
    : { situacao: 'precisa-permissao', ...(email ? { email } : {}) };
}

/**
 * Liga a sincronização. É o ÚNICO caminho que pode abrir o popup do Google,
 * e ele nasce de um clique.
 *
 * `prompt=select_account` está dentro de `pedirIdentidade` para o caminho
 * interativo — é o que resolve o problema de sempre pegar a conta errada do
 * perfil do Chrome.
 *
 * Guarda o sim só depois de o Google devolver uma identidade: gravar antes
 * deixaria a extensão convencida de que está ligada enquanto a pessoa fechou
 * o popup.
 */
export async function ligarSincronizacao(): Promise<EstadoDaSincronizacao> {
  if (!identidadeConfigurada()) return { situacao: 'sem-oauth' };

  const { idToken, erro } = await pedirIdentidade(true);
  if (!idToken) return { situacao: 'desligada', ...(erro ? { motivo: erro } : {}) };
  guardarNoCache(idToken);

  // O e-mail sai do próprio token, não de um parâmetro de quem chamou. Antes
  // era um argumento que a página nunca passava, então o "sim" era gravado
  // sem e-mail nenhum — e sem e-mail não há `login_hint`, que é justamente o
  // que mantém o caminho silencioso funcionando depois. Ler do token torna
  // impossível esquecer de preencher.
  //
  // Não é autoridade sobre nada: quem decide de quem é o acervo é o servidor,
  // conferindo a assinatura do mesmo token. Aqui serve para a dica de conta e
  // para a tela ter o que mostrar.
  const doToken = payloadDoJwt(idToken)?.email;
  const email = typeof doToken === 'string' ? doToken : undefined;

  const sim: SimGuardado = {
    ligada: true,
    ...(email ? { email } : {}),
    emMs: Date.now(),
  };
  await writeLocal(STORAGE_KEYS.sync, sim);
  return { situacao: 'ligada', ...(email ? { email } : {}) };
}

/**
 * Desliga. Local: para de subir daqui para frente.
 *
 * NÃO apaga o que já subiu — essa é outra ação, e confundir as duas faria
 * "pausar" apagar o acervo de alguém sem aviso. A página Conexões oferece as
 * duas separadamente.
 */
export async function desligarSincronizacao(): Promise<void> {
  emCache = null;
  await writeLocal(STORAGE_KEYS.sync, { ligada: false } satisfies SimGuardado);
}
