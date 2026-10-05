/**
 * O envio de e-mail — a mensagem MIME e a chamada ao Gmail.
 *
 * Só `gmail.send`: o Taq envia como a própria pessoa e NÃO lê a caixa dela.
 * Consequência honesta: não dá para conferir a pasta Enviados. Um envio que
 * deu tempo esgotado fica "desconhecido", e quem confere é a pessoa.
 *
 * ── Montagem ───────────────────────────────────────────────────────────────
 *
 * Tudo que vem de fora (assunto, nomes, endereços, nomes de arquivo) passa por
 * `limpaCabecalho`: uma quebra de linha num cabeçalho seria injeção de
 * cabeçalhos (um Bcc escondido, por exemplo). O corpo e os anexos viajam em
 * base64, então nenhum conteúdo pode forjar uma fronteira MIME.
 */
import { ESCOPO_GMAIL_ENVIAR } from './escopos';
import { chamarGoogle } from './google';

export const LIMITE_DE_ANEXOS_BYTES = 3 * 1024 * 1024;
export const MAX_DESTINATARIOS = 10;

const ENDERECO = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export const enderecoValido = (e: string): boolean => ENDERECO.test(e) && e.length <= 254;

/** CR, LF, NEL, e os separadores de linha e de parágrafo do Unicode. */
const QUEBRAS_DE_LINHA = new RegExp('[\\r\\n\\u0085\\u2028\\u2029]+', 'g');

export function limpaCabecalho(texto: string): string {
  return texto.replace(QUEBRAS_DE_LINHA, ' ').trim();
}

const utf8 = (texto: string) => new TextEncoder().encode(texto);

export function base64(bytes: Uint8Array): string {
  let bin = '';
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo)
    bin += String.fromCharCode(...bytes.subarray(i, i + passo));
  return btoa(bin);
}

export function base64Url(bytes: Uint8Array): string {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 2047: cabeçalho com acento ou símbolo vai como "encoded-word" em UTF-8. */
export function cabecalhoCodificado(texto: string): string {
  const limpo = limpaCabecalho(texto);
  if (/^[\x20-\x7e]*$/.test(limpo)) return limpo;
  return `=?UTF-8?B?${base64(utf8(limpo))}?=`;
}

/** Linhas de 76 colunas, como o MIME pede. */
const emLinhas = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n');

export interface AnexoDeEmail {
  nome: string;
  tipo: string;
  conteudo: Uint8Array;
}

export interface EmailParaEnviar {
  de: string;
  para: readonly string[];
  assunto: string;
  corpo: string;
  anexos?: readonly AnexoDeEmail[];
}

function nomeDeArquivo(nome: string): string {
  return limpaCabecalho(nome).replace(/["\\/]/g, '_').slice(0, 120) || 'anexo';
}

export function montarMime(m: EmailParaEnviar): string {
  for (const e of [m.de, ...m.para])
    if (!enderecoValido(e)) throw new Error(`Endereço inválido: ${limpaCabecalho(e).slice(0, 60)}`);
  const cabecalhos = [
    'MIME-Version: 1.0',
    `From: ${m.de}`,
    `To: ${m.para.join(', ')}`,
    `Subject: ${cabecalhoCodificado(m.assunto)}`,
  ];
  const parteTexto = [
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    emLinhas(base64(utf8(m.corpo))),
  ].join('\r\n');

  if (!m.anexos?.length) return [...cabecalhos, parteTexto].join('\r\n');

  const fronteira = `taqciti_${base64Url(crypto.getRandomValues(new Uint8Array(12)))}`;
  const partes = [`--${fronteira}`, parteTexto];
  for (const a of m.anexos) {
    const nome = nomeDeArquivo(a.nome);
    partes.push(
      `--${fronteira}`,
      [
        `Content-Type: ${/^[\w.+-]+\/[\w.+-]+$/.test(a.tipo) ? a.tipo : 'application/octet-stream'}; name="${nome}"`,
        `Content-Disposition: attachment; filename="${nome}"`,
        'Content-Transfer-Encoding: base64',
        '',
        emLinhas(base64(a.conteudo)),
      ].join('\r\n'),
    );
  }
  partes.push(`--${fronteira}--`, '');
  return [...cabecalhos, `Content-Type: multipart/mixed; boundary="${fronteira}"`, '', partes.join('\r\n')].join('\r\n');
}

export interface EnvioAceito {
  /** O id da mensagem no Gmail da pessoa. */
  idDaMensagem: string;
}

/**
 * Entrega a mensagem ao Gmail. "Aceito" quer dizer que o Gmail a pôs na fila de
 * envio da conta — não que o destinatário a recebeu: o Taq não tem como saber.
 *
 * Lança `ErroDeIntegracao`; `desfechoIncerto` separa "recusado, nada foi
 * enviado" de "não sei".
 */
export async function enviarPeloGmail(m: EmailParaEnviar): Promise<EnvioAceito> {
  const raw = base64Url(utf8(montarMime(m)));
  const { dados } = await chamarGoogle<{ id?: string }>({
    url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    metodo: 'POST',
    corpo: { raw },
    escopos: [ESCOPO_GMAIL_ENVIAR],
    // Mensagem grande demora: o envio tem mais folga que uma consulta.
    tempoMs: 30_000,
  });
  return { idDaMensagem: dados.id ?? '' };
}
