/**
 * O INSIGHT SUGERIDO — a estrutura que liga um trecho de reunião a uma fonte.
 *
 * ── Por que esta forma, e não um texto ───────────────────────────────────
 *
 * O produto vai afirmar coisas sobre o trabalho de um cliente. Uma afirmação
 * dessas tem três partes, e todas as três precisam sobreviver até a tela:
 *
 *   • o TRECHO que a motivou — sem ele, "notei um risco de prazo" é um palpite
 *     sobre uma reunião que a pessoa não consegue reencontrar;
 *   • a FONTE que a sustenta — é o que separa "a literatura observa" de "o
 *     modelo acha";
 *   • a PERGUNTA a fazer ao cliente — porque o valor não está em concluir, e
 *     sim em devolver uma boa pergunta para a próxima conversa.
 *
 * Guardar isso como prosa gerada perderia as três: não dá para renderizar
 * "Ver fonte" a partir de um parágrafo. Por isso a unidade é um REGISTRO, e o
 * texto é derivado dele — nunca o contrário.
 *
 * ── Hipótese e confirmado ────────────────────────────────────────────────
 *
 * A distinção não é de confiança do modelo, é de EVIDÊNCIA:
 *
 *   • `confirmado` — o trecho diz literalmente o que o insight afirma. O
 *     `trecho_reuniao.texto` é citação, e é verificável lendo a transcrição.
 *   • `hipotese`   — o trecho sugere, e a fonte explica por que vale perguntar.
 *     É a maioria dos casos, e é honesto que seja.
 *
 * Um insight que afirma sem citação e se apresenta como confirmado é o modo de
 * falhar mais caro deste produto — por isso `validarInsight` exige o trecho
 * literal quando o tipo é `confirmado`.
 *
 * ── O que esta fase NÃO faz ──────────────────────────────────────────────
 *
 * Gerar insight. Aqui há tipo, validação e resolução da fonte; quem popula são
 * os agentes de diagnóstico, que ainda não existem.
 */
import type { Biblioteca } from './referencias/biblioteca';
import type { Referencia } from './referencias/tipos';

export const TIPOS_DE_INSIGHT = ['hipotese', 'confirmado'] as const;

export type TipoDeInsight = (typeof TIPOS_DE_INSIGHT)[number];

/**
 * Sem acento no valor guardado, com acento na tela.
 *
 * O dado atravessa JSON, URL e comparação de string; "hipótese" acentuado em
 * qualquer um desses lugares é um bug esperando normalização Unicode. O rótulo
 * de exibição fica aqui do lado para ninguém escrever "Hipotese" na interface.
 */
export const ROTULO_DO_TIPO: Record<TipoDeInsight, string> = {
  hipotese: 'Hipótese',
  confirmado: 'Confirmado',
};

/** O pedaço da reunião que motivou o insight. */
export interface TrechoDaReuniao {
  /** A reunião de onde veio. */
  meetingId: string;
  /**
   * O id da legenda, quando o insight nasce de uma fala específica.
   *
   * É o que permite à interface levar a pessoa ATÉ a linha da transcrição, em
   * vez de mostrar um texto solto. Opcional porque um insight pode nascer do
   * conjunto — "ninguém mencionou prazo em 40 minutos" não tem captionId.
   */
  captionId?: string;
  /** O texto da fala, como ele está na transcrição. Nunca parafraseado. */
  texto: string;
  /** Quem falou, quando o trecho é de alguém. */
  falante?: string;
  /** Deslocamento desde o início da reunião, em ms — para localizar no tempo. */
  offsetMs?: number;
}

export interface InsightSugerido {
  id: string;
  trecho_reuniao: TrechoDaReuniao;
  /**
   * O ID da referência na biblioteca — não uma cópia dela.
   *
   * Cópia envelheceria: um link corrigido na biblioteca continuaria quebrado
   * dentro de todo insight já emitido. O preço é que a fonte pode sumir, e
   * `resolverFonte` trata esse caso explicitamente em vez de renderizar um
   * insight sem procedência.
   */
  referencia_usada: string;
  /** O que perguntar ao cliente. É o produto do insight. */
  pergunta_sugerida: string;
  tipo: TipoDeInsight;
  /** Quando foi gerado, em ISO. */
  criado_em: string;
}

export type ResultadoDaValidacao =
  | { ok: true; valor: InsightSugerido }
  | { ok: false; erros: string[] };

export function ehTipoDeInsight(valor: unknown): valor is TipoDeInsight {
  return typeof valor === 'string' && (TIPOS_DE_INSIGHT as readonly string[]).includes(valor);
}

function textoNaoVazio(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.trim().length > 0;
}

