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
import { readLocal, removeLocal, writeLocal } from '@/shared/services/storage';
import { logger } from '@/shared/services/log';

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
 * O domínio das contas que podem usar o TaqCiti. Espelha `dominio.ts` do
 * servidor (`server/lib/identidade/`), que é quem IMPÕE a regra — aqui ela existe
 * para a pessoa ser barrada na hora de logar, com uma mensagem que diz o que
 * fazer, em vez de descobrir só quando o servidor recusar.
 */
export const DOMINIO_DO_CITI = 'citi.org.br';

export const MENSAGEM_DE_CONTA_DE_FORA = `O TaqCiti só aceita contas @${DOMINIO_DO_CITI}. Escolha a conta da organização.`;

/**
 * A conta do token é da organização? O e-mail é a barreira; um `hd` (domínio
 * hospedado do Workspace) de OUTRA organização também barra, e a ausência dele
 * não — contas fora do Workspace não o têm.
 */
export function contaEhDoCiti(idToken: string): boolean {
  const payload = payloadDoJwt(idToken);
  const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email.endsWith(`@${DOMINIO_DO_CITI}`)) return false;
  const hd = payload?.hd;
  return typeof hd !== 'string' || hd.trim().toLowerCase() === DOMINIO_DO_CITI;
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
/**
 * O erro do Chrome no login ("The user did not approve access.", "OAuth2 not
 * granted or revoked.") é em inglês e fala do mecanismo. A tela recebe o que
 * fazer; o texto bruto vai para o log.
 *
 * Fechar a janela é escolha da pessoa, não defeito: vai para `debug`. Como
 * `warn` ele aparecia em "Erros" de chrome://extensions a cada janela fechada
 * (28/10/2026). Só o que não é recusa continua `warn`.
 */
function motivoDoChrome(bruto: string): string {
  const recusa = /approve|cancel|closed|not granted|revoked/i.test(bruto);
  if (recusa) logger.debug(`login do Google recusado: ${bruto}`);
  else logger.warn(`login do Google não concluído: ${bruto}`);
  return recusa
    ? 'A janela do Google foi fechada ou o acesso não foi permitido. Tente de novo e escolha a sua conta do CITi.'
    : 'O Google não concluiu o login. Tente de novo em instantes.';
}

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
    // Pede ao Google que ofereça só contas desta organização no seletor. É
    // conveniência: quem manda de verdade é o servidor, e `contaEhDoCiti` confere
    // o resultado logo abaixo.
    hd: DOMINIO_DO_CITI,
    nonce,
    ...(interativo ? { prompt: 'select_account' } : { prompt: 'none' }),
    ...(dicaDeConta ? { login_hint: dicaDeConta } : {}),
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return new Promise((resolve) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: interativo }, (redirecionadoPara) => {
      const erroDoChrome = chrome.runtime.lastError?.message;
      if (!redirecionadoPara) {
        resolve({ idToken: null, ...(erroDoChrome ? { erro: motivoDoChrome(erroDoChrome) } : {}) });
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

      // O Google pode devolver uma conta de fora mesmo com o `hd`, que é só uma
      // dica: quem digita outro e-mail, ou o `login_hint` de um sim antigo.
      if (!contaEhDoCiti(idToken)) {
        resolve({ idToken: null, erro: MENSAGEM_DE_CONTA_DE_FORA });
        return;
      }

      resolve({ idToken });
    });
  });
}

/**
 * De quem é este `id_token`: o `sub`, o identificador estável que o Google
 * emite por conta (o e-mail pode mudar; ver `server/lib/conector/pessoa.ts`).
 *
 * Serve para a extensão perceber que a conta mudou nesta máquina — não é
 * autoridade sobre nada. Quem decide de quem é o acervo é o servidor,
 * conferindo a assinatura do mesmo token.
 */
