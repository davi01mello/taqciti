/**
 * Contrato com POST /api/generate — extraído de DocumentPage.tsx pra ser
 * reaproveitado pelo menu "Gerar Documento" sem duplicar o fetch. Continua
 * sendo um stub no servidor por enquanto (ver server/README).
 */
import type { LiveSegment } from '@/shared/types/domain';
import {
  SERVER_BASE_URL,
  SERVER_SHARED_KEY,
  SERVER_SHARED_KEY_HEADER,
} from '@/shared/config/serverConfig';
import { transcriptToText } from '@/features/history/export';

/** Espelha DOCUMENT_TYPES em server/lib/generateDocument.ts. */
export type DocumentType = 'ata' | 'x1' | 'daily' | 'planning' | 'review';

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  ata: 'Ata de Reunião',
  x1: 'Doc Conversa (X1)',
  daily: 'Daily',
  planning: 'Planning',
  review: 'Review',
};

export interface GenerationSource {
  title: string;
  startedAt: number;
  segments: readonly LiveSegment[];
}

export type GenerationResult =
  | { status: 'success'; documentType: DocumentType; title: string; content: string }
  | { status: 'error'; documentType: DocumentType; message: string };

export async function requestGeneration(
  source: GenerationSource,
  documentType: DocumentType,
): Promise<GenerationResult> {
  try {
    const response = await fetch(`${SERVER_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [SERVER_SHARED_KEY_HEADER]: SERVER_SHARED_KEY,
      },
      body: JSON.stringify({
        transcript: transcriptToText(source.segments),
        title: source.title,
        date: new Date(source.startedAt).toISOString(),
        documentType,
      }),
    });

    if (!response.ok) {
      // 401 e 413 são os dois modos de falha que a tranca do servidor
      // introduziu; dizer só "erro 401" manda a pessoa procurar no lugar
      // errado.
      const message =
        response.status === 401
          ? 'O servidor recusou a chave da extensão. Confira DOCCITI_SHARED_KEY no servidor.'
          : response.status === 413
            ? 'A transcrição é longa demais para o servidor gerar o documento.'
            : `O servidor respondeu com erro (${response.status}).`;
      return { status: 'error', documentType, message };
    }

    const data = (await response.json()) as { title: string; content: string };
    return { status: 'success', documentType, title: data.title, content: data.content };
  } catch {
    return {
      status: 'error',
      documentType,
      message: 'Não foi possível falar com o servidor. Ele está rodando em localhost:3000?',
    };
  }
}
