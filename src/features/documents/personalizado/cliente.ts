/**
 * Chamadas à API de documentos personalizados. Nenhuma delas se declara
 * `sintetica`: a extensão captura reunião de verdade, e a trava de política de
 * dados do servidor existe justamente para recusar isso quando a configuração
 * ativa manda o conteúdo para treinamento (mesma razão de `requestGeneration`).
 */
import {
  SERVER_BASE_URL,
  SERVER_SHARED_KEY,
  SERVER_SHARED_KEY_HEADER,
} from '@/shared/config/serverConfig';
import type {
  ArvoreDoDocumento,
  ManifestoDeRender,
  PedidoDeEdicao,
  PedidoDeGeracao,
  ResultadoDoServidor,
} from './tipos';

export type CodigoDeErro =
  | 'chave'
  | 'invalido'
  | 'longo'
  | 'conflito'
  | 'sem_conteudo'
  | 'indisponivel'
  | 'rede';

export type RespostaDoServidor<T> =
  | { status: 'ok'; dados: T }
  | { status: 'erro'; codigo: CodigoDeErro; message: string };

async function chamar<T>(rota: string, corpo: unknown): Promise<RespostaDoServidor<T>> {
  let resposta: Response;
  try {
    resposta = await fetch(`${SERVER_BASE_URL}/api/documentos/${rota}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [SERVER_SHARED_KEY_HEADER]: SERVER_SHARED_KEY },
      body: JSON.stringify(corpo),
    });
  } catch {
    // Mesma ambiguidade de `requestGeneration`: servidor fora do ar ou
    // chamada bloqueada pelo navegador. Diz os dois.
    return {
      status: 'erro',
      codigo: 'rede',
      message:
        `Não foi possível falar com o servidor (${SERVER_BASE_URL}). Ele pode estar fora do ar, ` +
        'ou o navegador pode ter bloqueado a chamada — o console (F12) diz qual dos dois.',
    };
  }

  if (resposta.ok) return { status: 'ok', dados: (await resposta.json()) as T };

  const doServidor = ((await resposta.json().catch(() => ({}))) as { error?: string }).error;
  switch (resposta.status) {
    case 401:
      return { status: 'erro', codigo: 'chave', message: 'O servidor recusou a chave da extensão.' };
    case 400:
      return { status: 'erro', codigo: 'invalido', message: doServidor ?? 'O servidor recusou o pedido (400).' };
    case 413:
      return {
        status: 'erro',
        codigo: 'longo',
        message: doServidor ?? 'As fontes são longas demais. Selecione menos reuniões ou um recorte menor.',
      };
    case 409:
      return {
        status: 'erro',
        codigo: 'conflito',
        message: doServidor ?? 'O documento mudou desde que você o abriu.',
      };
    case 422:
      return {
        status: 'erro',
        codigo: 'sem_conteudo',
        message: doServidor ?? 'Não foi possível montar o documento com as fontes selecionadas.',
      };
    default:
      return {
        status: 'erro',
        codigo: 'indisponivel',
        message: doServidor ?? `O servidor respondeu com erro (${resposta.status}). Tente de novo em instantes.`,
      };
  }
}

export const gerarPersonalizado = (pedido: PedidoDeGeracao) =>
  chamar<ResultadoDoServidor>('gerar', pedido);

export const editarPersonalizado = (pedido: PedidoDeEdicao) =>
  chamar<ResultadoDoServidor>('editar', pedido);

/** Árvore → arquivo, sem modelo: abre uma versão antiga ou baixa de novo. */
export const renderizarArvore = (
  arvore: ArvoreDoDocumento,
  variante?: string,
  formatos: ReadonlyArray<'pdf' | 'docx'> = ['pdf'],
) =>
  chamar<{
    /** Presente quando `pdf` foi pedido. */
    pdf?: string;
    /** Presente quando `docx` foi pedido. */
    docx?: string;
    manifesto: ManifestoDeRender;
    avisos: string[];
    substituicoes: string[];
  }>('renderizar', { arvore, ...(variante ? { variante } : {}), formatos });
