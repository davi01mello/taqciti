/**
 * As SUGESTÕES de condução (candidatos de intervenção) e o que a pessoa fez com
 * elas (feedback).
 *
 * ── O que isto guarda, e o que não guarda ───────────────────────────────────
 *
 * Um candidato é uma sugestão PRIVADA para quem conduz a reunião: um ponto que
 * merece atenção, uma pergunta que ela poderia fazer, um lembrete. Guarda o
 * texto, um motivo curto, as falas que o sustentam e a condição de validade (a
 * revisão da transcrição em que nasceu). Não guarda raciocínio do modelo.
 *
 * Sugestão NÃO é fala registrada nem decisão: `natureza` diz se é inferência ou
 * recomendação, e a interface a rotula assim. "Usar" uma pergunta não prova que
 * ela foi respondida.
 *
 * ── Estados ─────────────────────────────────────────────────────────────────
 *
 *   pendente → mostrada → usada | guardada | resolvida | descartada | expirada
 *   pendente → descartada | expirada | substituida
 *   guardada → mostrada | descartada
 *
 * Transição fora desta tabela não acontece. `usada` e `resolvida` são coisas
 * diferentes: a pessoa usou a pergunta, ou a conversa já a respondeu.
 *
 * ── Escrita ─────────────────────────────────────────────────────────────────
 *
 * Sob a trava do storage, como os demais registros locais. Sugestão é derivada
 * da reunião: apagar a reunião leva as dela (`features/annotations/vinculos.ts`).
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange, readLocal, writeLocal } from '@/shared/services/storage';
import { comTravaLocal } from '@/shared/services/storageLock';

export const VERSAO_DO_APOIO = 1;
const LIMITE_DE_CANDIDATOS = 300;
const LIMITE_DE_FEEDBACK = 500;
const MAX_TEXTO = 240;
const MAX_MOTIVO = 160;
const MAX_PONTO = 80;

export const TIPOS_DE_SUGESTAO = ['pergunta', 'lembranca', 'esclarecimento', 'fechamento'] as const;
export type TipoDeSugestao = (typeof TIPOS_DE_SUGESTAO)[number];

export const ROTULO_DO_TIPO: Record<TipoDeSugestao, string> = {
  pergunta: 'Pergunta sugerida',
  lembranca: 'Lembrete',
  esclarecimento: 'A esclarecer',
  fechamento: 'Para fechar',
};

export const NATUREZAS = ['inferencia', 'recomendacao'] as const;
export type Natureza = (typeof NATUREZAS)[number];

export const ESTADOS_DA_SUGESTAO = [
  'pendente',
  'mostrada',
  'usada',
  'guardada',
  'resolvida',
  'descartada',
  'expirada',
  'substituida',
] as const;
export type EstadoDaSugestao = (typeof ESTADOS_DA_SUGESTAO)[number];

const TRANSICOES: Readonly<Record<EstadoDaSugestao, readonly EstadoDaSugestao[]>> = {
  pendente: ['mostrada', 'descartada', 'expirada', 'substituida'],
  mostrada: ['usada', 'guardada', 'resolvida', 'descartada', 'expirada'],
  guardada: ['mostrada', 'descartada', 'resolvida'],
  usada: [],
  resolvida: [],
  descartada: [],
  expirada: [],
  substituida: [],
};

export interface FalaQueSustenta {
  /** Índice da fala na transcrição. Tem de existir quando a sugestão nasce. */
  segmento: number;
  trecho: string;
}

export interface Sugestao {
  id: string;
  reuniaoId: string;
  criadoEm: number;
  /** Quantas falas consolidadas a transcrição tinha quando a sugestão nasceu. */
  revisao: number;
  tipo: TipoDeSugestao;
  natureza: Natureza;
  /** O ponto que merece atenção, em uma frase. */
  texto: string;
  /** A pergunta que a pessoa poderia fazer, na voz de quem pergunta. */
  pergunta?: string;
  /** Por que agora, em poucas palavras. */
  motivo: string;
  /** O assunto a que se refere: é a chave de repetição e de descarte. */
  ponto: string;
  /** O modelo diz se serve ao objetivo da reunião. Só entra no desempate da política. */
  doObjetivo?: boolean;
  evidencias: FalaQueSustenta[];
  estado: EstadoDaSugestao;
  mostradaEm?: number;
  encerradaEm?: number;
  /** Quem a encerrou: a pessoa, o tempo, ou o modelo com fala posterior. */
  encerradaPor?: 'pessoa' | 'tempo' | 'conversa' | 'substituicao';
}

export const TIPOS_DE_FEEDBACK = [
  'util',
  'descartada',
  'adiada',
  'resolvida',
  'ja_respondido',
  'tarde_demais',
  'sem_sentido',
] as const;
export type TipoDeFeedback = (typeof TIPOS_DE_FEEDBACK)[number];

/** Até onde a pessoa quer que o feedback valha. Nada vira regra global em silêncio. */
export const ALCANCES = ['agora', 'reuniao', 'cliente', 'preferencia'] as const;
export type Alcance = (typeof ALCANCES)[number];

