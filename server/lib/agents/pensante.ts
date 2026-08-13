/**
 * Pensante: contexto compactado + `SectionSpec` → DADOS estruturados da
 * seção, mais as lacunas encontradas. Não devolve texto redigido; a redação
 * é do Escritor.
 *
 * Recebe **apenas o contexto compactado**, nunca a transcrição bruta. É o que
 * segura o custo do pipeline: a transcrição é lida uma vez pelo Analista, e
 * depois só os excertos ancorados voltam ao modelo — e só para o Auditor.
 *
 * As regras de cada seção vêm do `guidance` do `SectionSpec`, INTERPOLADAS no
 * prompt. Não são reescritas aqui: o `guidance` foi preenchido a partir do PDF
 * e da especificação exatamente para isso, e regra que mora em dois lugares
 * diverge.
 */
import type { CompactedContext, CompactedStatement } from '../compactedContext';
import { trustworthy } from '../compactedContext';
import { complete, type CompletionResult } from '../ai';
import { renderPrompt } from '../prompts';
import type { SectionSpec } from '../templates/types';
import { specForSection, type DocumentData, type Gap } from '../documentData';
import type { Answer } from '../generateStep';

export interface PensarInput {
  context: CompactedContext;
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

export interface PensarResult {
  /** O payload cru da seção, já enxertado em `data` pelo spec da seção. */
  data: DocumentData;
  gaps: Gap[];
  meta: CompletionResult['meta'];
  usage: CompletionResult['usage'];
}

/**
 * Serializa o contexto compactado para o modelo.
 *
 * Só as afirmações CONFIÁVEIS entram: uma afirmação cuja citação não foi
 * localizada na transcrição não pode sustentar nada, e oferecê-la ao Pensante
 * seria convidá-lo a citar um `id` que o Auditor vai derrubar depois.
 *
 * `text` e `kind` bastam — a citação literal fica de fora de propósito. O
 * Pensante não deve raciocinar sobre a fala original; para isso existe a
 * âncora, que o Auditor usa.
 */
export function serializeContext(statements: CompactedStatement[]): string {
  return statements
    .map((s) => `[${s.id}] (${s.kind}) ${s.text}`)
    .join('\n');
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

export async function pensar(input: PensarInput): Promise<PensarResult> {
  const spec = specForSection(input.section);
  const usable = trustworthy(input.context.statements);

  const system = renderPrompt('pensante', input.promptVersion ?? 'v1', {
    // O guidance do template, íntegro. Nunca reescrito aqui.
    sectionGuidance: input.section.guidance || '(sem instrução específica para esta seção)',
    knownFacts: serializeKnown(input.known, input.answers),
  });

  const entidades = [
    input.context.entities.people.length ? `pessoas: ${input.context.entities.people.join(', ')}` : '',
    input.context.entities.projects.length ? `projetos: ${input.context.entities.projects.join(', ')}` : '',
    input.context.entities.companies.length ? `empresas: ${input.context.entities.companies.join(', ')}` : '',
    input.context.entities.technologies.length
      ? `tecnologias: ${input.context.entities.technologies.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  // O contexto compactado é IDÊNTICO nas nove chamadas da Ata. Vai como
  // `cacheablePrefix` para que o cache de prefixo o reaproveite — é a maior
  // economia disponível no pipeline, e a razão de o prefixo ir sempre no
  // início da primeira mensagem (ver providers/shared.ts).
  const cacheablePrefix = [
    '# Contexto compactado da reunião',
    '',
    serializeContext(usable),
    entidades ? `\n# Entidades\n${entidades}` : '',
  ].join('\n');

  const pedido = [
    `Preencha a seção "${input.section.title}".`,
    input.rejections?.length
      ? [
          '',
          'ATENÇÃO — a tentativa anterior teve afirmações REJEITADAS na conferência',
          'contra a transcrição original. Motivos:',
          ...input.rejections.map((r) => `- ${r}`),
          '',
          'Refaça a seção. Não reapresente afirmação rejeitada sem que o contexto',
          'compactado realmente a sustente; se não sustentar, omita-a.',
        ].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const result = await complete('pensante', {
    system,
    messages: [{ role: 'user', content: pedido }],
    maxTokens: input.maxTokens ?? 8_000,
    jsonSchema: spec.schema,
    cacheablePrefix,
  });

  const data: DocumentData = structuredCloneish(input.known);
  spec.merge(data, result.parsed, input.section.id);

  // Descarta `statementIds` que não existem: um id inventado passaria pelo
  // Auditor sem trecho para conferir, e viraria afirmação sem evidência.
  const validIds = new Set(usable.map((s) => s.id));
  pruneUnknownIds(data, validIds);

  return {
    data,
    gaps: detectGaps(input.section, data),
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

function pruneUnknownIds(data: DocumentData, validIds: Set<string>): void {
  const clean = (ids: string[] | undefined) => (ids ?? []).filter((id) => validIds.has(id));

  data.participants = data.participants?.map((p) => ({ ...p, statementIds: clean(p.statementIds) }));
  data.decisions = data.decisions?.map((d) => ({ ...d, statementIds: clean(d.statementIds) }));
  data.topicsDiscussed = data.topicsDiscussed?.map((t) => ({
    ...t,
    statementIds: clean(t.statementIds),
  }));
  data.outcomes = data.outcomes?.map((o) => ({ ...o, statementIds: clean(o.statementIds) }));
  data.outputs = data.outputs?.map((o) => ({ ...o, statementIds: clean(o.statementIds) }));
  if (data.generic) {
    for (const [sectionId, items] of Object.entries(data.generic)) {
      data.generic[sectionId] = items.map((i) => ({ ...i, statementIds: clean(i.statementIds) }));
    }
  }
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
