/**
 * O que a extensão guarda → o que o conector expõe.
 *
 * ── Por que os tipos são espelhados, e não importados ────────────────────
 *
 * O servidor é um projeto independente (`server/`), com `package.json` e
 * `tsconfig` próprios; não há como importar de lá. Então as formas abaixo
 * espelham `server/lib/conector/tipos.ts`, e é o mesmo trato já usado em
 * `document/generateDocument.ts`: espelhar só o que ESTA ponta produz, com
 * um ponteiro para a origem, em vez de duplicar o tipo inteiro.
 *
 * Se as duas divergirem, o servidor grava o que recebeu — ele valida `tipo` e
 * `id`, não o resto. O que protege de verdade é a bateria de testes do
 * conector rodar contra dados com esta MESMA forma.
 *
 * ── O que fica de fora, e por quê ────────────────────────────────────────
 *
 * Um `Print` é um `data:image/jpeg;base64,…` — uma captura de tela vira
 * dezenas de milhares de tokens na janela de contexto de quem perguntar, e
 * megabytes trafegados a cada sincronização. Sobe a CONTAGEM, nunca a
 * imagem. Pelo mesmo motivo ficam fora `speakersObserved` (telemetria do
 * parser de legenda) e `providerParticipantId` (id opaco de tile).
 *
 * `dataUrl` também não serve para nada do outro lado: o conector é texto.
 */
import type { MeetingRecord } from '@/shared/types/domain';
import type { DocumentoGuardado } from '@/features/documents/store';
import type { Conversation } from '@/home/conversations';
import type { Nota } from '@/features/annotations/notes';
import type { MarcasDaReuniao, TipoDeMarca } from '@/features/annotations/marks';

export type TipoDeItem = 'reuniao' | 'documento' | 'conversa' | 'nota';

export interface Fala {
  falante: string | null;
  texto: string;
  offsetMs: number;
}

export interface ReuniaoDoAcervo {
  id: string;
  titulo: string;
  inicioMs: number;
  duracaoSegundos: number;
  participantes: string[];
  falas: Fala[];
}

export interface DocumentoDoAcervo {
  id: string;
  titulo: string;
  texto: string;
  criadoMs: number;
  atualizadoMs: number;
  tipoGerado?: string;
  reuniaoId?: string;
}

export interface MensagemDaConversa {
  autor: 'pessoa' | 'assistente';
  texto: string;
  emMs: number;
}

export interface ConversaDoAcervo {
  id: string;
  titulo: string;
  criadaMs: number;
  atualizadaMs: number;
  mensagens: MensagemDaConversa[];
  reuniaoId?: string;
}

export interface NotaDoAcervo {
  id: string;
  reuniaoId: string;
  reuniaoTitulo: string;
  texto: string;
  atualizadaMs: number;
  marcacoes: Partial<Record<TipoDeMarca, number>>;
  prints: number;
}

export interface ItemParaOAcervo {
  tipo: TipoDeItem;
  item: ReuniaoDoAcervo | DocumentoDoAcervo | ConversaDoAcervo | NotaDoAcervo;
}

export function reuniaoParaOAcervo(r: MeetingRecord): ReuniaoDoAcervo {
  return {
    id: r.id,
    titulo: r.title,
    inicioMs: r.startedAt,
    duracaoSegundos: r.durationSeconds,
    // Só os nomes: papel, confiança e id de tile não respondem pergunta
    // nenhuma do outro lado.
    participantes: r.participants.map((p) => p.name),
    falas: r.segments.map((s) => ({
      falante: s.speaker,
      texto: s.text,
      // O fim de uma fala é o começo da próxima para todo efeito de leitura;
      // mandar os dois seria um número por fala sem pergunta que ele responda.
      offsetMs: s.startOffsetMs,
    })),
  };
}

export function documentoParaOAcervo(d: DocumentoGuardado): DocumentoDoAcervo {
  return {
    id: d.id,
    titulo: d.title,
    texto: d.content,
    criadoMs: d.createdAt,
    atualizadoMs: d.updatedAt,
    ...(d.tipo ? { tipoGerado: d.tipo } : {}),
    ...(d.meetingId ? { reuniaoId: d.meetingId } : {}),
  };
}

export function conversaParaOAcervo(c: Conversation): ConversaDoAcervo {
  return {
    id: c.id,
    titulo: c.title,
    criadaMs: c.createdAt,
    atualizadaMs: c.updatedAt,
    mensagens: c.messages.map((m) => ({
      autor: m.role === 'user' ? ('pessoa' as const) : ('assistente' as const),
      texto: m.text,
      emMs: m.at,
    })),
    ...(c.meetingId ? { reuniaoId: c.meetingId } : {}),
  };
}

/** Conta as marcações por tipo. O conector mostra a contagem, não os ids. */
export function contarMarcacoes(marcas: MarcasDaReuniao): Partial<Record<TipoDeMarca, number>> {
  const conta: Partial<Record<TipoDeMarca, number>> = {};
  for (const tipo of Object.values(marcas)) {
    conta[tipo] = (conta[tipo] ?? 0) + 1;
  }
  return conta;
}

export function notaParaOAcervo(
  nota: Nota,
  reuniaoTitulo: string,
  marcas: MarcasDaReuniao,
  prints: number,
): NotaDoAcervo {
  return {
    id: nota.meetingId,
    reuniaoId: nota.meetingId,
    // Desnormalizado de propósito: a nota precisa ser legível sozinha num
    // resultado de busca, e a reunião pode nem ter sido sincronizada.
    reuniaoTitulo,
    texto: nota.texto,
    atualizadaMs: nota.updatedAt,
    marcacoes: contarMarcacoes(marcas),
    prints,
  };
}
