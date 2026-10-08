/**
 * O ESTADO DOS PONTOS de uma reunião — o que falta fechar, ponto a ponto, com a
 * fala que sustenta cada estado.
 *
 * ── Por que é estruturado ───────────────────────────────────────────────────
 *
 * Resposta em prosa livre deixa o modelo julgar e escrever tudo de uma vez, sem
 * que nada seja conferido (visto ao vivo: ponto já respondido listado como "não
 * esclarecido"). Aqui o modelo devolve UM estado por ponto, com as falas que o
 * sustentam, e o CÓDIGO decide o que aceita.
 *
 * ── Os estados (distintos de propósito) ─────────────────────────────────────
 *
 *   a_esclarecer   ainda não apareceu na conversa
 *   discutido      falaram, sem acordo
 *   a_confirmar    alguém propôs ou sugeriu; ninguém fechou
 *   decidido       houve decisão EXPLÍCITA na fala
 *   adiado         disseram que fica para depois
 *
 * Uma pergunta respondida pode esclarecer uma lacuna sem concluir o tópico.
 * Um tópico discutido pode terminar sem decisão. Proposta não é decisão.
 *
 * ── O que o código garante (`mesclar`) ──────────────────────────────────────
 *
 *   - todo estado diferente de "a esclarecer" tem fala citada que EXISTE e está
 *     antes do corte; o trecho guardado vem da transcrição, nunca do modelo;
 *   - "decidido" sai desse estado só com fala POSTERIOR à que o sustentava;
 *   - o que a pessoa corrigiu só muda por fala posterior à correção;
 *   - dono e prazo só ficam quando o nome / a expressão aparecem na fala citada
 *     — ausente continua ausente, nunca é preenchido por suposição;
 *   - ponto novo precisa de fonte com substância, e há um teto de pontos;
 *   - cada mudança deixa uma entrada no histórico, com a revisão e as falas.
 *
 * O estado é DERIVADO da reunião e das falas que existiam no corte: apagar a
 * reunião o leva junto (`features/annotations/vinculos.ts`).
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange, readLocal, writeLocal } from '@/shared/services/storage';
import { comTravaLocal } from '@/shared/services/storageLock';

export const VERSAO_DO_ESTADO = 1;
export const MAX_PONTOS = 10;
const MAX_HISTORICO_DO_PONTO = 12;
const MAX_TEXTO = 160;
const MAX_NOTA = 200;
/** Fala com menos palavras que isto não sustenta ponto novo nem decisão sozinha. */
export const MIN_PALAVRAS_DA_FONTE_DO_PONTO = 5;

export const ESTADOS_DO_PONTO = ['a_esclarecer', 'discutido', 'a_confirmar', 'decidido', 'adiado'] as const;
export type EstadoDoPonto = (typeof ESTADOS_DO_PONTO)[number];

export const ROTULO_DO_ESTADO: Record<EstadoDoPonto, string> = {
  a_esclarecer: 'A esclarecer',
  discutido: 'Discutido',
  a_confirmar: 'A confirmar',
  decidido: 'Decidido',
  adiado: 'Adiado',
};

export interface FalaCitada {
  segmento: number;
  trecho: string;
}

export interface EntradaDoHistorico {
  revisao: number;
  estado: EstadoDoPonto;
  falas: number[];
  por: 'modelo' | 'pessoa';
}

export interface Ponto {
  id: string;
  texto: string;
  origem: 'preparacao' | 'conversa';
  estado: EstadoDoPonto;
  evidencias: FalaCitada[];
  dono?: string;
  prazo?: string;
  /** Observação curta do modelo (lacuna, hipótese). Interpretação, não fato. */
  nota?: string;
  /** O corte (nº de falas consolidadas) em que o estado atual foi fixado. */
  revisao: number;
  /** A pessoa corrigiu: só fala POSTERIOR a esta revisão muda o estado de novo. */
  pessoaNaRevisao?: number;
  historico: EntradaDoHistorico[];
}

export interface Snapshot {
  reuniaoId: string;
  /** O corte desta leitura: quantas falas consolidadas a transcrição tinha. */
  revisao: number;
  atualizadoEm: number;
  /** O assunto em discussão. É HIPÓTESE do modelo, não um evento confirmado. */
  assunto?: { texto: string; evidencias: FalaCitada[] };
  /**
   * Uma frase que quem conduz poderia dizer para fechar o que falta ("quem
   * levanta os dados e até quando?"), escrita a partir DESTA reunião. É sugestão
   * do Taq — nunca uma fala registrada — e vale para a revisão em que nasceu.
   */
  fechamento?: { texto: string; revisao: number };
  pontos: Ponto[];
}

