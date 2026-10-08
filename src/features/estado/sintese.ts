/**
 * A SÍNTESE DE FECHAMENTO — o que ficou decidido, o que segue em aberto e o que
 * ainda falta definir, montada do estado dos pontos.
 *
 * É CÓDIGO sobre o estado já conferido, sem nova chamada ao modelo: cada item
 * vem de um ponto com a fala que o sustenta. Por isso valem aqui as mesmas
 * regras do estado:
 *
 *   - NADA vira decisão por aparecer na síntese: só "decidido" (decisão explícita
 *     na fala) entra em "decidido"; proposta fica em "a confirmar";
 *   - responsável e prazo ausentes são listados como NÃO DEFINIDOS, nunca
 *     preenchidos;
 *   - se a leitura é mais antiga que a transcrição, a síntese diz até onde foi
 *     (captura incompleta ou leitura desatualizada é um limite, e é dito).
 */
import type { Ponto, Snapshot } from './store';

export interface Sintese {
  decidido: Ponto[];
  /** A esclarecer ou discutido: ainda sem acordo nem resposta. */
  emAberto: Ponto[];
  /** Propostos e não fechados. */
  aConfirmar: Ponto[];
  adiado: Ponto[];
  /** Decididos ou a confirmar que não têm responsável, prazo ou ambos. */
  semResponsavelOuPrazo: Array<{ ponto: Ponto; falta: Array<'responsável' | 'prazo'> }>;
  /** Avisos de limite: leitura antiga, nada lido ainda. */
  limites: string[];
  /** Há algo a dizer? Sem pontos, a síntese não inventa conteúdo. */
  vazia: boolean;
}

export function sintetizar(s: Snapshot | null, falasAgora?: number): Sintese {
  const pontos = s?.pontos ?? [];
  const limites: string[] = [];
  if (!s) limites.push('A reunião ainda não foi lida: não há o que sintetizar.');
  else if (falasAgora !== undefined && falasAgora > s.revisao)
    limites.push(
      `A leitura vai até a fala ${s.revisao} de ${falasAgora}: o que foi dito depois não está aqui. Atualize para incluir.`,
    );
  const doEstado = (e: Ponto['estado']) => pontos.filter((p) => p.estado === e);
  const semResponsavelOuPrazo = pontos
    .filter((p) => p.estado === 'decidido' || p.estado === 'a_confirmar')
    .map((ponto) => ({
      ponto,
      falta: [...(ponto.dono ? [] : (['responsável'] as const)), ...(ponto.prazo ? [] : (['prazo'] as const))],
    }))
    .filter((x) => x.falta.length > 0);
  return {
    decidido: doEstado('decidido'),
    emAberto: [...doEstado('a_esclarecer'), ...doEstado('discutido')],
    aConfirmar: doEstado('a_confirmar'),
    adiado: doEstado('adiado'),
    semResponsavelOuPrazo,
    limites,
    vazia: pontos.length === 0,
  };
}

/** Pode virar acompanhamento? Só o que foi decidido ou combinado, e por clique da pessoa. */
export const podeVirarAcompanhamento = (p: Pick<Ponto, 'estado'>): boolean =>
  p.estado === 'decidido' || p.estado === 'a_confirmar';