export function contaDoToken(idToken: string): string | null {
  const sub = payloadDoJwt(idToken)?.sub;
  return typeof sub === 'string' && sub ? sub : null;
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
  loginRecusadoEm = 0;
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
 * O `id_token` para as rotas de IA do servidor, ou `null`.
 *
 * Desde o plano de segurança (21/10/2026) o servidor identifica quem chama a
 * IA pela conta do Google e conta o uso por pessoa; o segredo compartilhado é
 * só a ponte para as instalações antigas, e vai cair. Por isso a IA EXIGE a
 * conta do CITi, com ou sem sincronização ligada:
 *
 *  1. o cache em memória, quando houver;
 *  2. o caminho silencioso, com a conta já escolhida como dica (a da
 *     sincronização, ou a guardada em `contaDaIa` no primeiro login para a IA);
 *  3. sem dica, ou com o silencioso recusado: a janela do Google, UMA vez. Se a
 *     pessoa fechar, não reabre a cada chamada — espera `PAUSA_DO_LOGIN_MS`.
 *
 * Entrar para usar a IA NÃO liga a sincronização: o e-mail vai para
 * `contaDaIa`, não para o "sim" de `sync`.
 *
 * `{ interativo: false }` para em 2: é o de quem só CONSULTA sem a pessoa ter
 * pedido nada (o "o Taq está pronto?" ao abrir a Home). Sem isso, abrir a Home
 * abria a janela do Google sem clique — e, se ela falhava, a pessoa achava que
 * precisava logar para ver a Home. A rota de estado não gasta modelo e aceita
 * a ponte do segredo, então seguir sem identidade ali não perde nada.
 */
const PAUSA_DO_LOGIN_MS = 10 * 60_000;
let loginRecusadoEm = 0;
let loginEmCurso: { interativo: boolean; promessa: Promise<string | null> } | null = null;

export function identidadeParaIa({ interativo = true }: { interativo?: boolean } = {}): Promise<string | null> {
  // Várias chamadas ao mesmo tempo (o Taq e uma geração) dividem o mesmo
  // login: duas janelas do Google para a mesma pergunta seria confuso. Quem
  // pode abrir a janela não pega carona num pedido silencioso, que não a abriria.
  if (loginEmCurso && (loginEmCurso.interativo || !interativo)) return loginEmCurso.promessa;
  const promessa = obterIdentidadeParaIa(interativo).finally(() => {
    if (loginEmCurso?.promessa === promessa) loginEmCurso = null;
  });
  loginEmCurso = { interativo, promessa };
  return promessa;
}

async function obterIdentidadeParaIa(interativo: boolean): Promise<string | null> {
  try {
    if (!identidadeConfigurada()) return null;
    const guardado = doCache();
    if (guardado) return guardado;

    const sim = await lerSim();
    const conta = await readLocal<{ email?: string }>(STORAGE_KEYS.contaDaIa);
    const dica = (sim.ligada ? sim.email : undefined) ?? conta?.email;
    if (dica) {
      const { idToken } = await pedirIdentidade(false, dica);
      if (idToken) {
        guardarNoCache(idToken);
        return idToken;
      }
    }

    if (!interativo || Date.now() - loginRecusadoEm < PAUSA_DO_LOGIN_MS) return null;
    const { idToken } = await pedirIdentidade(true);
    if (!idToken) {
      loginRecusadoEm = Date.now();
      return null;
    }
    guardarNoCache(idToken);
    const email = payloadDoJwt(idToken)?.email;
    if (typeof email === 'string') await writeLocal(STORAGE_KEYS.contaDaIa, { email });
    return idToken;
  } catch {
    return null;
  }
}

// ------------------------------------------------- entrar e sair, por clique

/**
 * Onde está o login da IA, para a página Conexões mostrar — SEM abrir janela:
 * só o cache e o caminho silencioso com a conta já escolhida.
 *
 * `pelaSincronizacao` diz que a conta vem do "sim" da sincronização: sair por
 * aqui não adiantaria (a sincronização a usaria de novo), então quem quer sair
 * desconecta a sincronização.
 */
export type EstadoDoLogin =
  | { situacao: 'sem-oauth' }
  | { situacao: 'fora' }
  | { situacao: 'dentro'; email?: string; pelaSincronizacao: boolean }
  /** Já entrou uma vez, mas a sessão do Google venceu: precisa de um clique. */
  | { situacao: 'vencido'; email: string };

export async function estadoDoLogin(): Promise<EstadoDoLogin> {
  if (!identidadeConfigurada()) return { situacao: 'sem-oauth' };
  const sim = await lerSim();
  const conta = await readLocal<{ email?: string }>(STORAGE_KEYS.contaDaIa);
  const pelaSincronizacao = sim.ligada && Boolean(sim.email);
  const email = (pelaSincronizacao ? sim.email : undefined) ?? conta?.email;
  if (!email) return { situacao: 'fora' };
  const token = await identidadeParaIa({ interativo: false });
  return token ? { situacao: 'dentro', email, pelaSincronizacao } : { situacao: 'vencido', email };
}

/**
 * O botão "Entrar" de Conexões: abre a janela do Google e, diferente do
 * caminho automático, devolve o MOTIVO de uma falha — quem clicou quer saber.
 * Um clique também desfaz a pausa de `identidadeParaIa` depois de uma janela
 * fechada.
 */
export async function entrarParaIa(): Promise<{ email?: string; erro?: string }> {
  if (!identidadeConfigurada()) return { erro: 'O login do Google não está configurado nesta versão.' };
  const { idToken, erro } = await pedirIdentidade(true);
  if (!idToken) return { erro: erro ?? 'O Google não concluiu o login. Tente de novo.' };
  loginRecusadoEm = 0;
  guardarNoCache(idToken);
  const email = payloadDoJwt(idToken)?.email;
  if (typeof email !== 'string') return {};
  await writeLocal(STORAGE_KEYS.contaDaIa, { email });
  return { email };
}

/** Sair: esquece a conta da IA e o token em memória. Não mexe na sincronização. */
export async function sairDaIa(): Promise<void> {
  emCache = null;
  await removeLocal(STORAGE_KEYS.contaDaIa);
}

/**
 * Cabeçalhos de uma chamada às rotas de IA, e o `fetch` que os usa.
 *
 * Manda o segredo antigo SEMPRE e o `Authorization` quando houver identidade.
 * Se o servidor recusar o token (401 — vencido, revogado), descarta o cache e
 * repete UMA vez só com o segredo: um token velho não pode derrubar a geração
 * de uma ata enquanto a ponte do segredo estiver de pé no servidor.
 *
 * `interativo: false` nunca abre a janela do Google — ver `identidadeParaIa`.
 */
export async function fetchDeIa(
  url: string,
  init: RequestInit & { headers?: Record<string, string> },
  transporte: typeof fetch = fetch,
  { interativo = true }: { interativo?: boolean } = {},
): Promise<Response> {
  const token = await identidadeParaIa({ interativo });
  const resposta = await transporte(url, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (resposta.status !== 401 || !token) return resposta;
  await descartarToken();
  return transporte(url, init);
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
