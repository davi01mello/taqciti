/**
 * O histórico de versões dos documentos personalizados.
 *
 * Cada versão é a ÁRVORE de uma revisão — a fonte de verdade do documento — e
 * o manifesto da renderização, sem o PDF: o arquivo é derivado da árvore pelo
 * servidor (`renderizarArvore`) e guardá-lo aqui estouraria a cota do storage
 * por documento. O que se guarda basta para reabrir qualquer versão, comparar,
 * restaurar e saber se um arquivo baixado ainda corresponde à revisão atual
 * (`manifesto.revisaoDoConteudo`).
 *
 * Escrever exige a revisão que quem escreve LEU. Revisão diferente = alguém
 * gravou no meio (outra aba, outra execução do Taq) e a gravação é recusada
 * com o estado atual, em vez de sobrescrever em silêncio. Mesma regra de
 * `atualizarDocumentoNaVersao`.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { comTravaLocal } from '@/shared/services/storageLock';
import { readLocal, writeLocal } from '@/shared/services/storage';
import type { ArvoreDoDocumento, ManifestoDeRender } from './tipos';

/** Mais que isto e as mais antigas saem — nunca a atual. */
export const MAX_VERSOES = 30;

export type OrigemDaVersao = 'geracao' | 'edicao' | 'restauracao';

export interface VersaoDoDocumento {
  revisao: number;
  arvore: ArvoreDoDocumento;
  criadaEm: number;
  origem: OrigemDaVersao;
  /** O pedido em linguagem natural que produziu esta versão. */
  pedido?: string;
  /** Ausente numa versão restaurada, até alguém renderizá-la. */
  manifesto?: ManifestoDeRender;
  /** Quantos problemas o relatório de qualidade apontou. */
  problemas: number;
}

export interface HistoricoDoDocumento {
  /** O `id` do `DocumentoGuardado`. */
  documentoId: string;
  variante?: string;
  /** Reuniões/documentos que serviram de fonte — para reabrir a edição com elas. */
  fontesIds: string[];
  /** Da mais antiga para a mais nova: a última é a versão atual. */
  versoes: VersaoDoDocumento[];
}

function ehHistorico(v: unknown): v is HistoricoDoDocumento {
  if (!v || typeof v !== 'object') return false;
  const h = v as Partial<HistoricoDoDocumento>;
  return typeof h.documentoId === 'string' && Array.isArray(h.versoes) && h.versoes.length > 0;
}

async function lerTodos(): Promise<HistoricoDoDocumento[]> {
  const bruto = await readLocal<unknown>(STORAGE_KEYS.documentVersions);
  if (bruto !== null && !Array.isArray(bruto)) {
    throw new Error('Não foi possível ler o histórico de versões dos documentos');
  }
  return Array.isArray(bruto) ? bruto.filter(ehHistorico) : [];
}

async function gravarTodos(lista: HistoricoDoDocumento[]): Promise<void> {
  await writeLocal(STORAGE_KEYS.documentVersions, lista);
}

export async function lerHistorico(documentoId: string): Promise<HistoricoDoDocumento | null> {
  return (await lerTodos()).find((h) => h.documentoId === documentoId) ?? null;
}

export const versaoAtual = (h: HistoricoDoDocumento): VersaoDoDocumento =>
  h.versoes[h.versoes.length - 1]!;

function podar(versoes: VersaoDoDocumento[]): VersaoDoDocumento[] {
  return versoes.length > MAX_VERSOES ? versoes.slice(versoes.length - MAX_VERSOES) : versoes;
}

export interface NovoHistorico {
  documentoId: string;
  variante?: string;
  fontesIds: string[];
  versao: VersaoDoDocumento;
}

