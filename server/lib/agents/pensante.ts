/**
 * Pensante: transcrição bruta + `SectionSpec` → DADOS estruturados da seção,
 * mais as lacunas encontradas. Não devolve texto redigido; a redação é do
 * Escritor.
 *
 * Ele lê a transcrição INTEIRA, e isso é deliberado. A compactação que existia
 * antes (o Analista) foi cortada por três razões medidas:
 *
 * - o contexto compactado tinha ~1.000 tokens, abaixo do piso de cache
 *   implícito do provedor, então a compactação impedia justamente o cache que
 *   a tornaria desnecessária. A transcrição bruta passa folgado desse piso e
 *   vai como `cacheablePrefix`, idêntica nas nove seções;
 * - o Pensante raciocinava sobre a paráfrase de outro modelo, e o Auditor
 *   tentava reconstruir a vizinhança que a compactação tinha jogado fora;
 * - com a transcrição em mãos, o Pensante consegue apontar a citação da
 *   CONCORDÂNCIA, não só a da proposta — que é o que separa decisão de
 *   proposta (ver `Decision.agreement` em `documentData.ts`).
 *
 * **O modelo NUNCA informa offset.** Ele devolve `quote`; `anchoring.ts`
 * localiza. Citação que não se localiza fica com `anchor: null` e não sustenta
 * nada.
 *
 * As regras de cada seção vêm do `guidance` do `SectionSpec`, repassadas
 * ÍNTEGRAS. Não são reescritas aqui: o `guidance` foi preenchido a partir do
 * PDF e da especificação exatamente para isso, e regra que mora em dois
 * lugares diverge.
 */
import { complete, type CompletionResult } from '../ai';
import { renderPrompt } from '../prompts';
import type { SectionSpec } from '../templates/types';
import { specForSection, type DocumentData, type Gap, type Locate } from '../documentData';
import type { Answer } from '../generateStep';
import { createLocator, type LocatedAnchor } from './anchoring';

export interface PensarInput {
  /** A transcrição bruta, literal. Vai como prefixo cacheável. */
  transcript: string;
  section: SectionSpec;
  /** Dados já preenchidos por seções anteriores — o "já determinado". */
  known: DocumentData;
  /** Respostas que o usuário já deu. Não se pergunta duas vezes. */
  answers: Answer[];
  /** Justificativas de rejeição do Auditor, quando esta é a segunda passada. */
  rejections?: string[];
  promptVersion?: `v${number}`;
  maxTokens?: number;
}

/**
 * Saúde das citações desta seção. A taxa de localização é o PRINCIPAL
 * indicador de qualidade do Pensante — foi a única métrica que pegou um modelo
 * devolvendo citação com caractere apagado: JSON válido, schema satisfeito,
 * âncora inútil.
 */
export interface QuoteStats {
  total: number;
  exact: number;
  /** Localizadas só após normalização leve (espaços, aspas, caixa). */
  normalized: number;
  missing: number;
  /** (exact + normalized) / total. 1 quando não houve citação nenhuma. */
  anchorRate: number;
}

export interface PensarResult {
  /** O payload cru da seção, já enxertado em `data` pelo spec da seção. */
  data: DocumentData;
  gaps: Gap[];
  quotes: QuoteStats;
  /** As citações que não existem na transcrição. Nunca somem em silêncio. */
  unlocatable: string[];
  meta: CompletionResult['meta'];
  usage: CompletionResult['usage'];
}

function serializeKnown(known: DocumentData, answers: Answer[]): string {
  const linhas: string[] = [];

  if (known.metadata?.date) linhas.push(`- Data da reunião: ${known.metadata.date}`);
  if (known.metadata?.projectName) linhas.push(`- Projeto: ${known.metadata.projectName}`);
  if (known.generalTopic) linhas.push(`- Tema central: ${known.generalTopic.topic}`);
  for (const p of known.participants ?? []) {
    linhas.push(`- Participante: ${p.name}${p.role ? ` — ${p.role}` : ' (cargo não determinado)'}`);
  }
  for (const t of known.topicsDiscussed ?? []) linhas.push(`- Tópico discutido: ${t.title}`);
  for (const d of known.decisions ?? []) linhas.push(`- Decisão registrada: ${d.text}`);

  for (const answer of answers) {
    linhas.push(`- Resposta do usuário (${answer.questionId}): ${answer.answer}`);
  }

  return linhas.length > 0 ? linhas.join('\n') : '(nada ainda — esta é a primeira seção)';
}

/**
 * Localizador que conta enquanto localiza.
 *
 * A contagem sai daqui, e não de uma varredura posterior sobre o
 * `DocumentData`, porque `data` já carrega as citações das seções anteriores —
 * varrer o acumulado contaria de novo o que já foi contado.
 */
function countingLocator(transcript: string): {
  locate: Locate;
  stats: () => QuoteStats;
  unlocatable: string[];
} {
  const locator = createLocator(transcript);
  const unlocatable: string[] = [];
  let total = 0;
  let exact = 0;
  let normalized = 0;

  const locate: Locate = (quote) => {
    total += 1;
    const anchor: LocatedAnchor | null = locator.locate(quote);
    if (!anchor) unlocatable.push(quote);
    else if (anchor.exact) exact += 1;
    else normalized += 1;
    return anchor;
  };

  return {
    locate,
    unlocatable,
    stats: () => ({
      total,
      exact,
      normalized,
      missing: unlocatable.length,
      // Sem citação nenhuma a taxa é 1, e não 0: a seção pode legitimamente
      // não ter o que citar (Conclusão, Assinatura). Zerar ali faria a
      // métrica denunciar seções saudáveis e esconder as doentes na média.
      anchorRate: total === 0 ? 1 : (exact + normalized) / total,
    }),
  };
}

