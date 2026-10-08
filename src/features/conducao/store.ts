/**
 * O PERFIL DE CONDUÇÃO e o BRIEFING da reunião — o que a pessoa disse sobre
 * como quer ser ajudada, e o que ela quer alcançar naquele encontro.
 *
 * ── O que cada um é ─────────────────────────────────────────────────────────
 *
 * PERFIL: preferências estáveis de quem conduz. Em que o Taq ajuda, o que
 * observa, como intervém. É um resumo em linguagem comum que a pessoa lê e
 * edita; nenhum campo técnico (ferramenta, parâmetro de modelo) mora aqui.
 *
 * BRIEFING: o objetivo de UMA reunião, as questões que não podem ficar sem
 * encaminhamento e o contexto escrito pela pessoa. O objetivo é informado ou
 * aprovado por ela: nunca inferido do título da reunião (`aprovado`).
 *
 * ── Regras ──────────────────────────────────────────────────────────────────
 *
 * - O que o modelo PROPÕE não é salvo sozinho: só `salvarPerfil` e
 *   `salvarBriefing`, chamados pela pessoa, gravam.
 * - Toda edição confere a revisão que quem edita leu. Conflito volta como
 *   resultado, nunca como sobrescrita silenciosa. O histórico guarda cada
 *   mudança (quem fez, o quê).
 * - Uma reunião já iniciada mantém o perfil estável: o briefing guarda a
 *   revisão do perfil de quando foi preparado (`perfilRevisao`), e mudar o
 *   perfil depois não muda o que aquela reunião usa até a pessoa pedir.
 * - O briefing é derivado exclusivo da reunião, como a nota: apagar a reunião
 *   o leva junto (`features/annotations/vinculos.ts`). O perfil não.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange, readLocal, writeLocal } from '@/shared/services/storage';
import { comTravaLocal } from '@/shared/services/storageLock';

export const VERSAO_DA_CONDUCAO = 1;

export const MODOS_DE_INTERVENCAO = ['sob_demanda', 'discreto', 'participativo'] as const;
export type ModoDeIntervencao = (typeof MODOS_DE_INTERVENCAO)[number];

export const ROTULO_DO_MODO: Record<ModoDeIntervencao, string> = {
  sob_demanda: 'Só quando eu chamar',
  discreto: 'Discreto: uma lembrança relevante por vez',
  participativo: 'Participativo: perguntas e encaminhamentos com mais frequência',
};

const MAX_TEXTO = 400;
const MAX_ITEM = 200;
const MAX_ITENS = 8;
const MAX_HISTORICO = 50;

export type AutorDaMudanca = 'pessoa' | 'taq';

export interface EventoDaConducao {
  em: number;
  acao: string;
  origem: AutorDaMudanca;
}

/** Em linguagem de quem usa: o que o Taq vai fazer, observar e como vai intervir. */
export interface ConteudoDoPerfil {
  /** Em que vou ajudar. */
  missao: string;
  /** O que vou observar. */
  observar: string[];
  /** Como vou intervir: o modo, e um jeito em palavras ("uma pergunta curta por vez"). */
  intervencao: { modo: ModoDeIntervencao; estilo: string };
  /** Que contexto vou usar: materiais e históricos que a pessoa nomeou. */
  contexto: string[];
  /** Meu jeito de trabalhar: preferências estáveis, uma por item. */
  preferencias: string[];
}

export interface PerfilDeConducao extends ConteudoDoPerfil {
  revisao: number;
  criadoEm: number;
  atualizadoEm: number;
  historico: EventoDaConducao[];
}

export interface BriefingDaReuniao {
  reuniaoId: string;
  revisao: number;
  criadoEm: number;
  atualizadoEm: number;
  /** O resultado que a pessoa quer alcançar. Vazio até ela informar. */
  objetivo: string;
  /** `true` só quando a pessoa escreveu ou aprovou o objetivo. */
  aprovado: boolean;
  /** O que a pessoa escreveu sobre o contexto deste encontro. */
  contexto: string;
  /** O que não pode ficar sem encaminhamento. */
  prioridades: string[];
  /**
   * Encontros anteriores que a PESSOA escolheu retomar (ids de reuniões). O
   * vínculo é confirmado por ela e por id: nome nenhum liga um encontro a outro.
   */
  retomar: string[];
  /** A revisão do perfil de quando o briefing foi preparado; `null` = sem perfil. */
  perfilRevisao: number | null;
  /**
   * O CONTEÚDO do perfil que esta reunião usa: uma cópia do que valia quando
   * foi preparada. É isto que mantém a reunião estável — o número da revisão
   * sozinho não reproduz o texto antigo.
   */
  perfilUsado: ConteudoDoPerfil | null;
  historico: EventoDaConducao[];
}

