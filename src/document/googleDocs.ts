/**
 * Cria a ata como Google Doc no Drive de quem está usando a extensão.
 *
 * ── Por que a EXTENSÃO cria o documento, e não o servidor ──────────────────
 *
 * O token OAuth é obtido dentro do Chrome, por `chrome.identity`, e nunca sai
 * daqui. Se o servidor criasse o arquivo, ele precisaria receber e guardar
 * credencial do Google de cada usuário — um passivo que o produto não tem
 * motivo para carregar. O servidor devolve o HTML; quem entra na conta é o
 * navegador da pessoa.
 *
 * ── Por que `files.create` e não `documents.batchUpdate` ───────────────────
 *
 * `batchUpdate` monta o documento parágrafo a parágrafo, com índices de
 * caractere que precisam ser recalculados a cada inserção — dezenas de
 * chamadas e um modelo de posicionamento fácil de errar em silêncio. O
 * `files.create` do Drive aceita HTML e converte para o formato do Docs numa
 * chamada, usando o conversor da própria Google. É menos código nosso no
 * caminho entre o dado conferido e o que o cliente lê.
 */
import type { DocumentType } from './generateDocument';

/** Só o que a extensão criou. Ver a justificativa no manifesto. */
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

/** O valor que `manifest.config.ts` usa quando ninguém registrou um cliente. */
const CLIENT_ID_PLACEHOLDER = 'CLIENT_ID_NAO_CONFIGURADO';

/**
 * Existe cliente OAuth registrado para esta extensão?
 *
 * Lido do PRÓPRIO manifesto, e não de uma constante compilada à parte, porque
 * é o manifesto que o Chrome usa de verdade — uma segunda fonte poderia dizer
 * "configurado" enquanto o Chrome vê o placeholder.
 *
 * Serve para a extensão nem TENTAR o Google Docs quando não há como
 * autenticar. Sem esta checagem, todo clique gastaria uma ida ao
 * `getAuthToken` para receber "bad client id" — erro na cara do usuário por
 * uma configuração que não é problema dele.
 */
export function oauthConfigurado(): boolean {
  try {
    const clientId = chrome.runtime.getManifest().oauth2?.client_id ?? '';
    return clientId.length > 0 && !clientId.startsWith(CLIENT_ID_PLACEHOLDER);
  } catch {
    return false;
  }
}

const UPLOAD_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';

/** O mimeType de DESTINO. É ele que faz o Drive converter o HTML enviado em
 *  documento nativo do Docs, em vez de guardar um .html solto. */
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

export type GoogleDocResult =
  | { status: 'success'; url: string }
  | { status: 'error'; message: string; naoConfigurado?: boolean };

/**
 * Pede o token ao Chrome. `interactive: true` abre a tela de consentimento na
 * primeira vez; depois disso o Chrome devolve do cache sem interromper.
 */
function getAuthToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true, scopes: SCOPES }, (token) => {
      const erro = chrome.runtime.lastError;
      if (erro || !token) {
        reject(new Error(erro?.message ?? 'O Chrome não devolveu um token de acesso.'));
        return;
      }
      resolve(typeof token === 'string' ? token : String(token));
    });
  });
}

/**
 * Descarta um token que o Google recusou.
 *
 * O Chrome guarda o token em cache e o devolve mesmo depois de revogado ou
 * expirado — sem esta limpeza, um 401 vira permanente e nem reinstalar a
 * extensão resolve, porque o cache é do perfil.
 */
async function descartarToken(token: string): Promise<void> {
  await new Promise<void>((resolve) => chrome.identity.removeCachedAuthToken({ token }, resolve));
}

const DOIS_DIGITOS = (n: number) => String(n).padStart(2, '0');

/**
 * `Ata de Reunião — {projeto} — {DD-MM-AAAA}`, caindo para o título da reunião
 * quando o projeto for lacuna.
 *
 * Nada de `undefined` nem de colchete no nome: o nome do arquivo é a primeira
 * coisa que o cliente vê na lista do Drive, e um `[A preencher: ...]` ali
 * transforma uma lacuna interna numa falha aparente do produto.
 */
export function nomeDoArquivo(
  rotulo: string,
  projeto: string | undefined,
  tituloDaReuniao: string,
  quando: Date,
): string {
  const identificacao = (projeto ?? '').trim() || tituloDaReuniao.trim();
  const data = `${DOIS_DIGITOS(quando.getDate())}-${DOIS_DIGITOS(quando.getMonth() + 1)}-${quando.getFullYear()}`;
  return [rotulo, identificacao, data].filter(Boolean).join(' — ');
}

/** Corpo multipart: metadados em JSON, depois o HTML. */
function montarCorpo(nome: string, html: string, fronteira: string): string {
  const metadados = JSON.stringify({ name: nome, mimeType: GOOGLE_DOC_MIME });
  return [
    `--${fronteira}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadados,
    `--${fronteira}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
    `--${fronteira}--`,
    '',
  ].join('\r\n');
}

export interface CriarDocInput {
  html: string;
  nome: string;
  /** Só para a mensagem de erro dizer qual documento falhou. */
  documentType?: DocumentType;
}

export async function criarGoogleDoc(input: CriarDocInput): Promise<GoogleDocResult> {
  let token: string;
  try {
    token = await getAuthToken();
  } catch (error) {
    const message = (error as Error).message ?? '';
    // "bad client id" é o sintoma de cliente OAuth não registrado, e a
    // mensagem crua não diz nada sobre a causa. Vale traduzir: é a diferença
    // entre cinco minutos no console e uma tarde procurando bug no código.
    const naoConfigurado = /client\s?id|invalid_client|não configurado|nao configurado/i.test(message);
    return {
      status: 'error',
      naoConfigurado,
      message: naoConfigurado
        ? 'O cliente OAuth do Google ainda não foi registrado para esta extensão. ' +
          'Ver docs/google-docs-setup.md.'
        : `O Chrome não conseguiu autorizar o acesso ao Google Drive: ${message}`,
    };
  }

  const fronteira = `taqciti-${crypto.randomUUID()}`;

  let response: Response;
  try {
    response = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${fronteira}`,
      },
      body: montarCorpo(input.nome, input.html, fronteira),
    });
  } catch {
    return { status: 'error', message: 'Não foi possível falar com o Google Drive.' };
  }

  if (!response.ok) {
    // 401 = token velho no cache do Chrome. Descartar aqui é o que permite a
    // próxima tentativa dar certo, em vez de repetir o mesmo erro para sempre.
    if (response.status === 401) {
      await descartarToken(token);
      return {
        status: 'error',
        message: 'A autorização do Google expirou. Tente gerar de novo.',
      };
    }
    if (response.status === 403) {
      return {
        status: 'error',
        message:
          'O Google recusou a criação do arquivo (403). Confira se a Drive API está ' +
          'ativada no projeto do Google Cloud.',
      };
    }
    return {
      status: 'error',
      message: `O Google Drive respondeu com erro (${response.status}).`,
    };
  }

  const dados = (await response.json()) as { id?: string; webViewLink?: string };
  if (!dados.id) {
    return { status: 'error', message: 'O Google Drive não devolveu o id do arquivo criado.' };
  }

  // `webViewLink` é o link canônico; a URL montada é só o plano B para o caso
  // de o campo não vir.
  return {
    status: 'success',
    url: dados.webViewLink ?? `https://docs.google.com/document/d/${dados.id}/edit`,
  };
}
