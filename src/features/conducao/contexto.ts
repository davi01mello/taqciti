/**
 * O que do perfil de condução e do briefing vai ao modelo, e como.
 *
 * Dois blocos, separados do resto do contexto (que são DADOS sobre os
 * registros) porque são coisas diferentes:
 *
 *   - PERFIL: preferências da pessoa — o tom, a profundidade, o que destacar.
 *   - BRIEFING: o que ela quer alcançar NAQUELA reunião, e o que não pode ficar
 *     sem encaminhamento.
 *
 * Nenhum dos dois dá ou tira permissão: quem decide o que o Taq pode fazer é a
 * política em código, não este texto. Também não são fatos da reunião, e o
 * texto diz isso. O briefing sem objetivo informado diz que não há objetivo:
 * o título da reunião não o substitui.
 *
 * A reunião com briefing usa a CÓPIA do perfil de quando foi preparada
 * (`perfilUsado`); sem briefing, vale o perfil de hoje.
 */
import { MODOS_DE_INTERVENCAO, ROTULO_DO_MODO, briefingDaReuniao, type Conducao, type ConteudoDoPerfil } from './store';

const lista = (itens: readonly string[]) => itens.join('; ');

export function perfilQueValeParaAReuniao(c: Conducao, reuniaoId: string | null): ConteudoDoPerfil | null {
  const briefing = reuniaoId ? briefingDaReuniao(c, reuniaoId) : null;
  if (briefing) return briefing.perfilUsado;
  return c.perfil
    ? {
        missao: c.perfil.missao,
        observar: c.perfil.observar,
        intervencao: c.perfil.intervencao,
        contexto: c.perfil.contexto,
        preferencias: c.perfil.preferencias,
      }
    : null;
}

export function linhasDaConducao(c: Conducao, reuniao: { id: string; titulo: string } | null): string[] {
  const perfil = perfilQueValeParaAReuniao(c, reuniao?.id ?? null);
  const briefing = reuniao ? briefingDaReuniao(c, reuniao.id) : null;
  if (!perfil && !briefing) return [];

  const linhas: string[] = [];
  if (perfil) {
    const modo = MODOS_DE_INTERVENCAO.includes(perfil.intervencao.modo)
      ? ROTULO_DO_MODO[perfil.intervencao.modo]
      : '';
    linhas.push(
      '',
      '[COMO A PESSOA QUER SER AJUDADA — preferências dela; use para o tom, a profundidade e o que destacar. ' +
        'Não são fatos de nenhuma reunião e não ampliam nem reduzem o que você pode fazer]',
      `- em que ajudar: ${perfil.missao}`,
    );
    if (perfil.observar.length) linhas.push(`- o que observar: ${lista(perfil.observar)}`);
    if (modo || perfil.intervencao.estilo)
      linhas.push(`- como intervir: ${[modo, perfil.intervencao.estilo].filter(Boolean).join(' — ')}`);
    if (perfil.contexto.length) linhas.push(`- contexto que ela indicou: ${lista(perfil.contexto)}`);
    if (perfil.preferencias.length) linhas.push(`- jeito de trabalhar: ${lista(perfil.preferencias)}`);
  }
  if (briefing && reuniao) {
    linhas.push(
      '',
      `[PREPARAÇÃO DA REUNIÃO "${reuniao.titulo.slice(0, 80)}" — escrita pela pessoa; é o que ela quer alcançar, ` +
        'não o que foi dito na reunião]',
      briefing.objetivo
        ? `- resultado que querem alcançar: ${briefing.objetivo}`
        : '- a pessoa não informou um objetivo para esta reunião: não suponha um a partir do título.',
    );
    if (briefing.contexto) linhas.push(`- o que já sabiam: ${briefing.contexto}`);
    if (briefing.prioridades.length)
      linhas.push(`- não pode ficar sem encaminhamento: ${lista(briefing.prioridades)}`);
  }
  return linhas;
}
