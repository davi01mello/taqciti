import type { DocumentType } from '../documentTypes';

/** `id` estável, usado depois pra regenerar só esta seção sem mexer nas outras. */
export interface SectionSpec {
  id: string;
  title: string;
  order: number;
  /** Se true, a ausência de conteúdo suficiente na transcrição vira pergunta. */
  required: boolean;
  /** Que informação da transcrição esta seção exige. Vazio quando o prompt
   *  atual não especifica isso — não inventado, ver observação no template. */
  needs: string[];
  /** Instrução de redação pra IA, específica da seção. Vazio quando o
   *  prompt atual não diz nada sobre a seção — não inventado. */
  guidance: string;
}

export interface DocumentTemplate {
  documentType: DocumentType;
  label: string;
  sections: SectionSpec[];
}
