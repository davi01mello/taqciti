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
import { criarGoogleDoc, nomeDoArquivo, oauthConfigurado, type GoogleDocResult } from './googleDocs';
import { baixarComoHtml } from './baixarDocumento';

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
 * Como o documento chega até a pessoa.
 *
 * `docs`     — criado direto no Google Docs dela e aberto numa aba.
 * `download` — baixado como HTML, para ela subir no próprio Drive.
 */
export type Entrega =
  | { via: 'docs'; url: string }
  | { via: 'download'; arquivo: string }
  | { via: 'falhou'; message: string };

/**
 * Gera o documento e o entrega — que é o fluxo que o botão executa.
 *
 * **Qual caminho depende do manifesto, não de configuração no código.** Com
 * cliente OAuth registrado, o documento vai direto para o Google Docs e a aba
 * abre. Sem ele, baixa. A extensão nem TENTA o caminho direto quando não há
 * como autenticar: uma tentativa fadada ao "bad client id" só poria na cara do
 * usuário um erro de configuração que não é problema dele.
 *
 * A entrega NÃO derruba a geração. Se ela falhar, o documento gerado continua
 * sendo devolvido e aparece na tela — perder um documento que o servidor já
 * produziu, e já custou, por causa do passo seguinte seria trocar uma falha
 * parcial por uma total.
 */
export async function gerarEEntregar(
  source: GenerationSource,
  documentType: DocumentType,
  /** Avisa quando a geração termina e a entrega começa. A segunda etapa leva
   *  segundos, e sem rótulo próprio o botão parece travado. */
  onEtapa?: (etapa: 'gerando' | 'entregando') => void,
): Promise<{ generation: GenerationResult; entrega?: Entrega }> {
  onEtapa?.('gerando');
  const generation = await requestGeneration(source, documentType);
  if (generation.status !== 'success') return { generation };
  onEtapa?.('entregando');

  if (!generation.html) {
    return {
      generation,
      entrega: {
        via: 'falhou',
        message: 'O servidor não devolveu o HTML do documento.',
      },
    };
  }

  const nome = nomeDoArquivo(
    DOCUMENT_TYPE_LABELS[documentType],
    generation.metadata.projectName,
    source.title,
    new Date(source.startedAt),
  );

  if (!oauthConfigurado()) {
    baixarComoHtml(generation.html, nome);
    return { generation, entrega: { via: 'download', arquivo: `${nome}.html` } };
  }

  const upload = await criarGoogleDoc({ html: generation.html, documentType, nome });
  return {
    generation,
    entrega:
      upload.status === 'success'
        ? { via: 'docs', url: upload.url }
        : { via: 'falhou', message: upload.message },
  };
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
