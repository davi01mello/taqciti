/**
 * O que do perfil do assistente e do briefing vai ao modelo, e como.
 *
 * Dois blocos, separados do resto do contexto (que são DADOS sobre os
 * registros) porque são coisas diferentes:
 *
 *   - PERFIL: os contextos que a pessoa LIGOU (os guardados não vão) e o modo
 *     de intervenção — o tom, a profundidade, o que destacar.
 *   - BRIEFING: o que ela quer alcançar NAQUELA reunião, e o que não pode ficar
 *     sem encaminhamento.
 *
 * Nenhum dos dois dá ou tira permissão: quem decide o que o Taq pode fazer é a
 * política em código, não este texto. Também não são fatos da reunião, e o
 * texto diz isso. O briefing sem objetivo informado diz que não há objetivo:
 * o título da reunião não o substitui. A busca na internet não entra: é só a
 * preferência, e a ferramenta não existe.
 *
 * Qual perfil vale para a reunião, nesta ordem: a cópia de quando ela COMEÇOU
 * (`emUso`); a de quando foi preparada (`perfilUsado` do briefing, para a
 * reunião que não tem a outra); o perfil de hoje. Sem nada salvo, o perfil de
 * hoje é o Padrão do CITi.
 */
import {
  MODOS_DE_INTERVENCAO,
  ROTULO_DO_MODO,
  briefingDaReuniao,
  conteudoDoPadrao,
  perfilAtual,
  perfilEmUsoDaReuniao,
  type Conducao,
  type ConteudoDoPerfil,
} from './store';

const lista = (itens: readonly string[]) => itens.join('; ');

export function perfilQueValeParaAReuniao(c: Conducao, reuniaoId: string | null): ConteudoDoPerfil {
  if (!reuniaoId) return perfilAtual(c);
  const briefing = briefingDaReuniao(c, reuniaoId);
  const usado =
    perfilEmUsoDaReuniao(c, reuniaoId)?.perfilUsado ??
    (briefing ? (briefing.perfilUsado ?? conteudoDoPadrao()) : perfilAtual(c));
  // O modo escolhido para ESTA reunião vale só para ela, e só sobre um perfil
  // personalizado: o padrão é fixo, e escolher um modo não liga o apoio nele.
  return briefing?.modo && usado.base === 'personalizado'
    ? { ...usado, intervencao: { ...usado.intervencao, modo: briefing.modo } }
    : usado;
}

export function linhasDaConducao(c: Conducao, reuniao: { id: string; titulo: string } | null): string[] {
  const perfil = perfilQueValeParaAReuniao(c, reuniao?.id ?? null);
  const briefing = reuniao ? briefingDaReuniao(c, reuniao.id) : null;
  const levados = perfil.contextos.filter((x) => x.ligado && x.texto);

  const linhas: string[] = [];
  const modo = MODOS_DE_INTERVENCAO.includes(perfil.intervencao.modo) ? ROTULO_DO_MODO[perfil.intervencao.modo] : '';
  linhas.push(
    '',
    '[O QUE A PESSOA LEVA PARA AS REUNIÕES — contextos e preferências dela; use para o tom, a profundidade e o que ' +
      'destacar. Não são fatos de nenhuma reunião e não ampliam nem reduzem o que você pode fazer]',
  );
  if (modo) linhas.push(`- como intervir: ${modo}`);
  for (const x of levados) linhas.push(`- ${x.nome}: ${x.texto}`);
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
