/**
 * Tipo do CONTEXTO COMPACTADO previsto na especificação — a fonte de
 * raciocínio que caberia entre a transcrição bruta e os agentes (Analista,
 * Pensante, Auditor, Escritor). Só o tipo nesta rodada: nenhuma
 * implementação de compactação, nenhum agente.
 *
 * `anchor` é obrigatório e não é enfeite. A compactação já interpreta — a
 * própria especificação dá o exemplo: "a gente poderia talvez conversar com
 * o pessoal do banco" vira "A equipe considerou avaliar uma alteração na
 * arquitetura". Se a auditoria de uma seção `audit: 'strict'` (ver
 * templates/types.ts) validasse contra a compactação em vez do original,
 * estaria auditando o resumo, não a reunião — nunca detectaria um erro
 * introduzido na própria compactação. Com `anchor`, a auditoria sempre pode
 * voltar ao trecho original.
 */
export interface CompactedStatement {
  id: string;
  /** A afirmação já compactada/interpretada, não a fala literal. */
  text: string;
  /** Ponteiro pro trecho ORIGINAL da transcrição bruta que sustenta `text`. */
  anchor: {
    /** Offset ou índice de linha na transcrição bruta. */
    start: number;
    end: number;
    /** Trecho literal, quando curto o suficiente pra valer citar. */
    quote?: string;
  };
  kind:
    | 'context'
    | 'argument'
    | 'decision'
    | 'commitment'
    | 'deadline'
    | 'risk'
    | 'question'
    | 'other';
}

export interface CompactedContext {
  statements: CompactedStatement[];
  entities: {
    people: string[];
    projects: string[];
    companies: string[];
    technologies: string[];
  };
}