export interface Feedback {
  id: string;
  sugestaoId: string;
  reuniaoId: string;
  em: number;
  tipo: TipoDeFeedback;
  alcance: Alcance;
  comentario?: string;
}

export interface Apoio {
  versao: number;
  sugestoes: Sugestao[];
  feedback: Feedback[];
}

export type NovaSugestao = Omit<
  Sugestao,
  'id' | 'criadoEm' | 'estado' | 'mostradaEm' | 'encerradaEm' | 'encerradaPor'
>;

export type ResultadoDoFeedback =
  | { tipo: 'ok'; feedback: Feedback }
  | { tipo: 'inexistente' }
  | { tipo: 'invalido'; motivo: string };

export type ResultadoDaMudanca =
  | { tipo: 'ok'; sugestao: Sugestao }
  | { tipo: 'inexistente' }
  | { tipo: 'transicao_invalida'; de: EstadoDaSugestao; para: EstadoDaSugestao }
  | { tipo: 'invalida'; motivo: string };

// ---------------------------------------------------------------- utilidades

let contador = 0;
function novoId(prefixo: string): string {
  contador += 1;
  return `${prefixo}${Date.now().toString(36)}${contador.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

const limpar = (t: unknown, max: number): string =>
  typeof t === 'string' ? t.trim().replace(/\s+/g, ' ').slice(0, max) : '';

export function podeTransitar(de: EstadoDaSugestao, para: EstadoDaSugestao): boolean {
  return TRANSICOES[de].includes(para);
}

/** Aberta = ainda pode ser mostrada ou está na tela. */
export const estaAberta = (s: Pick<Sugestao, 'estado'>): boolean =>
  s.estado === 'pendente' || s.estado === 'mostrada';

export function normalizarApoio(bruto: unknown): Apoio {
  const vazio: Apoio = { versao: VERSAO_DO_APOIO, sugestoes: [], feedback: [] };
  if (!bruto || typeof bruto !== 'object') return vazio;
  const b = bruto as Partial<Record<keyof Apoio, unknown>>;
  const sugestoes = Array.isArray(b.sugestoes)
    ? (b.sugestoes as Sugestao[]).filter(
        (s) =>
          !!s &&
          typeof s === 'object' &&
          typeof s.id === 'string' &&
          typeof s.reuniaoId === 'string' &&
          (ESTADOS_DA_SUGESTAO as readonly string[]).includes(s.estado) &&
          (TIPOS_DE_SUGESTAO as readonly string[]).includes(s.tipo),
      )
    : [];
  const feedback = Array.isArray(b.feedback)
    ? (b.feedback as Feedback[]).filter((f) => !!f && typeof f === 'object' && typeof f.id === 'string')
    : [];
  return { versao: VERSAO_DO_APOIO, sugestoes, feedback };
}

export async function lerApoio(): Promise<Apoio> {
  const bruto = await readLocal<unknown>(STORAGE_KEYS.apoio);
  return normalizarApoio(bruto && typeof bruto === 'object' ? structuredClone(bruto) : bruto);
}

export function observarApoio(cb: (a: Apoio) => void): () => void {
  let vivo = true;
  let mudou = false;
  void lerApoio().then((a) => {
    if (vivo && !mudou) cb(a);
  });
  const parar = onLocalChange<unknown>(STORAGE_KEYS.apoio, (valor) => {
    if (!vivo) return;
    mudou = true;
    cb(normalizarApoio(valor));
  });
  return () => {
    vivo = false;
    parar();
  };
}

async function transacao<R>(mudar: (a: Apoio) => { resultado: R; mudou: boolean }): Promise<R> {
  return comTravaLocal(STORAGE_KEYS.apoio, async () => {
    const atual = await lerApoio();
    const { resultado, mudou } = mudar(atual);
    if (mudou) {
      // O que já terminou sai primeiro quando passa do limite.
      if (atual.sugestoes.length > LIMITE_DE_CANDIDATOS) {
        const abertas = atual.sugestoes.filter(estaAberta);
        const fechadas = atual.sugestoes.filter((s) => !estaAberta(s));
        atual.sugestoes = [...abertas, ...fechadas].slice(0, LIMITE_DE_CANDIDATOS);
      }
      atual.feedback = atual.feedback.slice(-LIMITE_DE_FEEDBACK);
      await writeLocal(STORAGE_KEYS.apoio, structuredClone(atual));
    }
    return resultado;
  });
}

// ------------------------------------------------------------- sugestões

/**
 * Guarda uma sugestão nova como `pendente`. Texto, motivo, ponto e pelo menos
 * uma fala que a sustente são obrigatórios: sugestão sem fonte não nasce.
 */
export async function registrarSugestao(
  nova: NovaSugestao,
): Promise<{ tipo: 'ok'; sugestao: Sugestao } | { tipo: 'invalida'; motivo: string }> {
  const texto = limpar(nova.texto, MAX_TEXTO);
  const motivo = limpar(nova.motivo, MAX_MOTIVO);
  const ponto = limpar(nova.ponto, MAX_PONTO);
  const pergunta = limpar(nova.pergunta, MAX_TEXTO);
  if (!nova.reuniaoId) return { tipo: 'invalida', motivo: 'Falta a reunião.' };
  if (!texto || !motivo || !ponto)
    return { tipo: 'invalida', motivo: 'Sugestão sem texto, motivo ou ponto.' };
  if (!(TIPOS_DE_SUGESTAO as readonly string[]).includes(nova.tipo))
    return { tipo: 'invalida', motivo: 'Tipo de sugestão desconhecido.' };
  if (!(NATUREZAS as readonly string[]).includes(nova.natureza))
    return { tipo: 'invalida', motivo: 'Diga se é inferência ou recomendação.' };
  const evidencias = (nova.evidencias ?? [])
    .filter((e) => Number.isInteger(e?.segmento) && e.segmento >= 0 && e.segmento < nova.revisao)
    .map((e) => ({ segmento: e.segmento, trecho: limpar(e.trecho, 280) }))
    .filter((e) => e.trecho);
  if (!evidencias.length)
    return { tipo: 'invalida', motivo: 'Sem fala da transcrição que sustente a sugestão.' };
  return transacao((a) => {
    const s: Sugestao = {
      id: novoId('s'),
      reuniaoId: nova.reuniaoId,
      criadoEm: Date.now(),
      revisao: nova.revisao,
      tipo: nova.tipo,
      natureza: nova.natureza,
      texto,
      ...(pergunta ? { pergunta } : {}),
      motivo,
      ponto,
      ...(nova.doObjetivo === true ? { doObjetivo: true } : {}),
      evidencias,
      estado: 'pendente',
    };
    a.sugestoes.unshift(s);
    return { resultado: { tipo: 'ok' as const, sugestao: s }, mudou: true };
  });
}

/** Muda o estado seguindo a tabela de transições. */
export async function mudarEstado(
  id: string,
  para: EstadoDaSugestao,
  por?: Sugestao['encerradaPor'],
): Promise<ResultadoDaMudanca> {
  return transacao<ResultadoDaMudanca>((a) => {
    const s = a.sugestoes.find((x) => x.id === id);
    if (!s) return { resultado: { tipo: 'inexistente' as const }, mudou: false };
    if (s.estado === para) return { resultado: { tipo: 'ok' as const, sugestao: s }, mudou: false };
    if (!podeTransitar(s.estado, para))
      return { resultado: { tipo: 'transicao_invalida' as const, de: s.estado, para }, mudou: false };
    const agora = Date.now();
    s.estado = para;
    if (para === 'mostrada') s.mostradaEm = agora;
    if (!estaAberta(s) && para !== 'guardada') {
      s.encerradaEm = agora;
      if (por) s.encerradaPor = por;
    }
    return { resultado: { tipo: 'ok' as const, sugestao: s }, mudou: true };
  });
}

/** Encerra de uma vez todas as abertas de uma reunião (reunião encerrada, sugestões pausadas…). */
export async function expirarAbertas(reuniaoId: string, por: 'tempo' | 'conversa' = 'tempo'): Promise<number> {
  return transacao((a) => {
    let n = 0;
    const agora = Date.now();
    for (const s of a.sugestoes) {
      if (s.reuniaoId !== reuniaoId || !estaAberta(s)) continue;
      s.estado = 'expirada';
      s.encerradaEm = agora;
      s.encerradaPor = por;
      n += 1;
    }
    return { resultado: n, mudou: n > 0 };
  });
}

// ------------------------------------------------------------------ feedback

export async function registrarFeedback(p: {
  sugestaoId: string;
  tipo: TipoDeFeedback;
  alcance?: Alcance;
  comentario?: string;
}): Promise<ResultadoDoFeedback> {
  if (!(TIPOS_DE_FEEDBACK as readonly string[]).includes(p.tipo))
    return { tipo: 'invalido', motivo: 'Tipo de feedback desconhecido.' };
  const alcance = p.alcance ?? 'agora';
  if (!(ALCANCES as readonly string[]).includes(alcance))
    return { tipo: 'invalido', motivo: 'Alcance desconhecido.' };
  return transacao<ResultadoDoFeedback>((a) => {
    const s = a.sugestoes.find((x) => x.id === p.sugestaoId);
    if (!s) return { resultado: { tipo: 'inexistente' as const }, mudou: false };
    const comentario = limpar(p.comentario, 300);
    const f: Feedback = {
      id: novoId('f'),
      sugestaoId: s.id,
      reuniaoId: s.reuniaoId,
      em: Date.now(),
      tipo: p.tipo,
      alcance,
      ...(comentario ? { comentario } : {}),
    };
    a.feedback.push(f);
    return { resultado: { tipo: 'ok' as const, feedback: f }, mudou: true };
  });
}

/** Sugestões e feedback de uma reunião: derivados dela. */
export function semApoioDaReuniao(a: Apoio, reuniaoId: string): { apoio: Apoio; removidas: number } {
  const sugestoes = a.sugestoes.filter((s) => s.reuniaoId !== reuniaoId);
  return {
    apoio: { ...a, sugestoes, feedback: a.feedback.filter((f) => f.reuniaoId !== reuniaoId) },
    removidas: a.sugestoes.length - sugestoes.length,
  };
}
