/**
 * Escritor: dados apurados de UMA seção → a prosa final dela.
 *
 * Ele recebe **os dados da seção**, nunca a transcrição. O que entra no
 * documento já foi decidido pelo Pensante e conferido pelo Auditor; aqui não
 * se decide nada, só se redige. Dar a transcrição ao Escritor abriria uma
 * segunda porta para informação não auditada entrar na ata.
 *
 * Recebe também as seções já escritas, para não repetir nem se contradizer —
 * e elas vão como `cacheablePrefix`, porque crescem por acréscimo: o prefixo
 * da seção k contém o da seção k-1.
 *
 * Duas garantias são de CÓDIGO, não do modelo:
 *
 * - **lacuna aparece.** Toda `Gap` da seção precisa sair como marcador visível
 *   no texto. O que o modelo esquecer, o código acrescenta;
 * - **instrução do PDF não vaza.** As frases de autoria do modelo de Ata são
 *   procuradas na saída, e a geração FALHA se alguma aparecer. Elas chegariam
 *   num cliente.
 */
import { complete, type CompletionResult, type JsonSchema } from '../ai';
import { renderPrompt } from '../prompts';
import type { SectionSpec } from '../templates/types';
import { specForSection, type DocumentData, type Gap } from '../documentData';
import type { RenderedSection, SectionConfidence } from '../generateStep';

const CONTENT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    content: {
      type: 'string',
      description: 'A seção redigida em markdown, começando pelo cabeçalho de nível 2.',
    },
  },
  required: ['content'],
};

/**
 * Instruções de autoria do `Modelo_Ata_de_Reunião.pdf`. São o que o autor do
 * modelo escreveu PARA QUEM PREENCHE, e viraram `guidance` do template — não
 * texto do documento.
 *
 * A comparação é sensível à caixa de propósito. São títulos em caixa alta de
 * início, e casar sem distinguir caixa transformaria prosa legítima ("definir
 * uma ação concreta para a próxima sprint") em falha de geração.
 */
export const FRASES_PROIBIDAS: readonly string[] = [
  'O que escrever aqui',
  'Narrativa Resumida',
  'O Veredito',
  'Ação Concreta',
  'Alinhamentos Abstratos',
  'Diferença para Decisões',
  'Produtos Gerados',
  'Resumo Executivo',
  '[Nome do Tópico]',
  '[Decisão A]',
  '[Nome] – [Cargo]',
];

export class VazamentoDeInstrucaoError extends Error {
  constructor(
    readonly frases: string[],
    readonly onde: string,
  ) {
    super(
      `Instrução de autoria do modelo vazou para ${onde}: ${frases.map((f) => `"${f}"`).join(', ')}. ` +
        'Isso é texto do PDF dirigido a quem preenche a ata, não conteúdo do documento — ' +
        'se chegasse ao cliente, a ata sairia com a instrução dentro.',
    );
  }
}

/** Falha ALTO. Entregar calado seria entregar a instrução ao cliente. */
export function assertSemVazamento(texto: string, onde: string): void {
  const encontradas = FRASES_PROIBIDAS.filter((frase) => texto.includes(frase));
  if (encontradas.length > 0) throw new VazamentoDeInstrucaoError(encontradas, onde);
}

/** O marcador de lacuna, visível no documento final. */
export function marcadorDeLacuna(gap: Gap): string {
  return `**[A preencher: ${gap.question}]**`;
}

export interface EscreverInput {
  section: SectionSpec;
  /** O DocumentData acumulado; só a fatia desta seção é serializada. */
  data: DocumentData;
  gaps: Gap[];
  /** Seções já escritas, na ordem. */
  completed: RenderedSection[];
  promptVersion?: `v${number}`;
  maxTokens?: number;
}

export interface EscreverResult {
  /** `null` quando a seção é `omitWhenEmpty` e não há dado — ela some. */
  section: RenderedSection | null;
  /** Lacunas que o modelo não marcou e o código teve de acrescentar. */
  lacunasAcrescentadas: Gap[];
  meta?: CompletionResult['meta'];
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
}

const zeroUsage = () => ({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });

export async function escrever(input: EscreverInput): Promise<EscreverResult> {
  const spec = specForSection(input.section);
  const dados = spec.serialize(input.data, input.section.id);

  // Seção marcada para sumir e sem dado nenhum: some. Aparecer com título e
  // nada embaixo diria ao leitor que a reunião não produziu isto, quando o
  // que houve foi não haver o que registrar.
  if (dados === null && input.section.omitWhenEmpty) {
    return { section: null, lacunasAcrescentadas: [], usage: zeroUsage() };
  }

  const system = renderPrompt('escritor', input.promptVersion ?? 'v1');

  // Cresce por acréscimo, então o prefixo da seção k contém o da k-1 — é o
  // formato que o cache de prefixo aproveita.
  const cacheablePrefix =
    input.completed.length > 0
      ? ['# Seções já escritas', '', ...input.completed.map((s) => s.content)].join('\n\n')
      : '';

  const pedido = [
    `# Instrução de redação da seção "${input.section.title}"`,
    '',
    input.section.guidance || '(sem instrução específica para esta seção)',
    '',
    `# Dados apurados da seção "${input.section.title}"`,
    '',
    dados ?? '(nenhum dado foi apurado para esta seção)',
    input.gaps.length > 0
      ? [
          '',
          '# Lacunas',
          '',
          'Estes campos não puderam ser determinados. Escreva o marcador EXATAMENTE como',
          'está abaixo, no lugar do texto que iria ali:',
          '',
          ...input.gaps.map((gap) => `- ${marcadorDeLacuna(gap)}`),
        ].join('\n')
      : '',
  ]
    .filter((bloco) => bloco !== '')
    .join('\n');

  const result = await complete('escritor', {
    system,
    messages: [{ role: 'user', content: pedido }],
    maxTokens: input.maxTokens ?? 4_000,
    jsonSchema: CONTENT_SCHEMA,
    ...(cacheablePrefix ? { cacheablePrefix } : {}),
  });

  const bruto = ((result.parsed ?? {}) as { content?: string }).content ?? '';

  const { texto, acrescentadas } = garantirLacunas(bruto.trim(), input.section, input.gaps);

  assertSemVazamento(texto, `a seção "${input.section.title}"`);

  return {
    section: {
      id: input.section.id,
      title: input.section.title,
      content: texto,
      confidence: confidenceFor(input.section, dados, input.gaps),
    },
    lacunasAcrescentadas: acrescentadas,
    meta: result.meta,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cachedInputTokens: result.usage.cachedInputTokens ?? 0,
    },
  };
}

/**
 * O modelo é instruído a pôr o marcador no lugar certo — inline, onde a
 * informação faltou. Quando ele esquece, o código acrescenta no fim.
 *
 * O fim é pior que o lugar certo, e é de propósito que não se tenta adivinhar
 * onde inserir: lacuna no fim continua visível, lacuna colada no parágrafo
 * errado vira afirmação errada.
 */
function garantirLacunas(
  texto: string,
  section: SectionSpec,
  gaps: Gap[],
): { texto: string; acrescentadas: Gap[] } {
  const faltando = gaps.filter((gap) => !texto.includes(marcadorDeLacuna(gap)));
  if (faltando.length === 0) return { texto, acrescentadas: [] };

  const cabecalho = texto.trim() === '' ? `## ${section.title}\n` : '';
  const bloco = faltando.map((gap) => marcadorDeLacuna(gap)).join('\n\n');

  return { texto: `${cabecalho}${texto}\n\n${bloco}`.trim(), acrescentadas: faltando };
}

/**
 * Confiança da seção, decidida em código.
 *
 * Perguntar isso ao modelo seria pedir que ele avaliasse o próprio trabalho, e
 * a resposta útil (`missing`) é justamente a que ele tem menos incentivo a
 * dar.
 */
export function confidenceFor(
  section: SectionSpec,
  dados: string | null,
  gaps: Gap[],
): SectionConfidence {
  if (dados === null) return section.required ? 'missing' : 'partial';
  return gaps.length > 0 ? 'partial' : 'ok';
}
