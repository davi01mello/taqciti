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
import { fetchDeIa } from '@/shared/services/identidade';
import {
  comPrazo,
  mensagemDeRecusa,
  PRAZO_ESGOTADO,
  semConexao,
} from '@/shared/services/respostaDoServidor';
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
  | 'rede'
  | 'prazo'
  /** Quem pediu cancelou. A mensagem vem vazia: não há o que dizer. */
  | 'cancelado';

export type RespostaDoServidor<T> =
  | { status: 'ok'; dados: T }
  | { status: 'erro'; codigo: CodigoDeErro; message: string };

async function chamar<T>(rota: string, corpo: unknown, sinal?: AbortSignal): Promise<RespostaDoServidor<T>> {
  const corte = comPrazo(sinal);
  try {
    const resposta = await fetchDeIa(`${SERVER_BASE_URL}/api/documentos/${rota}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [SERVER_SHARED_KEY_HEADER]: SERVER_SHARED_KEY },
      body: JSON.stringify(corpo),
      signal: corte.signal,
    });
    if (resposta.ok) return { status: 'ok', dados: (await resposta.json()) as T };
    return {
      status: 'erro',
      codigo: CODIGO_POR_STATUS[resposta.status] ?? 'indisponivel',
      message: await mensagemDeRecusa(resposta, `/api/documentos/${rota}`),
    };
  } catch {
    if (corte.cancelado()) return { status: 'erro', codigo: 'cancelado', message: '' };
    if (corte.esgotado()) return { status: 'erro', codigo: 'prazo', message: PRAZO_ESGOTADO };
    return { status: 'erro', codigo: 'rede', message: semConexao(`/api/documentos/${rota}`) };
  }
}

const CODIGO_POR_STATUS: Partial<Record<number, CodigoDeErro>> = {
  400: 'invalido',
  401: 'chave',
  409: 'conflito',
  413: 'longo',
  422: 'sem_conteudo',
};

export const gerarPersonalizado = (pedido: PedidoDeGeracao, sinal?: AbortSignal) =>
  chamar<ResultadoDoServidor>('gerar', pedido, sinal);

export const editarPersonalizado = (pedido: PedidoDeEdicao, sinal?: AbortSignal) =>
  chamar<ResultadoDoServidor>('editar', pedido, sinal);

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
