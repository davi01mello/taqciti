/**
 * O CONTEXTO COMPACTADO: a fonte de raciocínio entre a transcrição bruta e
 * os agentes (Analista, Pensante, Auditor, Escritor).
 *
 * `anchor` é obrigatório e não é enfeite. A compactação já interpreta — a
 * especificação dá o exemplo: "a gente poderia talvez conversar com o
 * pessoal do banco" vira "A equipe considerou avaliar uma alteração na
 * arquitetura". Se a auditoria de uma seção `audit: 'strict'` validasse
 * contra a compactação em vez do original, estaria auditando o resumo, não
 * a reunião — nunca detectaria um erro introduzido na própria compactação.
 * Com `anchor`, a auditoria sempre pode voltar ao trecho original.
 *
 * PONTO CENTRAL DESTE TIPO: `start` e `end` são preenchidos por CÓDIGO, por
 * busca de string, nunca pelo modelo. LLM erra offset de caractere
 * sistematicamente, e âncora errada é pior que âncora nenhuma — dá falsa
 * confiança à auditoria. O modelo entrega `quote`; o código localiza.
 */

export interface StatementAnchor {
  /** Offset (em caracteres) do início de `quote` na transcrição BRUTA. */
  start: number;
  /** Offset do fim, exclusivo. */
  end: number;
  /**
   * true  = a citação foi encontrada literal, caractere por caractere.
   * false = só foi encontrada após normalização leve (espaços, aspas,
   *         caixa). O trecho ainda é válido, mas o modelo não copiou
   *         exatamente — e isso é sinal a acompanhar.
   */
  exact: boolean;
}

export interface CompactedStatement {
  id: string;
  /** A afirmação já compactada/interpretada, não a fala literal. */
  text: string;
  /** A citação literal que o modelo ALEGA sustentar `text`. Preservada como
   *  veio, mesmo quando não localizável — é a evidência do que ele afirmou. */
  quote: string;
  /**
   * Onde `quote` foi localizada na transcrição bruta.
   *
   * `null` significa que a citação não foi encontrada nem com normalização
   * leve. A afirmação é SUSPEITA: pode ser alucinação, ou o modelo pode ter
   * reescrito o trecho em vez de copiá-lo. De um jeito ou de outro, ela NÃO
   * pode sustentar nada em seção `audit: 'strict'` — ver `isSuspect`.
   */
  anchor: StatementAnchor | null;
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

/**
 * Afirmação sem âncora localizável. Derivado de `anchor`, e não um campo
 * próprio, de propósito: dois campos que dizem a mesma coisa acabam
 * discordando.
 */
export function isSuspect(statement: CompactedStatement): boolean {
  return statement.anchor === null;
}

/** As que podem sustentar seção `audit: 'strict'` (Participantes, Decisões). */
export function trustworthy(statements: CompactedStatement[]): CompactedStatement[] {
  return statements.filter((statement) => !isSuspect(statement));
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

/**
 * Saúde da compactação. A taxa de âncoras localizadas é o PRINCIPAL
 * indicador: foi a única métrica que pegou um modelo devolvendo citação com
 * caractere apagado — JSON válido, schema satisfeito, âncora inútil.
 */
export interface CompactionStats {
  transcriptChars: number;
  /** Soma dos `text` compactados. */
  compactedChars: number;
  /** transcriptChars / compactedChars. Abaixo de 1 é expansão, não compactação. */
  compactionRatio: number;
  statementCount: number;
  anchorsExact: number;
  anchorsNormalized: number;
  anchorsMissing: number;
  /** (exact + normalized) / total. */
  anchorRate: number;
  /** Quantas janelas a transcrição precisou. 1 = passada única. */
  windows: number;
  /** Afirmações idênticas removidas por virem na sobreposição entre janelas. */
  duplicatesRemoved: number;
}