export interface Conducao {
  versao: number;
  perfil: PerfilDeConducao | null;
  briefings: BriefingDaReuniao[];
}

export type ResultadoDaEdicao<T> =
  | { tipo: 'ok'; item: T }
  | { tipo: 'conflito'; atual: T | null }
  | { tipo: 'invalido'; motivo: string };

// ---------------------------------------------------------------- utilidades

function limpar(texto: unknown, max: number): string {
  return typeof texto === 'string' ? texto.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function limparLista(itens: unknown, max = MAX_ITENS): string[] {
  if (!Array.isArray(itens)) return [];
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const i of itens) {
    const t = limpar(i, MAX_ITEM);
    const chave = t.toLocaleLowerCase('pt-BR');
    if (!t || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(t);
    if (saida.length >= max) break;
  }
  return saida;
}

const MAX_RETOMAR = 5;

/**
 * Ids de reuniões escolhidas para retomar: textos não vazios, sem repetição, sem
 * a própria reunião e COM teto — o teto vale depois de tirar a própria reunião.
 */
function limparIds(itens: unknown, excluir?: string): string[] {
  if (!Array.isArray(itens)) return [];
  return [
    ...new Set(
      itens
        .filter((i): i is string => typeof i === 'string' && i.trim() !== '')
        .map((i) => i.trim())
        .filter((i) => i !== excluir),
    ),
  ].slice(0, MAX_RETOMAR);
}

/** Normaliza o conteúdo que a pessoa (ou uma proposta) trouxe. `null` = inválido. */
export function normalizarConteudoDoPerfil(bruto: unknown): ConteudoDoPerfil | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const b = bruto as Partial<Record<keyof ConteudoDoPerfil, unknown>>;
  const missao = limpar(b.missao, MAX_TEXTO);
  if (!missao) return null;
  const i = (b.intervencao ?? {}) as { modo?: unknown; estilo?: unknown };
  const modo = MODOS_DE_INTERVENCAO.find((m) => m === i.modo) ?? 'discreto';
  return {
    missao,
    observar: limparLista(b.observar),
    intervencao: { modo, estilo: limpar(i.estilo, MAX_ITEM) },
    contexto: limparLista(b.contexto),
    preferencias: limparLista(b.preferencias),
  };
}

function eventoDe(acao: string, origem: AutorDaMudanca): EventoDaConducao {
  return { em: Date.now(), acao, origem };
}

const VAZIO = (): Conducao => ({ versao: VERSAO_DA_CONDUCAO, perfil: null, briefings: [] });

export function normalizarConducao(bruto: unknown): Conducao {
  if (!bruto || typeof bruto !== 'object') return VAZIO();
  const b = bruto as Partial<Record<keyof Conducao, unknown>>;
  const p = b.perfil as Partial<PerfilDeConducao> | null | undefined;
  const conteudo = p && typeof p === 'object' ? normalizarConteudoDoPerfil(p) : null;
  return {
    versao: VERSAO_DA_CONDUCAO,
    perfil:
      conteudo && p
        ? {
            ...conteudo,
            revisao: Number.isInteger(p.revisao) && (p.revisao as number) > 0 ? (p.revisao as number) : 1,
            criadoEm: typeof p.criadoEm === 'number' ? p.criadoEm : 0,
            atualizadoEm: typeof p.atualizadoEm === 'number' ? p.atualizadoEm : 0,
            historico: Array.isArray(p.historico) ? p.historico : [],
          }
        : null,
    briefings: Array.isArray(b.briefings)
      ? (b.briefings as BriefingDaReuniao[])
          .filter((x) => !!x && typeof x === 'object' && typeof x.reuniaoId === 'string')
          .map((x) => ({
            ...x,
            objetivo: limpar(x.objetivo, MAX_TEXTO),
            contexto: limpar(x.contexto, MAX_TEXTO * 2),
            prioridades: limparLista(x.prioridades),
            retomar: limparIds(x.retomar),
            aprovado: x.aprovado === true,
            perfilRevisao: typeof x.perfilRevisao === 'number' ? x.perfilRevisao : null,
            perfilUsado: normalizarConteudoDoPerfil(x.perfilUsado),
            historico: Array.isArray(x.historico) ? x.historico : [],
          }))
      : [],
  };
}

