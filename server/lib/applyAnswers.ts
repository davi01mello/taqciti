/**
 * Aplica as respostas do usuário ao `DocumentData` — SEM chamar modelo.
 *
 * Toda pergunta que o pipeline gera é sobre um campo que ficou ausente: a
 * data, o nome do projeto, o cargo de alguém, quem assina. A resposta É o
 * valor do campo. Mandá-la de volta ao Pensante para ele "incorporar" seria
 * pagar uma geração inteira para escrever num campo o que o usuário acabou de
 * digitar — e ainda dar ao modelo a chance de reescrever o que a pessoa disse.
 *
 * Por isso responder é grátis e instantâneo: o campo é preenchido em código, o
 * HTML sai de novo do `DocumentData` (que também não precisa de modelo), e o
 * documento atualiza.
 *
 * Cargo respondido pelo usuário entra com `roleSource: 'user'`. A distinção
 * entre "a reunião disse" e "alguém preencheu depois" é do `guidance` da Ata e
 * é o que permite, mais tarde, saber de onde veio cada cargo de um documento
 * já entregue.
 */
import type { Answer } from './generateStep';
import type { DocumentData, Gap } from './documentData';

export interface ApplyAnswersResult {
  data: DocumentData;
  /** As lacunas que sobraram — as respondidas saem. */
  gaps: Gap[];
  /** Campos preenchidos, na ordem em que foram aplicados. */
  aplicadas: string[];
  /**
   * Respostas que NÃO tinham onde ser aplicadas.
   *
   * Acontece com as perguntas de afirmação descartada pelo Auditor
   * (`decisions[0]`, por exemplo): elas perguntam se algo deve constar na ata
   * e com que redação, e isso não é preencher um campo — é refazer a seção.
   * Nunca somem em silêncio; voltam para quem chamou decidir o que fazer.
   */
  naoAplicadas: Answer[];
}

/** `participants[Maria].role` → `Maria`. */
const NOME_DO_PARTICIPANTE = /^participants\[(.+)\]\.role$/;

/**
 * O `questionId` é `${sectionId}:${field}` (ver `questionFor` em
 * generateStep.ts). O que interessa aqui é o campo.
 */
function campoDe(questionId: string): string {
  const separador = questionId.indexOf(':');
  return separador === -1 ? questionId : questionId.slice(separador + 1);
}

export function applyAnswers(
  documentData: DocumentData,
  answers: Answer[],
  gaps: Gap[],
): ApplyAnswersResult {
  const data: DocumentData = {
    ...documentData,
    ...(documentData.participants ? { participants: [...documentData.participants] } : {}),
  };

  const aplicadas: string[] = [];
  const naoAplicadas: Answer[] = [];

  for (const answer of answers) {
    const valor = answer.answer?.trim();
    // Resposta em branco é "não sei", não "apague o campo": a lacuna
    // permanece, e o documento continua mostrando que falta algo.
    if (!valor) continue;

    const campo = campoDe(answer.questionId);

    if (campo === 'metadata.date') {
      data.metadata = { ...data.metadata, date: valor };
      aplicadas.push(campo);
      continue;
    }

    if (campo === 'metadata.projectName') {
      data.metadata = { ...data.metadata, projectName: valor };
      aplicadas.push(campo);
      continue;
    }

    if (campo === 'signature.name') {
      data.signature = { ...data.signature, name: valor };
      aplicadas.push(campo);
      continue;
    }

    if (campo === 'signature.role') {
      data.signature = { ...data.signature, role: valor };
      aplicadas.push(campo);
      continue;
    }

    const participante = NOME_DO_PARTICIPANTE.exec(campo)?.[1];
    if (participante) {
      const antes = data.participants ?? [];
      const indice = antes.findIndex((p) => p.name === participante);
      // Participante que não existe mais no documento: a resposta não tem
      // onde entrar. Criá-lo aqui seria acrescentar alguém à ata por causa de
      // uma pergunta órfã.
      if (indice === -1) {
        naoAplicadas.push(answer);
        continue;
      }
      data.participants = antes.map((p, i) =>
        i === indice ? { ...p, role: valor, roleSource: 'user' as const } : p,
      );
      aplicadas.push(campo);
      continue;
    }

    naoAplicadas.push(answer);
  }

  const preenchidos = new Set(aplicadas);
  return {
    data,
    gaps: gaps.filter((gap) => !preenchidos.has(gap.field)),
    aplicadas,
    naoAplicadas,
  };
}
