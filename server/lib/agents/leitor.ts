/**
 * Leitor: a transcrição bruta → os DADOS do documento inteiro, numa chamada.
 *
 * Substitui o Pensante, que fazia a mesma coisa uma seção por vez — nove
 * leituras da transcrição inteira, cada uma com raciocínio próprio, ligadas
 * por um "o que já foi determinado" serializado entre elas. Tudo isso era
 * compensação por limitação de modelo que o Gemini atual não tem:
 *
 * - **contexto**: 1M de tokens. Uma reunião de uma hora são ~15 mil. Não há
 *   o que dividir;
 * - **saída estruturada nativa**: o schema do documento inteiro é só um objeto
 *   com uma chave por seção, e o provedor garante a forma;
 * - **raciocínio nativo**: o modelo já pensa antes de responder. Um agente
 *   chamado "Pensante" rodando nove vezes pagava esse raciocínio nove vezes, e
 *   ainda perdia a visão do todo — cada seção via as outras só pelo resumo.
 *
 * O que continua em CÓDIGO, porque não é trabalho de modelo:
 *
 * - **o modelo NUNCA informa offset.** Ele devolve `quote`; `anchoring.ts`
 *   localiza. Citação que não se localiza fica com `anchor: null` e não
 *   sustenta nada;
 * - as regras de cada seção vêm do `guidance` do `SectionSpec`, repassadas
 *   ÍNTEGRAS — regra que mora em dois lugares diverge;
 * - lacuna é decidida por `detectGaps`, não pelo modelo.
 */
import { complete, type CompletionResult, type JsonSchema } from '../ai';
import { renderPrompt } from '../prompts';
import type { SectionSpec } from '../templates/types';
import { specForSection, type DocumentData, type Gap, type Locate } from '../documentData';
import type { Answer } from '../generateStep';
import { createLocator, type LocatedAnchor, type Locator } from './anchoring';
import { ehRotuloDeSelf, PERGUNTA_DO_NOME } from '../rotuloDeSelf';

export interface LerInput {
  /** A transcrição bruta, literal. */
  transcript: string;
  /** As seções a preencher. As `fromUserOnly` são ignoradas aqui. */
  sections: SectionSpec[];
  /** O que já se sabe — passadas anteriores, data semeada da captura. */
  known: DocumentData;
  /** Respostas que o usuário já deu. Não se pergunta duas vezes. */
  answers: Answer[];
  promptVersion?: `v${number}`;
  maxTokens?: number;
}

/**
 * Saúde das citações de uma seção. A taxa de localização é o PRINCIPAL
 * indicador de qualidade do Leitor — foi a única métrica que pegou um modelo
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

export interface SecaoLida {
  sectionId: string;
  quotes: QuoteStats;
  /** As citações que não existem na transcrição. Nunca somem em silêncio. */
  unlocatable: string[];
}

export interface LerResult {
  data: DocumentData;
  porSecao: SecaoLida[];
  /** Ausente quando nenhuma seção precisava do modelo. */
  meta?: CompletionResult['meta'];
  usage: CompletionResult['usage'];
}

/**
 * Teto de saída. É teto, não custo: paga-se o que se usa. Cobre o raciocínio
 * (que o Gemini conta como saída) mais o JSON do documento inteiro de uma
 * reunião longa, com folga — estourar aqui seria perder a Ata inteira.
 */
export const LEITOR_MAX_TOKENS = 48_000;

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

  return linhas.join('\n');
}

/** Localizador que conta, por seção, enquanto localiza. */
function countingLocator(locator: Locator): {
  locate: Locate;
  stats: () => QuoteStats;
  unlocatable: string[];
} {
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
      // não ter o que citar (Conclusão). Zerar ali faria a métrica denunciar
      // seções saudáveis e esconder as doentes na média.
      anchorRate: total === 0 ? 1 : (exact + normalized) / total,
    }),
  };
}

/** O schema do documento: uma chave por seção, cada uma com o schema dela. */
export function schemaDoDocumento(sections: SectionSpec[]): JsonSchema {
  return {
    type: 'object',
    properties: Object.fromEntries(
      sections.map((section) => [
        section.id,
        { ...specForSection(section).schema, description: section.title },
      ]),
    ),
    required: sections.map((section) => section.id),
  };
}

function pedidoDoDocumento(input: LerInput, sections: SectionSpec[]): string {
  const conhecido = serializeKnown(input.known, input.answers);
  return [
    '# Seções a preencher',
    '',
    'Cada seção é a chave de mesmo nome no resultado.',
    '',
    ...sections.flatMap((section) => [
      `## ${section.title} (chave \`${section.id}\`)`,
      '',
      section.guidance || '(sem instrução específica para esta seção)',
      '',
    ]),
    ...(conhecido
      ? [
          '# O que já foi determinado',
          '',
          conhecido,
          '',
          'Isto já está confirmado. Não contradiga; use como está.',
        ]
      : []),
  ].join('\n');
}