// ------------------------------------------------------------------- leitura

export async function lerConducao(): Promise<Conducao> {
  const bruto = await readLocal<unknown>(STORAGE_KEYS.conducao);
  return normalizarConducao(bruto && typeof bruto === 'object' ? structuredClone(bruto) : bruto);
}

export function observarConducao(cb: (c: Conducao) => void): () => void {
  let vivo = true;
  let mudou = false;
  void lerConducao().then((c) => {
    if (vivo && !mudou) cb(c);
  });
  const parar = onLocalChange<unknown>(STORAGE_KEYS.conducao, (valor) => {
    if (!vivo) return;
    mudou = true;
    cb(normalizarConducao(valor));
  });
  return () => {
    vivo = false;
    parar();
  };
}

async function transacao<R>(mudar: (c: Conducao) => { resultado: R; mudou: boolean }): Promise<R> {
  return comTravaLocal(STORAGE_KEYS.conducao, async () => {
    const atual = await lerConducao();
    const { resultado, mudou } = mudar(atual);
    if (mudou) await writeLocal(STORAGE_KEYS.conducao, structuredClone(atual));
    return resultado;
  });
}

// -------------------------------------------------------------------- perfil

/**
 * Grava o perfil que a pessoa aprovou. `revisaoEsperada`: `0` para o primeiro
 * perfil, ou a revisão que ela leu. Igual ao que já está salvo não cria revisão.
 */
export async function salvarPerfil(
  conteudo: unknown,
  revisaoEsperada: number,
  autor: AutorDaMudanca = 'pessoa',
): Promise<ResultadoDaEdicao<PerfilDeConducao>> {
  const novo = normalizarConteudoDoPerfil(conteudo);
  if (!novo) return { tipo: 'invalido', motivo: 'Diga, ao menos, em que o Taq vai ajudar.' };
  return transacao<ResultadoDaEdicao<PerfilDeConducao>>((c) => {
    const atual = c.perfil;
    if ((atual?.revisao ?? 0) !== revisaoEsperada)
      return { resultado: { tipo: 'conflito' as const, atual }, mudou: false };
    const agora = Date.now();
    if (atual && JSON.stringify(conteudoDe(atual)) === JSON.stringify(novo))
      return { resultado: { tipo: 'ok' as const, item: atual }, mudou: false };
    const perfil: PerfilDeConducao = {
      ...novo,
      revisao: (atual?.revisao ?? 0) + 1,
      criadoEm: atual?.criadoEm ?? agora,
      atualizadoEm: Math.max(agora, (atual?.atualizadoEm ?? 0) + 1),
      historico: [...(atual?.historico ?? []), eventoDe(atual ? 'perfil atualizado' : 'perfil criado', autor)].slice(
        -MAX_HISTORICO,
      ),
    };
    c.perfil = perfil;
    return { resultado: { tipo: 'ok' as const, item: perfil }, mudou: true };
  });
}

export function conteudoDe(p: PerfilDeConducao): ConteudoDoPerfil {
  return {
    missao: p.missao,
    observar: p.observar,
    intervencao: p.intervencao,
    contexto: p.contexto,
    preferencias: p.preferencias,
  };
}

// ----------------------------------------------------------------- briefing

export interface MudancaDoBriefing {
  objetivo?: string;
  contexto?: string;
  prioridades?: string[];
  /** Ids dos encontros anteriores a retomar. */
  retomar?: string[];
}

export function briefingDaReuniao(c: Conducao, reuniaoId: string): BriefingDaReuniao | null {
  return c.briefings.find((b) => b.reuniaoId === reuniaoId) ?? null;
}

/**
 * Grava o briefing de uma reunião. Quem chama é a pessoa: `aprovado` fica
 * verdadeiro quando ela informa o objetivo, e volta a falso se ele for
 * apagado. `revisaoEsperada`: `0` para o primeiro briefing daquela reunião.
 */
