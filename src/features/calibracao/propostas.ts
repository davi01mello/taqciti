/**
 * PROPOSTAS DE AJUSTE — o feedback sobre as sugestões vira uma proposta
 * específica de mudança no assistente, que a pessoa aprova ou recusa.
 *
 * ── Princípios (do plano) ───────────────────────────────────────────────────
 *
 *   - Não há aprendizado autônomo: nada muda sozinho. O que existe é uma regra,
 *     em código, sobre os retornos que a PESSOA deu, que produz uma proposta
 *     mostrando exatamente o que mudaria (antes → depois).
 *   - Uma correção pontual não vira regra: cada proposta exige uma QUANTIDADE
 *     mínima de retornos do mesmo tipo entre os mais recentes.
 *   - Quem recusa uma proposta não a vê de novo até haver retorno NOVO daquele
 *     tipo (a decisão guarda a hora, e só o que veio depois conta).
 *   - Preferências salvas são versionadas (`salvarPerfil`): o perfil ganha uma
 *     revisão, e o histórico diz que o ajuste foi proposto pelo Taq e aprovado.
 *
 * Os limiares são PONTO DE PARTIDA: valem até a medição com reuniões reais dizer
 * outra coisa. Por isso vivem num lugar só.
 */
import type { Feedback } from '@/features/apoio/store';
import {
  MODOS_DE_INTERVENCAO,
  ROTULO_DO_MODO,
  conteudoDe,
  salvarPerfil,
  type ConteudoDoPerfil,
  type ModoDeIntervencao,
  type PerfilDeConducao,
  type ResultadoDaEdicao,
} from '@/features/conducao/store';

/** Quantos retornos recentes a regra olha. */
export const JANELA_DE_FEEDBACK = 10;
/** Quantos "descartei" ou "não fazia sentido" entre os recentes pedem intervir menos. */
export const LIMIAR_PARA_INTERVIR_MENOS = 3;
/** Quantos "tarde demais" pedem avisar mais cedo. */
export const LIMIAR_PARA_INTERVIR_MAIS = 2;
/** Quantos "já estava respondido" pedem conferir antes de sugerir pergunta. */
export const LIMIAR_PARA_CONFERIR_O_RESPONDIDO = 2;

export const PREFERENCIA_DO_JA_RESPONDIDO =
  'Antes de sugerir uma pergunta, conferir se a conversa já a respondeu';

export const TIPOS_DE_AJUSTE = ['intervir_menos', 'intervir_mais', 'conferir_o_respondido'] as const;
export type TipoDeAjuste = (typeof TIPOS_DE_AJUSTE)[number];

export type Mudanca =
  | { tipo: 'modo'; de: ModoDeIntervencao; para: ModoDeIntervencao }
  | { tipo: 'preferencia'; texto: string };

export interface PropostaDeAjuste {
  tipo: TipoDeAjuste;
  titulo: string;
  /** Por que — com os números reais, nunca um motivo genérico. */
  porque: string;
  /** Os retornos que sustentam a proposta. */
  feedbackIds: string[];
  /** O que mudaria, em palavras, antes e depois. */
  antes: string;
  depois: string;
  mudanca: Mudanca;
}

/** A última decisão da pessoa por tipo: só retorno POSTERIOR a ela conta. */
export type DecisoesDeAjuste = Partial<Record<TipoDeAjuste, number>>;

const ORDEM: readonly ModoDeIntervencao[] = ['sob_demanda', 'discreto', 'participativo'];

export const modoAbaixo = (m: ModoDeIntervencao): ModoDeIntervencao | null => ORDEM[ORDEM.indexOf(m) - 1] ?? null;
export const modoAcima = (m: ModoDeIntervencao): ModoDeIntervencao | null => ORDEM[ORDEM.indexOf(m) + 1] ?? null;