export type MapaDeEstados = Record<string, Snapshot>;

// ------------------------------------------------------------------- entrada

/** Uma atualização que o modelo propôs, ainda NÃO validada. */
export interface AtualizacaoProposta {
  assunto?: { texto: string; falas: number[] };
  /** Sugestão de frase de fechamento, a partir do que ficou em aberto. */
  fechamento?: string;
  pontos: Array<{
    /** Id de um ponto existente; ausente = ponto novo. */
    id?: string;
    texto?: string;
    estado: EstadoDoPonto;
    falas: number[];
    dono?: string;
    prazo?: string;
    nota?: string;
  }>;
}

export interface FalaDaTranscricao {
  speaker: string | null;
  text: string;
}

export interface ResultadoDaMesclagem {
  snapshot: Snapshot;
  /** O que o modelo trouxe e o código recusou, com o motivo — auditoria, não tela. */
  recusados: string[];
  mudancas: number;
}

// ---------------------------------------------------------------- utilidades

const limpar = (t: unknown, max: number): string =>
  typeof t === 'string' ? t.trim().replace(/\s+/g, ' ').slice(0, max) : '';

const palavras = (t: string): number => t.split(/\s+/).filter(Boolean).length;

/** Minúsculas e sem acento — só para conferir se um nome ou prazo aparece num trecho. */
const plano = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function idDoPontoDaPreparacao(texto: string): string {
  return `prep:${plano(texto).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60)}`;
}

let contador = 0;
const novoId = (): string => {
  contador += 1;
  return `c:${Date.now().toString(36)}${contador.toString(36)}`;
};

function citar(falas: number[], transcricao: readonly FalaDaTranscricao[], corte: number): FalaCitada[] | null {
  const unicas = [...new Set(falas)];
  if (!unicas.length || unicas.some((n) => !Number.isInteger(n) || n < 0 || n >= corte || n >= transcricao.length))
    return null;
  return unicas.map((n) => ({ segmento: n, trecho: limpar(transcricao[n]!.text, 280) }));
}

/** O snapshot inicial: os pontos da preparação, todos "a esclarecer". */
export function snapshotInicial(reuniaoId: string, prioridades: readonly string[], corte: number, agora: number): Snapshot {
  const pontos: Ponto[] = [];
  const vistos = new Set<string>();
  for (const p of prioridades) {
    const texto = limpar(p, MAX_TEXTO);
    const id = idDoPontoDaPreparacao(texto);
    if (!texto || vistos.has(id)) continue;
    vistos.add(id);
    pontos.push({ id, texto, origem: 'preparacao', estado: 'a_esclarecer', evidencias: [], revisao: corte, historico: [] });
  }
  return { reuniaoId, revisao: corte, atualizadoEm: agora, pontos: pontos.slice(0, MAX_PONTOS) };
}

/**
 * Aplica ao snapshot o que o modelo propôs, conferindo tudo. Pura: devolve um
 * snapshot novo e a lista do que foi recusado.
 */
