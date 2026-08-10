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
  /**
   * Custo de auditar esta seção contra o trecho original da reunião:
   * 'strict' = inventar aqui custa caro, precisa conferir contra a
   *            transcrição (ex.: quem disse o quê, decisões tomadas);
   * 'light'  = conferência superficial basta;
   * 'none'   = síntese/prosa ou dado vindo do usuário — não há o que auditar.
   */
  audit: 'strict' | 'light' | 'none';
  /** Perguntas objetivas ao usuário quando a informação não puder ser
   *  determinada a partir da transcrição. Vazio = a seção degrada
   *  silenciosamente em vez de perguntar. */
  askWhenMissing: string[];
  /** true = sem conteúdo, a seção some do documento em vez de aparecer vazia. */
  omitWhenEmpty: boolean;
}

export interface DocumentTemplate {
  documentType: DocumentType;
  label: string;
  sections: SectionSpec[];
}
