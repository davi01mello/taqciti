/**
 * Analista: transcrição bruta → `CompactedContext`.
 *
 * É o único agente que lê a transcrição inteira. Todos os outros trabalham
 * sobre o contexto compactado e, quando precisam do original, voltam por
 * `anchor`. É isso que segura o custo do pipeline.
 *
 * O modelo NÃO informa offsets. Ele devolve `text`, `quote` e `kind`; este
 * arquivo localiza a citação com `anchoring.ts` e preenche `start`/`end`.
 * Citação que não se localiza vira afirmação suspeita, com `anchor: null` —
 * e afirmação suspeita não sustenta nada em seção `audit: 'strict'`.
 */
import {
  type CompactedContext,
  type CompactedStatement,
  type CompactionStats,
} from '../compactedContext';
import { complete, maxContextTokensFor, type CompletionResult, type JsonSchema } from '../ai';
import { renderPrompt } from '../prompts';
import { createLocator } from './anchoring';
import {
  dedupeKey,
  windowCharsForModel,
  windowTranscript,
  DEFAULT_OVERLAP_CHARS,
  DEFAULT_WINDOW_CHARS,
} from './windowing';

/**
 * A forma que o MODELO devolve. Note a ausência de `id` e de offsets: os dois
 * são responsabilidade do código. Pedir `id` ao modelo daria colisão entre
 * janelas; pedir offset daria número errado.
 */
const ANALISTA_SCHEMA: JsonSchema = {
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

interface RawStatement {
  text: string;
  quote: string;
  kind: CompactedStatement['kind'];
}

interface RawOutput {
  statements?: RawStatement[];
  entities?: Partial<CompactedContext['entities']>;
}

export interface AnalisarOptions {
  /** Teto de caracteres por janela. Padrão: o menor entre 200 mil e o que
   *  cabe na janela de contexto do modelo configurado. */
  windowChars?: number;
  overlapChars?: number;
  maxTokens?: number;
  promptVersion?: `v${number}`;
}

export interface AnalisarResult {
  context: CompactedContext;
  stats: CompactionStats;
  /** Uma entrada por janela — o custo real são todas somadas. */
  calls: CompletionResult['meta'][];
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
}

const EMPTY_ENTITIES: CompactedContext['entities'] = {
  people: [],
  projects: [],
  companies: [],
  technologies: [],
};

export async function analisar(
  transcript: string,
  options: AnalisarOptions = {},
): Promise<AnalisarResult> {
  if (!transcript.trim()) {
    throw new Error('analisar: transcrição vazia.');
  }

  const promptVersion = options.promptVersion ?? 'v1';

  // O teto de 200 mil caracteres vem da especificação; o do modelo vem da
  // camada de IA. Vale o menor: um modelo de janela pequena não fica salvo
  // por a especificação permitir mais.
  const windowChars = Math.min(
    options.windowChars ?? DEFAULT_WINDOW_CHARS,
    windowCharsForModel(maxContextTokensFor('analista')),
  );
  const overlapChars = Math.min(
    options.overlapChars ?? DEFAULT_OVERLAP_CHARS,
    Math.max(0, windowChars - 1),
  );

  const windows = windowTranscript(transcript, { windowChars, overlapChars });

  const raw: RawStatement[] = [];
  const entities = { ...EMPTY_ENTITIES };
  const calls: CompletionResult['meta'][] = [];
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

  for (const window of windows) {
    const windowNote =
      windows.length === 1
        ? ''
        : [
            '## Sobre este trecho',
            '',
            `Você está lendo o trecho ${window.index + 1} de ${windows.length} de uma`,
            'transcrição longa, que foi dividida para caber. Os trechos se sobrepõem, então',
            'o começo deste pode repetir o fim do anterior — isso é esperado, e afirmação',
            'repetida é removida depois.',
            '',
            'Compacte apenas o que está neste trecho. Não tente adivinhar o que veio antes',
            'nem o que vem depois, e não mencione a divisão na sua resposta.',
          ].join('\n');

    const result = await complete('analista', {
      system: renderPrompt('analista', promptVersion, { windowNote }),
      messages: [{ role: 'user', content: `Compacte a transcrição a seguir.\n\n${window.text}` }],
      maxTokens: options.maxTokens ?? 16_000,
      jsonSchema: ANALISTA_SCHEMA,
    });

    calls.push(result.meta);
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.cachedInputTokens += result.usage.cachedInputTokens ?? 0;

    const parsed = result.parsed as RawOutput | undefined;
    for (const statement of parsed?.statements ?? []) {
      if (statement?.text && statement?.quote && statement?.kind) raw.push(statement);
    }
    mergeEntities(entities, parsed?.entities);
  }

  const { statements, duplicatesRemoved } = buildStatements(raw, transcript);

  return {
    context: { statements, entities },
    stats: computeStats(statements, transcript, windows.length, duplicatesRemoved),
    calls,
    usage,
  };
}

function mergeEntities(
  target: CompactedContext['entities'],
  incoming: Partial<CompactedContext['entities']> | undefined,
): void {
  if (!incoming) return;
  for (const key of Object.keys(target) as Array<keyof CompactedContext['entities']>) {
    const values = incoming[key];
    if (!Array.isArray(values)) continue;
    // Dedupe sem distinguir caixa, mas preservando a primeira grafia vista:
    // "PostgreSQL" e "postgresql" são a mesma tecnologia, e a lista não deve
    // sugerir que a reunião falou de duas.
    const seen = new Set(target[key].map((value) => value.toLowerCase()));
    for (const value of values) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const normalized = value.trim().toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      target[key].push(value.trim());
    }
  }
}

function buildStatements(
  raw: RawStatement[],
  transcript: string,
): { statements: CompactedStatement[]; duplicatesRemoved: number } {
  const locator = createLocator(transcript);
  const statements: CompactedStatement[] = [];
  const seen = new Set<string>();
  let duplicatesRemoved = 0;

  for (const item of raw) {
    const key = dedupeKey(item);
    if (seen.has(key)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(key);

    statements.push({
      id: `st-${String(statements.length + 1).padStart(3, '0')}`,
      text: item.text.trim(),
      quote: item.quote,
      // A busca é sempre contra a transcrição COMPLETA, nunca contra a
      // janela: é o que mantém os offsets absolutos e as âncoras válidas.
      anchor: locator.locate(item.quote),
      kind: item.kind,
    });
  }

  return { statements, duplicatesRemoved };
}

function computeStats(
  statements: CompactedStatement[],
  transcript: string,
  windows: number,
  duplicatesRemoved: number,
): CompactionStats {
  const compactedChars = statements.reduce((total, s) => total + s.text.length, 0);
  const anchorsExact = statements.filter((s) => s.anchor?.exact === true).length;
  const anchorsNormalized = statements.filter((s) => s.anchor !== null && !s.anchor.exact).length;
  const anchorsMissing = statements.filter((s) => s.anchor === null).length;

  return {
    transcriptChars: transcript.length,
    compactedChars,
    compactionRatio: compactedChars === 0 ? 0 : transcript.length / compactedChars,
    statementCount: statements.length,
    anchorsExact,
    anchorsNormalized,
    anchorsMissing,
    anchorRate:
      statements.length === 0 ? 0 : (anchorsExact + anchorsNormalized) / statements.length,
    windows,
    duplicatesRemoved,
  };
}
