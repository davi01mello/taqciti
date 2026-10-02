/**
 * StorageAdapter — o único caminho do Taq até a persistência que já existe.
 *
 * Nada aqui é armazenamento novo para registro: reuniões continuam em
 * `taq:history` (escritas só pelo background), documentos em `taq:documents`
 * (pelo store deles, com a mesma trava), conversas em `taq:conversations`. O
 * adaptador só LÊ reuniões e usa as duas operações seguras do store de
 * documentos — criação idempotente e edição com verificação de versão.
 *
 * O que é novo é o registro das EXECUÇÕES (`taq:execucoes`): quem rodou, quanto
 * durou, que ferramentas, que falhas, quanto o provedor disse que gastou. Não
 * guarda conteúdo de registro, resultado de ferramenta nem raciocínio — só o
 * que responde "o que o assistente fez?".
 *
 * É uma interface porque os testes do runtime rodam contra ela com dados em
 * memória, e a extensão contra o `chrome.storage`.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, readSession, writeLocal } from '@/shared/services/storage';
import { comTravaLocal } from '@/shared/services/storageLock';
import type { MeetingRecord, MeetingState } from '@/shared/types/domain';
import {
  atualizarCompromisso,
  guardarAchado,
  guardarAnalise,
  lerTrabalho,
  mudarEstadoDoAchado,
  registrarCompromissos,
  registrarDecisao,
  vincularDependencia,
} from '@/features/trabalho/store';
import {
  atualizarDocumentoNaVersao,
  guardarDocumentoUnico,
  lerDocumentos,
  type DocumentoGuardado,
  type NovoDocumento,
  type ResultadoDaEdicaoComVersao,
} from '@/features/documents/store';
import {
  apagarConversas,
  conversaFoiApagada,
  lerConversas,
  type Conversation,
  type ResultadoDaExclusao,
} from '@/home/conversations';
import type { RegistroDeExecucao } from './execucoes';

export interface ArmazenamentoDoTaq {
  listarReunioes(): Promise<readonly MeetingRecord[]>;
  obterReuniao(id: string): Promise<MeetingRecord | null>;
  listarDocumentos(): Promise<readonly DocumentoGuardado[]>;
  obterDocumento(id: string): Promise<DocumentoGuardado | null>;
  criarDocumento(
    novo: NovoDocumento,
    criadoPor: { execucaoId: string; chave: string },
  ): Promise<{ documento: DocumentoGuardado; jaExistia: boolean }>;
  editarDocumento(
    id: string,
    versaoEsperada: number,
    patch: { title?: string; content?: string },
  ): Promise<ResultadoDaEdicaoComVersao>;
  gravarExecucao(registro: RegistroDeExecucao): Promise<void>;
  /** As conversas guardadas — as mesmas que a HOME e a sidebar listam. */
  listarConversas(): Promise<readonly Conversation[]>;
  /** A exclusão da tela (`apagarConversas`): conversa sai, reuniões e documentos ficam. */
  apagarConversas(ids: readonly string[]): Promise<ResultadoDaExclusao>;
  /** Os registros de trabalho e as escritas seguras deles (`features/trabalho/store.ts`). */
  trabalho: PortaDoTrabalho;
  /**
   * O estado VIVO da captura (fase, saúde, último trecho), do `storage.session`
   * que o background escreve. `null` quando não há reunião em curso ou a
   * superfície não alcança esse storage — e aí ninguém afirma nada sobre ele.
   */
  lerEstadoAoVivo(): Promise<MeetingState | null>;
}

export interface PortaDoTrabalho {
  ler: typeof lerTrabalho;
  registrarCompromissos: typeof registrarCompromissos;
  atualizarCompromisso: typeof atualizarCompromisso;
  vincularDependencia: typeof vincularDependencia;
  registrarDecisao: typeof registrarDecisao;
  guardarAchado: typeof guardarAchado;
  mudarEstadoDoAchado: typeof mudarEstadoDoAchado;
  guardarAnalise: typeof guardarAnalise;
}

/** Versão de uma reunião: muda enquanto a captura acrescenta falas. */
export function versaoDaReuniao(r: Pick<MeetingRecord, 'endedAt' | 'segments'>): string {
  return `${r.endedAt}:${r.segments.length}`;
}

/** Quantas execuções ficam guardadas. É registro de operação, não histórico. */
const MAX_EXECUCOES = 50;

async function lerReunioes(): Promise<MeetingRecord[]> {
  const bruto = await readLocal<unknown>(STORAGE_KEYS.history);
  if (!Array.isArray(bruto)) return [];
  return bruto.filter(
    (r): r is MeetingRecord =>
      !!r &&
      typeof (r as MeetingRecord).id === 'string' &&
      Array.isArray((r as MeetingRecord).segments),
  );
}

export const armazenamentoLocal: ArmazenamentoDoTaq = {
  listarReunioes: lerReunioes,
  async obterReuniao(id) {
    return (await lerReunioes()).find((r) => r.id === id) ?? null;
  },
  listarDocumentos: lerDocumentos,
  async obterDocumento(id) {
    return (await lerDocumentos()).find((d) => d.id === id) ?? null;
  },
  criarDocumento: guardarDocumentoUnico,
  editarDocumento: atualizarDocumentoNaVersao,
  listarConversas: lerConversas,
  apagarConversas,
  trabalho: {
    ler: lerTrabalho,
    registrarCompromissos,
    atualizarCompromisso,
    vincularDependencia,
    registrarDecisao,
    guardarAchado,
    mudarEstadoDoAchado,
    guardarAnalise,
  },
  async lerEstadoAoVivo() {
    try {
      const s = await readSession<MeetingState>(STORAGE_KEYS.state);
      return s && typeof s === 'object' && typeof s.phase === 'string' ? s : null;
    } catch {
      return null;
    }
  },
  async gravarExecucao(registro) {
    // A execução pode ter apagado a própria conversa (ou ela ter sido apagada
    // no meio): o registro fica, mas sem apontar para uma conversa que não
    // existe — ele era dado derivado dela.
    if (conversaFoiApagada(registro.conversaId))
      registro = { ...registro, conversaId: '(conversa apagada)' };
    await comTravaLocal(STORAGE_KEYS.taqExecucoes, async () => {
      const atuais =
        (await readLocal<RegistroDeExecucao[]>(STORAGE_KEYS.taqExecucoes)) ?? [];
      const lista = Array.isArray(atuais) ? atuais : [];
      await writeLocal(
        STORAGE_KEYS.taqExecucoes,
        [registro, ...lista].slice(0, MAX_EXECUCOES),
      );
    });
  },
};