export function proporAjustes(p: {
  feedback: readonly Feedback[];
  perfil: PerfilDeConducao | null;
  decisoes: DecisoesDeAjuste;
}): PropostaDeAjuste[] {
  // Sem perfil não há o que ajustar: o apoio nem age sozinho.
  if (!p.perfil) return [];
  const modo = p.perfil.intervencao.modo;
  const propostas: PropostaDeAjuste[] = [];

  const recentes = (tipos: readonly Feedback['tipo'][], tipo: TipoDeAjuste) => {
    const corte = p.decisoes[tipo] ?? 0;
    // A janela é dos retornos mais recentes de qualquer tipo; dela, só o que veio depois da decisão.
    return [...p.feedback]
      .sort((a, b) => b.em - a.em)
      .slice(0, JANELA_DE_FEEDBACK)
      .filter((f) => tipos.includes(f.tipo) && f.em > corte);
  };
  const total = Math.min(p.feedback.length, JANELA_DE_FEEDBACK);

  const menos = recentes(['descartada', 'sem_sentido'], 'intervir_menos');
  const abaixo = modoAbaixo(modo);
  if (menos.length >= LIMIAR_PARA_INTERVIR_MENOS && abaixo) {
    propostas.push({
      tipo: 'intervir_menos',
      titulo: 'Sugerir menos vezes',
      porque: `${menos.length} dos seus últimos ${total} retornos foram “descartar” ou “não fazia sentido”.`,
      feedbackIds: menos.map((f) => f.id),
      antes: ROTULO_DO_MODO[modo],
      depois: ROTULO_DO_MODO[abaixo],
      mudanca: { tipo: 'modo', de: modo, para: abaixo },
    });
  }

  const mais = recentes(['tarde_demais'], 'intervir_mais');
  const acima = modoAcima(modo);
  // Quem está descartando muito não pede, ao mesmo tempo, mais sugestões.
  if (mais.length >= LIMIAR_PARA_INTERVIR_MAIS && acima && !propostas.some((x) => x.tipo === 'intervir_menos')) {
    propostas.push({
      tipo: 'intervir_mais',
      titulo: 'Avisar mais cedo',
      porque: `${mais.length} dos seus últimos ${total} retornos disseram que a sugestão veio “tarde demais”.`,
      feedbackIds: mais.map((f) => f.id),
      antes: ROTULO_DO_MODO[modo],
      depois: ROTULO_DO_MODO[acima],
      mudanca: { tipo: 'modo', de: modo, para: acima },
    });
  }

  const respondido = recentes(['ja_respondido'], 'conferir_o_respondido');
  const jaTem = p.perfil.preferencias.some((x) => x.toLocaleLowerCase('pt-BR') === PREFERENCIA_DO_JA_RESPONDIDO.toLocaleLowerCase('pt-BR'));
  if (respondido.length >= LIMIAR_PARA_CONFERIR_O_RESPONDIDO && !jaTem) {
    propostas.push({
      tipo: 'conferir_o_respondido',
      titulo: 'Conferir se já foi respondido',
      porque: `${respondido.length} dos seus últimos ${total} retornos disseram que o ponto “já estava respondido”.`,
      feedbackIds: respondido.map((f) => f.id),
      antes: p.perfil.preferencias.length ? `Meu jeito de trabalhar: ${p.perfil.preferencias.join('; ')}` : 'Meu jeito de trabalhar: (nenhuma preferência)',
      depois: `Meu jeito de trabalhar: ${[...p.perfil.preferencias, PREFERENCIA_DO_JA_RESPONDIDO].join('; ')}`,
      mudanca: { tipo: 'preferencia', texto: PREFERENCIA_DO_JA_RESPONDIDO },
    });
  }
  return propostas;
}

/** O conteúdo do perfil depois de aplicar a proposta. Puro: não grava. */
export function conteudoDepoisDe(perfil: PerfilDeConducao, m: Mudanca): ConteudoDoPerfil {
  const c = structuredClone(conteudoDe(perfil));
  if (m.tipo === 'modo') c.intervencao = { ...c.intervencao, modo: m.para };
  else c.preferencias = [...c.preferencias, m.texto];
  return c;
}

/**
 * Aplica a proposta que a pessoa aprovou: grava uma nova revisão do perfil, com o
 * histórico dizendo que foi proposta pelo Taq e aprovada. Confere a revisão lida:
 * se o perfil mudou no meio, volta conflito e nada é gravado.
 */
export async function aplicarAjuste(
  perfil: PerfilDeConducao,
  proposta: PropostaDeAjuste,
): Promise<ResultadoDaEdicao<PerfilDeConducao>> {
  if (proposta.mudanca.tipo === 'modo' && !(MODOS_DE_INTERVENCAO as readonly string[]).includes(proposta.mudanca.para))
    return { tipo: 'invalido', motivo: 'Modo desconhecido.' };
  return salvarPerfil(
    conteudoDepoisDe(perfil, proposta.mudanca),
    perfil.revisao,
    'pessoa',
    `perfil atualizado (ajuste proposto pelo Taq e aprovado: ${proposta.titulo})`,
  );
}