export async function ler(input: LerInput): Promise<LerResult> {
  if (!input.transcript.trim()) {
    throw new Error('ler: transcrição vazia.');
  }

  const sections = input.sections.filter((section) => !section.fromUserOnly);
  const data: DocumentData = structuredCloneish(input.known);

  if (sections.length === 0) {
    return { data, porSecao: [], usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } };
  }

  const result = await complete('leitor', {
    system: renderPrompt('leitor', input.promptVersion ?? 'v1'),
    messages: [{ role: 'user', content: pedidoDoDocumento(input, sections) }],
    maxTokens: input.maxTokens ?? LEITOR_MAX_TOKENS,
    jsonSchema: schemaDoDocumento(sections),
    // Uma leitura só: não há o que cachear entre chamadas. O prefixo vai
    // assim mesmo, porque é o que põe a transcrição ANTES das instruções.
    cacheablePrefix: input.transcript,
    // Raciocínio alto, e uma vez. É esta chamada que separa proposta de
    // decisão; economizar aqui é economizar no que o produto existe para
    // acertar, e ela já é a única.
    reasoning: 'high',
  });

  const parsed = (result.parsed ?? {}) as Record<string, unknown>;

  const porSecao = sections.map((section) => {
    // Um localizador POR SEÇÃO: ele guarda um cursor (ver anchoring.ts), e as
    // citações vêm em ordem dentro de uma seção, não entre seções. O cursor
    // da Conclusão não deve começar onde as Decisões terminaram.
    const { locate, stats, unlocatable } = countingLocator(createLocator(input.transcript));
    specForSection(section).merge(data, parsed[section.id], section.id, locate);
    return { sectionId: section.id, quotes: stats(), unlocatable };
  });

  return { data, porSecao, meta: result.meta, usage: result.usage };
}

/** Cópia rasa suficiente: os campos são substituídos, não mutados em lugar. */
function structuredCloneish(data: DocumentData): DocumentData {
  return {
    ...data,
    ...(data.metadata ? { metadata: { ...data.metadata } } : {}),
    ...(data.participants ? { participants: [...data.participants] } : {}),
    ...(data.decisions ? { decisions: [...data.decisions] } : {}),
    ...(data.topicsDiscussed ? { topicsDiscussed: [...data.topicsDiscussed] } : {}),
    ...(data.outcomes ? { outcomes: [...data.outcomes] } : {}),
    ...(data.outputs ? { outputs: [...data.outputs] } : {}),
    ...(data.qa ? { qa: [...data.qa] } : {}),
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
      /*
       * "Você" não é nome — é como o Meet chama quem gravou enquanto o nome
       * real não aparece no DOM. Sem isto a ata sai afirmando que Você
       * participou da reunião, que foi o defeito reportado.
       *
       * Vira LACUNA e não descarte: a pessoa participou de verdade, e sumir
       * com ela seria pior do que não saber o nome dela. Quem responde é quem
       * gerou o documento — que estava na reunião e sabe. Ver
       * `lib/rotuloDeSelf.ts`.
       */
      const ehSelf = ehRotuloDeSelf(p.name);

      if (ehSelf) {
        gaps.push({
          sectionId: section.id,
          field: `participants[${p.name}].name`,
          question: PERGUNTA_DO_NOME.replace('{rotulo}', p.name),
          why: `A transcrição identifica essa pessoa apenas como "${p.name}", que é o rótulo do Meet para quem gravou.`,
        });
      }

      if (p.role) continue;
      gaps.push({
        sectionId: section.id,
        field: `participants[${p.name}].role`,
        /*
         * O template usa `{nome}` como marcador; é o único lugar onde ele
         * aparece, e substituí-lo aqui evita duplicar o texto da pergunta.
         *
         * Mas com rótulo de self a substituição crua produzia "Qual é o
         * cargo/papel de Você?" — pergunta que ninguém entende. E aqui dá para
         * ser direto: quem o Meet chamou de "Você" é justamente quem está
         * gerando o documento e lendo o formulário.
         */
        question: ehSelf
          ? 'Qual é o seu cargo/papel nesta reunião?'
          : (section.askWhenMissing[0] ?? '').replace('{nome}', p.name),
        why: ehSelf
          ? 'A reunião não deixa claro o cargo de quem gravou.'
          : `Não houve evidência na reunião do cargo de ${p.name}.`,
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