export function mesclar(p: {
  anterior: Snapshot;
  proposta: AtualizacaoProposta;
  transcricao: readonly FalaDaTranscricao[];
  corte: number;
  agora: number;
}): ResultadoDaMesclagem {
  const { proposta, transcricao, corte } = p;
  const pontos: Ponto[] = p.anterior.pontos.map((x) => structuredClone(x));
  const recusados: string[] = [];
  let mudancas = 0;

  for (const item of proposta.pontos) {
    if (!(ESTADOS_DO_PONTO as readonly string[]).includes(item.estado)) {
      recusados.push(`estado desconhecido: ${String(item.estado)}`);
      continue;
    }
    const existente = item.id ? pontos.find((x) => x.id === item.id) : undefined;
    if (item.id && !existente) {
      recusados.push(`ponto desconhecido (${item.id})`);
      continue;
    }

    const evidencias = item.falas.length ? citar(item.falas, transcricao, corte) : [];
    if (item.falas.length && !evidencias) {
      recusados.push(`${item.id ?? limpar(item.texto, 40)}: cita fala que não existe até o corte (fonte inexistente)`);
      continue;
    }
    const falasCitadas = evidencias ?? [];
    const maisNova = Math.max(-1, ...falasCitadas.map((e) => e.segmento));

    // Todo estado diferente de "a esclarecer" precisa de fala que o sustente.
    if (item.estado !== 'a_esclarecer' && !falasCitadas.length) {
      recusados.push(`${item.id ?? limpar(item.texto, 40)}: "${item.estado}" sem fala que o sustente`);
      continue;
    }
    // "Decidido" não se apoia só em fala protocolar.
    if (
      item.estado === 'decidido' &&
      !falasCitadas.some((e) => palavras(e.trecho) >= MIN_PALAVRAS_DA_FONTE_DO_PONTO)
    ) {
      recusados.push(`${item.id ?? limpar(item.texto, 40)}: "decidido" sem fala com conteúdo`);
      continue;
    }

    // dono e prazo só ficam se aparecem na fala citada (ou, para o dono, em quem falou).
    const textoCitado = plano(falasCitadas.map((e) => e.trecho).join(' '));
    const falantes = plano(falasCitadas.map((e) => transcricao[e.segmento]?.speaker ?? '').join(' '));
    let dono = limpar(item.dono, 80) || undefined;
    if (dono && !textoCitado.includes(plano(dono)) && !falantes.includes(plano(dono))) {
      recusados.push(`dono “${dono}” não aparece na fala citada: continua em aberto`);
      dono = undefined;
    }
    let prazo = limpar(item.prazo, 80) || undefined;
    if (prazo && !textoCitado.includes(plano(prazo))) {
      recusados.push(`prazo “${prazo}” não aparece na fala citada: continua em aberto`);
      prazo = undefined;
    }
    const nota = limpar(item.nota, MAX_NOTA) || undefined;

    if (existente) {
      // A pessoa corrigiu: só fala posterior à correção muda de novo.
      if (existente.pessoaNaRevisao !== undefined && maisNova < existente.pessoaNaRevisao) {
        recusados.push(`${existente.id}: a pessoa corrigiu este ponto; falta fala posterior à correção`);
        continue;
      }
      // Reabrir um ponto decidido exige fala posterior à que o sustentava.
      if (existente.estado === 'decidido' && item.estado !== 'decidido' && maisNova < existente.revisao) {
        recusados.push(`${existente.id}: reabrir um ponto decidido exige fala posterior à decisão`);
        continue;
      }
      const mudou =
        existente.estado !== item.estado ||
        (dono ?? undefined) !== existente.dono ||
        (prazo ?? undefined) !== existente.prazo;
      // Mesmo estado, só reafirmando: não gera histórico nem mexe no que já estava.
      if (!mudou) continue;
      existente.estado = item.estado;
      existente.evidencias = falasCitadas;
      existente.revisao = corte;
      if (dono) existente.dono = dono;
      if (prazo) existente.prazo = prazo;
      if (nota) existente.nota = nota;
      existente.historico = [
        ...existente.historico,
        { revisao: corte, estado: item.estado, falas: falasCitadas.map((e) => e.segmento), por: 'modelo' as const },
      ].slice(-MAX_HISTORICO_DO_PONTO);
      mudancas += 1;
      continue;
    }

    // Ponto novo, nascido da conversa.
    const texto = limpar(item.texto, MAX_TEXTO);
    if (!texto) {
      recusados.push('ponto novo sem texto');
      continue;
    }
    if (pontos.length >= MAX_PONTOS) {
      recusados.push(`teto de ${MAX_PONTOS} pontos: “${texto}” não entrou`);
      continue;
    }
    if (!falasCitadas.some((e) => palavras(e.trecho) >= MIN_PALAVRAS_DA_FONTE_DO_PONTO)) {
      recusados.push(`ponto novo “${texto}” sem fonte com conteúdo`);
      continue;
    }
    pontos.push({
      id: novoId(),
      texto,
      origem: 'conversa',
      estado: item.estado,
      evidencias: falasCitadas,
      ...(dono ? { dono } : {}),
      ...(prazo ? { prazo } : {}),
      ...(nota ? { nota } : {}),
      revisao: corte,
      historico: [{ revisao: corte, estado: item.estado, falas: falasCitadas.map((e) => e.segmento), por: 'modelo' }],
    });
    mudancas += 1;
  }

  let assunto = p.anterior.assunto;
  if (proposta.assunto) {
    const e = citar(proposta.assunto.falas, transcricao, corte);
    const texto = limpar(proposta.assunto.texto, MAX_TEXTO);
    if (e && texto) assunto = { texto, evidencias: e };
    else recusados.push('assunto atual sem fonte válida');
  }

  // A frase de fechamento é da leitura atual: some se esta leitura não trouxe uma.
  // Só faz sentido enquanto algo estiver sem fechar; do contrário, não há o que sugerir.
  const textoDoFechamento = limpar(proposta.fechamento, 220);
  const algoPorFechar = pontos.some((x) => x.estado !== 'decidido' || !x.dono || !x.prazo);
  const fechamento =
    textoDoFechamento && algoPorFechar ? { texto: textoDoFechamento, revisao: corte } : undefined;

  return {
    snapshot: {
      reuniaoId: p.anterior.reuniaoId,
      revisao: corte,
      atualizadoEm: p.agora,
      ...(assunto ? { assunto } : {}),
      ...(fechamento ? { fechamento } : {}),
      pontos,
    },
    recusados,
    mudancas,
  };
}

