/**
 * Tarefa de referência para comparar modelos: a compactação do Analista.
 *
 * É a escolha certa para uma medição curta por três razões. É a chamada mais
 * cara do pipeline (lê a transcrição inteira), então o custo dela extrapola
 * melhor que o de qualquer outra. É a que produz `quote`, e a taxa de âncoras
 * localizadas literalmente é o principal indicador de saúde da compactação —
 * dá para medir em código, sem julgamento. E o campo `kind` obriga o modelo a
 * separar proposta de decisão, que é o discriminador que mais importa entre
 * modelos.
 *
 * O prompt é NEUTRO quanto ao provedor de propósito: nada de "você é o
 * Claude", nenhuma convenção de formatação de um fornecedor. É a condição
 * para a comparação significar alguma coisa. Quando a Fase 7 mover os
 * prompts para arquivos versionados, este texto vira `analista/v1.md`.
 */
import { createLocator } from '../agents/anchoring';
import type { JsonSchema } from './types';

export const BENCH_SYSTEM = [
  'Você compacta transcrições de reunião preservando significado, não resumindo superficialmente.',
  '',
  'Preserve: contexto, argumentos, justificativas, decisões, discordâncias, dúvidas,',
  'responsabilidades, prazos, compromissos, riscos, pendências, nomes, projetos e entidades.',
  'Não descarte informação por parecer pequena.',
  '',
  'Para cada afirmação, forneça:',
  '- `text`: a afirmação já compactada e interpretada, não a fala literal;',
  '- `quote`: um trecho LITERAL da transcrição, copiado caractere por caractere,',
  '  que sustenta a afirmação. O trecho precisa existir exatamente como escrito;',
  '- `kind`: a classificação da afirmação.',
  '',
  'Sobre `kind`, a distinção que mais importa:',
  'DECISION é apenas aquilo que foi efetivamente decidido, acordado ou aprovado.',
  'Proposta, sugestão e possibilidade NÃO são decisão — "podemos fazer",',
  '"talvez seja melhor", "sugiro" e "vamos pensar nisso" são ARGUMENT, não DECISION.',
  'Concordância explícita transforma uma proposta em decisão.',
].join('\n');

export const BENCH_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    statements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          quote: { type: 'string' },
          kind: {
            type: 'string',
            enum: [
              'context',
              'argument',
              'decision',
              'commitment',
              'deadline',
              'risk',
              'question',
              'other',
            ],
          },
        },
        required: ['text', 'quote', 'kind'],
      },
    },
    entities: {
      type: 'object',
      properties: {
        people: { type: 'array', items: { type: 'string' } },
        projects: { type: 'array', items: { type: 'string' } },
        companies: { type: 'array', items: { type: 'string' } },
        technologies: { type: 'array', items: { type: 'string' } },
      },
      required: ['people', 'projects', 'companies', 'technologies'],
    },
  },
  required: ['statements', 'entities'],
};

export interface BenchStatement {
  text: string;
  quote: string;
  kind: string;
}

export interface BenchOutput {
  statements: BenchStatement[];
  entities: { people: string[]; projects: string[]; companies: string[]; technologies: string[] };
}

export interface AnchorReport {
  total: number;
  /** Encontrados por busca literal, sem nenhuma tolerância. */
  exatos: number;
  /** Encontrados só depois de normalizar espaços, aspas e caixa. */
  normalizados: number;
  /** Não encontrados de jeito nenhum — afirmações suspeitas. */
  perdidos: number;
  /** (exatos + normalizados) / total. */
  taxa: number;
  exemplosPerdidos: string[];
}

/**
 * Confere cada `quote` contra a transcrição. Esta é a métrica que a Fase 2
 * vai usar para preencher `anchor.start`/`end`: âncora que não se localiza
 * é pior que âncora nenhuma, porque dá falsa confiança à auditoria.
 */
export function checkAnchors(statements: BenchStatement[], transcript: string): AnchorReport {
  // Usa o MESMO localizador do Analista, de propósito: se o bench medisse a
  // âncora por um critério próprio, ele estaria comparando modelos numa
  // régua que o pipeline não usa, e um modelo poderia parecer bom aqui e
  // ruim em produção.
  const locator = createLocator(transcript);
  let exatos = 0;
  let normalizados = 0;
  const perdidos: string[] = [];

  for (const statement of statements) {
    const quote = statement.quote ?? '';
    const anchor = locator.locate(quote);
    if (anchor?.exact) exatos += 1;
    else if (anchor) normalizados += 1;
    else perdidos.push(quote.slice(0, 90));
  }

  const total = statements.length;
  return {
    total,
    exatos,
    normalizados,
    perdidos: perdidos.length,
    taxa: total === 0 ? 0 : (exatos + normalizados) / total,
    exemplosPerdidos: perdidos.slice(0, 3),
  };
}

/** Contagem por `kind` — é onde se vê se o modelo separa proposta de decisão. */
export function countKinds(statements: BenchStatement[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const statement of statements) {
    counts[statement.kind] = (counts[statement.kind] ?? 0) + 1;
  }
  return counts;
}
