/**
 * Une o documento guardado (o que a seção "Documentos" lista) ao histórico de
 * versões (a árvore e as revisões). As duas gravações andam juntas: documento
 * sem histórico seria um personalizado que não dá para editar por versão, e
 * histórico sem documento seria dado órfão.
 */
import {
  apagarDocumento,
  atualizarDocumento,
  guardarDocumento,
  guardarDocumentoUnico,
  type DocumentoGuardado,
} from '../store';
import { arvoreParaMarkdown } from './markdown';
import type { PedidoDeGeracao, ResultadoDoServidor } from './tipos';
import {
  iniciarHistorico,
  lerHistorico,
  registrarVersao,
  type HistoricoDoDocumento,
  type VersaoDoDocumento,
} from './versoes';

export const TIPO_PERSONALIZADO = 'personalizado';

const daResposta = (
  r: ResultadoDoServidor,
  origem: VersaoDoDocumento['origem'],
  pedido: string,
): VersaoDoDocumento => ({
  revisao: r.arvore.revisao,
  arvore: r.arvore,
  criadaEm: Date.now(),
  origem,
  pedido,
  manifesto: r.manifesto,
  problemas: r.relatorio.problemas.length,
});

export interface DadosDeOrigem {
  meetingId?: string;
  conversationId?: string;
}

/**
 * Guarda o resultado de uma geração: o documento e a primeira versão.
 * Se o histórico não puder ser aberto, o documento é desfeito e o erro sobe —
 * a tela não pode dizer "Salvo" sobre um documento que não dá para editar.
 *
 * Com `criadoPor`, a criação é IDEMPOTENTE (o Taq pode repetir a chamada):
 * a mesma chave devolve o documento que já existe, com `jaExistia: true`.
 */
export async function guardarGeracao(
  resultado: ResultadoDoServidor,
  pedido: PedidoDeGeracao,
  origem: DadosDeOrigem = {},
  criadoPor?: { execucaoId: string; chave: string },
): Promise<{ documento: DocumentoGuardado; historico: HistoricoDoDocumento; jaExistia: boolean }> {
  const novo = {
    title: resultado.arvore.titulo,
    content: arvoreParaMarkdown(resultado.arvore),
    formato: 'markdown' as const,
    tipo: TIPO_PERSONALIZADO,
    origem: 'gerado' as const,
    ...origem,
  };

  let documento: DocumentoGuardado;
  if (criadoPor) {
    const unico = await guardarDocumentoUnico(novo, criadoPor);
    documento = unico.documento;
    if (unico.jaExistia) {
      const existente = await lerHistorico(documento.id);
      // Existe e tem histórico: é a mesma criação, repetida.
      if (existente) return { documento, historico: existente, jaExistia: true };
    }
  } else {
    documento = await guardarDocumento(novo);
  }

  try {
    const historico = await iniciarHistorico({
      documentoId: documento.id,
      ...(pedido.variante ? { variante: pedido.variante } : {}),
      fontesIds: pedido.fontes.map((f) => f.id),
      versao: daResposta(resultado, 'geracao', pedido.pedido),
    });
    return { documento, historico, jaExistia: false };
  } catch (erro) {
    await apagarDocumento(documento.id);
    throw erro;
  }
}
export type ResultadoDaEdicaoLocal =
  | { tipo: 'ok'; documento: DocumentoGuardado; historico: HistoricoDoDocumento }
  | { tipo: 'conflito'; atual: HistoricoDoDocumento }
  | { tipo: 'inexistente' }
  | { tipo: 'invalida'; motivo: string };

/**
 * Guarda o resultado de uma edição como nova versão, conferindo a revisão
 * que a pessoa estava vendo. Edição que não mudou nada (nenhuma operação
 * aplicada) não cria versão.
 */
export async function guardarEdicao(
  documentoId: string,
  revisaoEsperada: number,
  resultado: ResultadoDoServidor,
  pedido: string,
): Promise<ResultadoDaEdicaoLocal | { tipo: 'sem_mudanca' }> {
  if (resultado.aplicadas === 0) return { tipo: 'sem_mudanca' };

  const gravada = await registrarVersao(documentoId, revisaoEsperada, daResposta(resultado, 'edicao', pedido));
  if (gravada.tipo !== 'ok') return gravada;

  const documento = await atualizarDocumento(documentoId, {
    title: resultado.arvore.titulo,
    content: arvoreParaMarkdown(resultado.arvore),
  });
  if (!documento) return { tipo: 'inexistente' };
  return { tipo: 'ok', documento, historico: gravada.historico };
}
