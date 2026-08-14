/**
 * Contrato com POST /api/generate — extraído de DocumentPage.tsx pra ser
 * reaproveitado pelo menu "Gerar Documento" sem duplicar o fetch.
 *
 * O servidor devolve o mesmo documento em três formas, e as três importam:
 * `content` (markdown, para mostrar na hora), `html` (para o Google Docs) e
 * `documentData` (a estrutura, de onde as duas saem). Nada aqui reparseia o
 * markdown para produzir as outras — quando o PDF entrar, ele também sai do
 * `documentData`.
 */
import type { LiveSegment } from '@/shared/types/domain';
import {
  SERVER_BASE_URL,
  SERVER_SHARED_KEY,
  SERVER_SHARED_KEY_HEADER,
} from '@/shared/config/serverConfig';
import { transcriptToText } from '@/features/history/export';
import { criarGoogleDoc, nomeDoArquivo, type GoogleDocResult } from './googleDocs';

export type { GoogleDocResult };

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

/** Só o que a extensão consome do JSON intermediário. O servidor manda mais;
 *  espelhar o tipo inteiro aqui só criaria duas definições para divergirem. */
export interface DocumentMetadata {
  date?: string;
  projectName?: string;
}

export type GenerationResult =
  | {
      status: 'success';
      documentType: DocumentType;
      title: string;
      content: string;
      html: string;
      metadata: DocumentMetadata;
    }
  | { status: 'error'; documentType: DocumentType; message: string };

/**
 * Gera o documento e, em seguida, cria a ata no Google Docs de quem está
 * usando — que é o fluxo que o botão entrega.
 *
 * O envio ao Drive NÃO derruba a geração: se ele falhar (cliente OAuth não
 * registrado, autorização recusada, Drive fora do ar), o documento gerado
 * continua sendo devolvido e aparece na tela. Perder um documento que o
 * servidor já produziu — e pagou para produzir — por causa do passo seguinte
 * seria trocar uma falha parcial por uma total.
 */
export async function requestGenerationAndUpload(
  source: GenerationSource,
  documentType: DocumentType,
  /** Avisa quando a geração termina e o envio começa. A segunda etapa leva
   *  segundos, e sem rótulo próprio o botão parece travado. */
  onEtapa?: (etapa: 'gerando' | 'enviando') => void,
): Promise<{ generation: GenerationResult; upload?: GoogleDocResult }> {
  onEtapa?.('gerando');
  const generation = await requestGeneration(source, documentType);
  if (generation.status !== 'success') return { generation };
  onEtapa?.('enviando');

  if (!generation.html) {
    return {
      generation,
      upload: {
        status: 'error',
        message: 'O servidor não devolveu o HTML do documento — nada foi enviado ao Google Docs.',
      },
    };
  }

  const upload = await criarGoogleDoc({
    html: generation.html,
    documentType,
    nome: nomeDoArquivo(
      DOCUMENT_TYPE_LABELS[documentType],
      generation.metadata.projectName,
      source.title,
      new Date(source.startedAt),
    ),
  });

  return { generation, upload };
}

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
      // Dizer só "erro 401" manda a pessoa procurar no lugar errado. Cada
      // status aqui tem uma causa e uma ação diferentes.
      let message: string;
      if (response.status === 401) {
        message = 'O servidor recusou a chave da extensão. Confira DOCCITI_SHARED_KEY no servidor.';
      } else if (response.status === 413) {
        message = 'A transcrição é longa demais para o servidor gerar o documento.';
      } else if (response.status === 400) {
        // O 400 mais provável é a trava de política de dados: o servidor está
        // com uma chave de free tier, que manda o conteúdo para treinamento
        // do provedor, e recusa transcrição que não seja sintética. A
        // extensão captura reunião de verdade, então ela NÃO pode se declarar
        // sintética — o caminho é o servidor rodar com chave paga.
        const corpo = (await response.json().catch(() => ({}))) as { error?: string };
        message =
          corpo.error ??
          'O servidor recusou o pedido (400). Confira a configuração dele.';
      } else {
        message = `O servidor respondeu com erro (${response.status}).`;
      }
      return { status: 'error', documentType, message };
    }

    const data = (await response.json()) as {
      title: string;
      content: string;
      html?: string;
      documentData?: { metadata?: DocumentMetadata };
    };
    return {
      status: 'success',
      documentType,
      title: data.title,
      content: data.content,
      html: data.html ?? '',
      metadata: data.documentData?.metadata ?? {},
    };
  } catch {
    return {
      status: 'error',
      documentType,
      message: 'Não foi possível falar com o servidor. Ele está rodando em localhost:3000?',
    };
  }
}