export async function salvarBriefing(
  reuniaoId: string,
  mudanca: MudancaDoBriefing,
  revisaoEsperada: number,
  autor: AutorDaMudanca = 'pessoa',
): Promise<ResultadoDaEdicao<BriefingDaReuniao>> {
  if (!reuniaoId) return { tipo: 'invalido', motivo: 'Falta a reunião.' };
  return transacao<ResultadoDaEdicao<BriefingDaReuniao>>((c) => {
    const atual = briefingDaReuniao(c, reuniaoId);
    if ((atual?.revisao ?? 0) !== revisaoEsperada)
      return { resultado: { tipo: 'conflito' as const, atual }, mudou: false };
    const agora = Date.now();
    const objetivo = mudanca.objetivo !== undefined ? limpar(mudanca.objetivo, MAX_TEXTO) : (atual?.objetivo ?? '');
    const contexto =
      mudanca.contexto !== undefined ? limpar(mudanca.contexto, MAX_TEXTO * 2) : (atual?.contexto ?? '');
    const prioridades =
      mudanca.prioridades !== undefined ? limparLista(mudanca.prioridades) : (atual?.prioridades ?? []);
    const retomar = mudanca.retomar !== undefined ? limparIds(mudanca.retomar, reuniaoId) : (atual?.retomar ?? []);
    if (
      atual &&
      atual.objetivo === objetivo &&
      atual.contexto === contexto &&
      JSON.stringify(atual.prioridades) === JSON.stringify(prioridades) &&
      JSON.stringify(atual.retomar) === JSON.stringify(retomar)
    )
      return { resultado: { tipo: 'ok' as const, item: atual }, mudou: false };
    const briefing: BriefingDaReuniao = {
      reuniaoId,
      revisao: (atual?.revisao ?? 0) + 1,
      criadoEm: atual?.criadoEm ?? agora,
      atualizadoEm: Math.max(agora, (atual?.atualizadoEm ?? 0) + 1),
      objetivo,
      aprovado: objetivo !== '',
      contexto,
      prioridades,
      retomar,
      // Primeira preparação: fixa o perfil de agora. Depois, só quando a pessoa pede.
      perfilRevisao: atual ? atual.perfilRevisao : (c.perfil?.revisao ?? null),
      perfilUsado: atual ? atual.perfilUsado : c.perfil ? conteudoDe(c.perfil) : null,
      historico: [
        ...(atual?.historico ?? []),
        eventoDe(atual ? 'briefing atualizado' : 'briefing criado', autor),
      ].slice(-MAX_HISTORICO),
    };
    c.briefings = [briefing, ...c.briefings.filter((b) => b.reuniaoId !== reuniaoId)];
    return { resultado: { tipo: 'ok' as const, item: briefing }, mudou: true };
  });
}

/** A pessoa pediu para a reunião passar a usar o perfil atual. */
export async function atualizarPerfilDoBriefing(
  reuniaoId: string,
  revisaoEsperada: number,
): Promise<ResultadoDaEdicao<BriefingDaReuniao>> {
  return transacao<ResultadoDaEdicao<BriefingDaReuniao>>((c) => {
    const atual = briefingDaReuniao(c, reuniaoId);
    if (!atual || atual.revisao !== revisaoEsperada)
      return { resultado: { tipo: 'conflito' as const, atual }, mudou: false };
    const alvo = c.perfil?.revisao ?? null;
    if (atual.perfilRevisao === alvo) return { resultado: { tipo: 'ok' as const, item: atual }, mudou: false };
    atual.perfilRevisao = alvo;
    atual.perfilUsado = c.perfil ? structuredClone(conteudoDe(c.perfil)) : null;
    atual.revisao += 1;
    atual.atualizadoEm = Math.max(Date.now(), atual.atualizadoEm + 1);
    atual.historico = [...atual.historico, eventoDe('passou a usar o perfil atual', 'pessoa')].slice(-MAX_HISTORICO);
    return { resultado: { tipo: 'ok' as const, item: atual }, mudou: true };
  });
}

/** Apagar a reunião leva o briefing dela. Devolve quantos saíram. */
export function semBriefingDaReuniao(c: Conducao, reuniaoId: string): { conducao: Conducao; removidos: number } {
  const ficam = c.briefings.filter((b) => b.reuniaoId !== reuniaoId);
  return { conducao: { ...c, briefings: ficam }, removidos: c.briefings.length - ficam.length };
}