/** A pessoa corrige o estado de um ponto. Vale até haver fala posterior. */
export function corrigirPelaPessoa(
  s: Snapshot,
  pontoId: string,
  estado: EstadoDoPonto,
): { snapshot: Snapshot; ok: boolean } {
  if (!(ESTADOS_DO_PONTO as readonly string[]).includes(estado)) return { snapshot: s, ok: false };
  const pontos = s.pontos.map((x) => structuredClone(x));
  const p = pontos.find((x) => x.id === pontoId);
  if (!p) return { snapshot: s, ok: false };
  if (p.estado !== estado) {
    p.estado = estado;
    p.revisao = s.revisao;
    p.historico = [...p.historico, { revisao: s.revisao, estado, falas: [], por: 'pessoa' as const }].slice(
      -MAX_HISTORICO_DO_PONTO,
    );
  }
  p.pessoaNaRevisao = s.revisao;
  return { snapshot: { ...s, pontos }, ok: true };
}

// --------------------------------------------------------------- persistência

export function normalizarEstados(bruto: unknown): MapaDeEstados {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
  const saida: MapaDeEstados = {};
  for (const [id, v] of Object.entries(bruto as Record<string, unknown>)) {
    const s = v as Partial<Snapshot> | null;
    if (!s || typeof s !== 'object' || !Array.isArray(s.pontos) || typeof s.revisao !== 'number') continue;
    saida[id] = {
      reuniaoId: id,
      revisao: s.revisao,
      atualizadoEm: typeof s.atualizadoEm === 'number' ? s.atualizadoEm : 0,
      ...(s.assunto && typeof s.assunto.texto === 'string' ? { assunto: s.assunto } : {}),
      ...(s.fechamento && typeof s.fechamento.texto === 'string' && typeof s.fechamento.revisao === 'number'
        ? { fechamento: s.fechamento }
        : {}),
      pontos: (s.pontos as Ponto[]).filter(
        (p) => !!p && typeof p.id === 'string' && (ESTADOS_DO_PONTO as readonly string[]).includes(p.estado),
      ),
    };
  }
  return saida;
}

export async function lerEstados(): Promise<MapaDeEstados> {
  const bruto = await readLocal<unknown>(STORAGE_KEYS.estado);
  return normalizarEstados(bruto && typeof bruto === 'object' ? structuredClone(bruto) : bruto);
}

export function observarEstados(cb: (m: MapaDeEstados) => void): () => void {
  let vivo = true;
  let mudou = false;
  void lerEstados().then((m) => {
    if (vivo && !mudou) cb(m);
  });
  const parar = onLocalChange<unknown>(STORAGE_KEYS.estado, (valor) => {
    if (!vivo) return;
    mudou = true;
    cb(normalizarEstados(valor));
  });
  return () => {
    vivo = false;
    parar();
  };
}

/** Lê, muda e grava sob a trava. */
export async function transacaoDoEstado<R>(
  mudar: (mapa: MapaDeEstados) => { resultado: R; mudou: boolean },
): Promise<R> {
  return comTravaLocal(STORAGE_KEYS.estado, async () => {
    const atual = await lerEstados();
    const { resultado, mudou } = mudar(atual);
    if (mudou) await writeLocal(STORAGE_KEYS.estado, structuredClone(atual));
    return resultado;
  });
}

/** A pessoa corrige um ponto, gravando. */
export async function corrigirPontoDaReuniao(reuniaoId: string, pontoId: string, estado: EstadoDoPonto): Promise<boolean> {
  return transacaoDoEstado((m) => {
    const s = m[reuniaoId];
    if (!s) return { resultado: false, mudou: false };
    const r = corrigirPelaPessoa(s, pontoId, estado);
    if (!r.ok) return { resultado: false, mudou: false };
    m[reuniaoId] = r.snapshot;
    return { resultado: true, mudou: true };
  });
}