/** Abre o histórico de um documento recém-criado, com a versão de origem. */
export async function iniciarHistorico(novo: NovoHistorico): Promise<HistoricoDoDocumento> {
  return comTravaLocal(STORAGE_KEYS.documentVersions, async () => {
    const todos = await lerTodos();
    if (todos.some((h) => h.documentoId === novo.documentoId)) {
      throw new Error(`O documento ${novo.documentoId} já tem histórico.`);
    }
    const historico: HistoricoDoDocumento = {
      documentoId: novo.documentoId,
      ...(novo.variante ? { variante: novo.variante } : {}),
      fontesIds: [...novo.fontesIds],
      versoes: [novo.versao],
    };
    await gravarTodos([...todos, historico]);
    return historico;
  });
}

export type ResultadoDaGravacaoDeVersao =
  | { tipo: 'ok'; historico: HistoricoDoDocumento }
  | { tipo: 'conflito'; atual: HistoricoDoDocumento }
  | { tipo: 'inexistente' }
  | { tipo: 'invalida'; motivo: string };

/**
 * Acrescenta uma versão SÓ se a atual ainda for a `revisaoEsperada`. A versão
 * nova precisa ter revisão maior que a atual: revisão não anda para trás.
 */
export async function registrarVersao(
  documentoId: string,
  revisaoEsperada: number,
  versao: VersaoDoDocumento,
): Promise<ResultadoDaGravacaoDeVersao> {
  return comTravaLocal(STORAGE_KEYS.documentVersions, async () => {
    const todos = await lerTodos();
    const atual = todos.find((h) => h.documentoId === documentoId);
    if (!atual) return { tipo: 'inexistente' };
    if (versaoAtual(atual).revisao !== revisaoEsperada) return { tipo: 'conflito', atual };
    if (versao.revisao <= revisaoEsperada) {
      return { tipo: 'invalida', motivo: 'A revisão nova precisa ser maior que a atual.' };
    }
    const proximo: HistoricoDoDocumento = { ...atual, versoes: podar([...atual.versoes, versao]) };
    await gravarTodos(todos.map((h) => (h.documentoId === documentoId ? proximo : h)));
    return { tipo: 'ok', historico: proximo };
  });
}

/**
 * Volta a uma versão anterior COMO uma versão nova (a revisão sobe): o
 * histórico nunca é reescrito, e desfazer a restauração é restaurar de novo.
 * O arquivo da versão restaurada ainda não existe — `manifesto` fica ausente
 * até alguém renderizar.
 */
export async function restaurarVersao(
  documentoId: string,
  revisaoAlvo: number,
  revisaoEsperada: number,
): Promise<ResultadoDaGravacaoDeVersao> {
  return comTravaLocal(STORAGE_KEYS.documentVersions, async () => {
    const todos = await lerTodos();
    const atual = todos.find((h) => h.documentoId === documentoId);
    if (!atual) return { tipo: 'inexistente' };
    const corrente = versaoAtual(atual);
    if (corrente.revisao !== revisaoEsperada) return { tipo: 'conflito', atual };
    const alvo = atual.versoes.find((v) => v.revisao === revisaoAlvo);
    if (!alvo) return { tipo: 'invalida', motivo: `A revisão ${revisaoAlvo} não está no histórico.` };

    const revisao = corrente.revisao + 1;
    const restaurada: VersaoDoDocumento = {
      revisao,
      arvore: { ...alvo.arvore, revisao },
      criadaEm: Date.now(),
      origem: 'restauracao',
      pedido: `Restaurada a revisão ${revisaoAlvo}`,
      problemas: alvo.problemas,
    };
    const proximo: HistoricoDoDocumento = { ...atual, versoes: podar([...atual.versoes, restaurada]) };
    await gravarTodos(todos.map((h) => (h.documentoId === documentoId ? proximo : h)));
    return { tipo: 'ok', historico: proximo };
  });
}

export async function apagarHistorico(documentoId: string): Promise<void> {
  return comTravaLocal(STORAGE_KEYS.documentVersions, async () => {
    const todos = await lerTodos();
    if (!todos.some((h) => h.documentoId === documentoId)) return;
    await gravarTodos(todos.filter((h) => h.documentoId !== documentoId));
  });
}