export async function pensar(input: PensarInput): Promise<PensarResult> {
  if (!input.transcript.trim()) {
    throw new Error('pensar: transcrição vazia.');
  }

  const spec = specForSection(input.section);

  // O prompt de sistema é IDÊNTICO nas nove seções, de propósito: todo cache
  // de prefixo casa desde o começo do prompt, e um sistema que variasse por
  // seção encerraria o prefixo comum antes da transcrição. O que varia —
  // guidance da seção, fatos já determinados, rejeições — vem DEPOIS da
  // transcrição, na mensagem de usuário.
  const system = renderPrompt('pensante', input.promptVersion ?? 'v2');

  const pedido = [
    `# Seção a preencher: ${input.section.title}`,
    '',
    input.section.guidance || '(sem instrução específica para esta seção)',
    '',
    '# O que já foi determinado',
    '',
    serializeKnown(input.known, input.answers),
    '',
    'Não repita nem contradiga o que já está acima.',
    input.rejections?.length
      ? [
          '',
          '# Atenção',
          '',
          'A tentativa anterior teve afirmações REJEITADAS na conferência contra a',
          'transcrição. Motivos:',
          ...input.rejections.map((r) => `- ${r}`),
          '',
          'Refaça a seção. Não reapresente afirmação rejeitada sem citação literal da',
          'transcrição que realmente a sustente; se não houver, omita-a.',
        ].join('\n')
      : '',
  ]
    .filter((bloco) => bloco !== '')
    .join('\n');

  const result = await complete('pensante', {
    system,
    messages: [{ role: 'user', content: pedido }],
    maxTokens: input.maxTokens ?? 8_000,
    jsonSchema: spec.schema,
    // A transcrição bruta, idêntica nas nove chamadas. É a maior economia
    // disponível no pipeline, e a razão de o prefixo ir sempre no início da
    // primeira mensagem (ver providers/shared.ts).
    cacheablePrefix: input.transcript,
  });

  const { locate, stats, unlocatable } = countingLocator(input.transcript);

  const data: DocumentData = structuredCloneish(input.known);
  spec.merge(data, result.parsed, input.section.id, locate);

  return {
    data,
    gaps: detectGaps(input.section, data),
    quotes: stats(),
    unlocatable,
    meta: result.meta,
    usage: result.usage,
  };
}

/** Cópia rasa suficiente: os campos são substituídos, não mutados em lugar. */
function structuredCloneish(data: DocumentData): DocumentData {
  return {
    ...data,
    ...(data.participants ? { participants: [...data.participants] } : {}),
    ...(data.decisions ? { decisions: [...data.decisions] } : {}),
    ...(data.topicsDiscussed ? { topicsDiscussed: [...data.topicsDiscussed] } : {}),
    ...(data.outcomes ? { outcomes: [...data.outcomes] } : {}),
    ...(data.outputs ? { outputs: [...data.outputs] } : {}),
    ...(data.generic ? { generic: { ...data.generic } } : {}),
  };
}

/**
 * Lacunas: campo obrigatório que ficou ausente.
 *
 * Só olha o que o template declara em `askWhenMissing` — seção com a lista
 * vazia degrada em silêncio de propósito, e inventar pergunta para ela seria
 * criar regra de negócio que a especificação não tem.
 */
export function detectGaps(section: SectionSpec, data: DocumentData): Gap[] {
  const gaps: Gap[] = [];
  const ask = (index: number) => section.askWhenMissing[index] ?? section.askWhenMissing[0] ?? '';

  if (section.id === 'identificacao') {
    if (!data.metadata?.date) {
      gaps.push({
        sectionId: section.id,
        field: 'metadata.date',
        question: ask(0),
        why: 'A data não pôde ser determinada a partir da reunião.',
      });
    }
    if (!data.metadata?.projectName) {
      gaps.push({
        sectionId: section.id,
        field: 'metadata.projectName',
        question: ask(1),
        why: 'O nome do projeto não pôde ser identificado com segurança.',
      });
    }
  }

  if (section.id === 'participantes') {
    for (const p of data.participants ?? []) {
      if (p.role) continue;
      gaps.push({
        sectionId: section.id,
        field: `participants[${p.name}].role`,
        // O template usa `{nome}` como marcador; é o único lugar onde ele
        // aparece, e substituí-lo aqui evita duplicar o texto da pergunta.
        question: (section.askWhenMissing[0] ?? '').replace('{nome}', p.name),
        why: `Não houve evidência na reunião do cargo de ${p.name}.`,
      });
    }
  }

  if (section.id === 'assinatura') {
    if (!data.signature?.name) {
      gaps.push({
        sectionId: section.id,
        field: 'signature.name',
        question: ask(0),
        why: 'A ata não indica quem assina.',
      });
    }
    if (!data.signature?.role) {
      gaps.push({
        sectionId: section.id,
        field: 'signature.role',
        question: ask(1),
        why: 'A ata não indica o cargo de quem assina.',
      });
    }
  }

  return gaps.filter((gap) => gap.question);
}