function validarTrecho(bruto: unknown, erros: string[]): TrechoDaReuniao | undefined {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    erros.push('"trecho_reuniao" precisa ser um objeto.');
    return undefined;
  }
  const trecho = bruto as Record<string, unknown>;

  if (!textoNaoVazio(trecho.meetingId)) {
    erros.push('"trecho_reuniao.meetingId" é obrigatório.');
  }
  if (!textoNaoVazio(trecho.texto)) {
    erros.push('"trecho_reuniao.texto" é obrigatório — um insight sem trecho não é rastreável.');
  }
  if (trecho.captionId !== undefined && !textoNaoVazio(trecho.captionId)) {
    erros.push('"trecho_reuniao.captionId", quando presente, precisa ser um texto.');
  }
  if (trecho.falante !== undefined && !textoNaoVazio(trecho.falante)) {
    erros.push('"trecho_reuniao.falante", quando presente, precisa ser um texto.');
  }
  if (
    trecho.offsetMs !== undefined &&
    (typeof trecho.offsetMs !== 'number' || !Number.isFinite(trecho.offsetMs) || trecho.offsetMs < 0)
  ) {
    erros.push('"trecho_reuniao.offsetMs", quando presente, precisa ser um número >= 0.');
  }

  if (erros.length > 0) return undefined;

  return {
    meetingId: (trecho.meetingId as string).trim(),
    texto: trecho.texto as string,
    ...(trecho.captionId ? { captionId: (trecho.captionId as string).trim() } : {}),
    ...(trecho.falante ? { falante: (trecho.falante as string).trim() } : {}),
    ...(trecho.offsetMs !== undefined ? { offsetMs: trecho.offsetMs as number } : {}),
  };
}

/** ISO completo, e uma data que existe. */
function ehInstanteIso(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  const instante = Date.parse(valor);
  return Number.isFinite(instante);
}

export function validarInsight(bruto: unknown): ResultadoDaValidacao {
  const erros: string[] = [];

  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    return { ok: false, erros: ['o insight precisa ser um objeto.'] };
  }
  const candidato = bruto as Record<string, unknown>;

  if (!textoNaoVazio(candidato.id)) erros.push('"id" é obrigatório.');
  if (!textoNaoVazio(candidato.referencia_usada)) {
    erros.push('"referencia_usada" é obrigatório — é o id da fonte na biblioteca.');
  }
  if (!textoNaoVazio(candidato.pergunta_sugerida)) {
    erros.push('"pergunta_sugerida" é obrigatório.');
  }
  if (!ehTipoDeInsight(candidato.tipo)) {
    erros.push(`"tipo" precisa ser um de: ${TIPOS_DE_INSIGHT.join(', ')}.`);
  }
  if (!ehInstanteIso(candidato.criado_em)) {
    erros.push('"criado_em" precisa ser um instante ISO.');
  }

  const trecho = validarTrecho(candidato.trecho_reuniao, erros);

  if (erros.length > 0 || !trecho) return { ok: false, erros };

  return {
    ok: true,
    valor: {
      id: (candidato.id as string).trim(),
      trecho_reuniao: trecho,
      referencia_usada: (candidato.referencia_usada as string).trim(),
      pergunta_sugerida: (candidato.pergunta_sugerida as string).trim(),
      tipo: candidato.tipo as TipoDeInsight,
      criado_em: candidato.criado_em as string,
    },
  };
}

// ---------------------------------------------------------------------------
// A fonte, resolvida
// ---------------------------------------------------------------------------

export type FonteResolvida =
  | { ok: true; referencia: Referencia }
  | { ok: false; motivo: string };

/**
 * Traz a referência citada pelo insight.
 *
 * O caso de falha é EXPLÍCITO, e não um `undefined` silencioso, porque a
 * interface prometida tem um botão "Ver fonte". Um insight cuja fonte sumiu da
 * biblioteca não pode ser renderizado como se tivesse procedência — quem chama
 * precisa ser obrigado a decidir o que fazer.
 */
export async function resolverFonte(
  insight: InsightSugerido,
  biblioteca: Biblioteca,
): Promise<FonteResolvida> {
  const referencia = await biblioteca.obter(insight.referencia_usada);
  if (!referencia) {
    return {
      ok: false,
      motivo: `a referência "${insight.referencia_usada}" não está mais na biblioteca.`,
    };
  }
  return { ok: true, referencia };
}

/**
 * Um insight `confirmado` precisa que o trecho contenha a citação.
 *
 * Esta checagem é separada de `validarInsight` de propósito: a primeira valida
 * FORMA, e roda sobre qualquer insight; esta valida a PROMESSA que o tipo faz,
 * e depende de uma citação para comparar. Quem gera decide qual das duas
 * precisa.
 */
export function citacaoConfere(insight: InsightSugerido, citacao: string): boolean {
  if (insight.tipo !== 'confirmado') return true;
  const limpa = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
  return limpa(insight.trecho_reuniao.texto).includes(limpa(citacao));
}
