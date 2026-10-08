/**
 * A POLÍTICA DE INTERVENÇÃO — quando uma sugestão aparece, espera ou morre.
 *
 * O modelo escreve a sugestão; ISTO decide se ela é mostrada. Uma sugestão
 * exibida precisa de mais que texto gerado: passa por validade, repetição,
 * frequência e orçamento de atenção. Tudo aqui é conta sobre o estado — nenhuma
 * regra de texto, nenhum julgamento de significado: se uma fala nova resolveu o
 * ponto, quem diz isso é o modelo (com a fala citada), e o código só registra.
 *
 * ── O que a política garante ────────────────────────────────────────────────
 *
 *   - NO MÁXIMO UMA sugestão na tela por vez;
 *   - sugestão VELHA (a conversa andou além da janela de validade) é descartada
 *     antes de aparecer, nunca mostrada atrasada;
 *   - o MESMO ponto não volta enquanto a anterior está viva ou recente, e um
 *     ponto descartado só volta depois de falas novas suficientes;
 *   - intervalo mínimo entre sugestões e limite por hora, por modo;
 *   - "sob demanda" e "pausado" nunca mostram nada sozinhos;
 *   - silêncio é o padrão: sem candidato que passe, nada aparece.
 *
 * Os números abaixo são PONTO DE PARTIDA, não medição: a Etapa 6 os ajusta com
 * reuniões reais. Por isso vivem num lugar só.
 */
import type { ModoDeIntervencao } from '@/features/conducao/store';
import { estaAberta, type Sugestao } from './store';

export interface ConfiguracaoDoModo {
  /** Tempo mínimo entre uma sugestão mostrada e a próxima. */
  intervaloEntreSugestoesMs: number;
  limitePorHora: number;
  /** Tempo mínimo entre duas avaliações pelo modelo. */
  intervaloEntreAvaliacoesMs: number;
  /** Falas consolidadas novas necessárias para valer a pena avaliar de novo. */
  falasNovasParaAvaliar: number;
}

/** `null` = o modo nunca age sozinho. */
export const CONFIGURACAO_DOS_MODOS: Readonly<Record<ModoDeIntervencao, ConfiguracaoDoModo | null>> = {
  sob_demanda: null,
  discreto: {
    intervaloEntreSugestoesMs: 150_000,
    limitePorHora: 4,
    intervaloEntreAvaliacoesMs: 60_000,
    falasNovasParaAvaliar: 4,
  },
  participativo: {
    intervaloEntreSugestoesMs: 75_000,
    limitePorHora: 12,
    intervaloEntreAvaliacoesMs: 35_000,
    falasNovasParaAvaliar: 3,
  },
};

/** Quantas falas a conversa pode andar depois que a sugestão nasceu, antes de ela caducar. */
export const JANELA_DE_VALIDADE_EM_FALAS = 10;
/**
 * Quanto a conversa pode andar com a sugestão JÁ NA TELA antes de ela sair.
 * Maior que a janela de antes de aparecer: quem lê precisa de tempo, mas um
 * cartão parado enquanto a reunião seguiu adiante deixa de ajudar.
 */
export const VALIDADE_NA_TELA_EM_FALAS = 30;
/** Enquanto a anterior sobre o mesmo ponto está viva ou recente, não repete. */
export const FALAS_PARA_REPETIR_UM_PONTO = 20;
/** Um ponto descartado só volta com tanta conversa nova. */
export const FALAS_APOS_DESCARTE = 15;
const UMA_HORA = 3_600_000;

export type MotivoDaDecisao =
  | 'ok'
  | 'nao_pendente'
  | 'modo_sob_demanda'
  | 'pausado'
  | 'obsoleta'
  | 'repetida'
  | 'recem_descartado'
  | 'ja_ha_uma_na_tela'
  | 'intervalo'
  | 'limite_por_hora';

export interface EstadoDoLaco {
  modo: ModoDeIntervencao;
  pausado: boolean;
  agora: number;
  /** Falas CONSOLIDADAS que a transcrição tem agora. */
  falasConsolidadas: number;
  /** As sugestões desta reunião (qualquer estado). */
  sugestoes: readonly Sugestao[];
}

export type Decisao =
  | { acao: 'mostrar'; motivo: 'ok' }
  | { acao: 'segurar'; motivo: MotivoDaDecisao }
  | { acao: 'descartar'; motivo: MotivoDaDecisao };

/** Chave do ponto: minúsculas, sem acento e sem pontuação. Só para comparar. */
export function chaveDoPonto(ponto: string): string {
  return ponto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function decidir(c: Sugestao, e: EstadoDoLaco): Decisao {
  if (c.estado !== 'pendente') return { acao: 'segurar', motivo: 'nao_pendente' };
  const cfg = CONFIGURACAO_DOS_MODOS[e.modo];
  if (!cfg) return { acao: 'segurar', motivo: 'modo_sob_demanda' };
  if (e.pausado) return { acao: 'segurar', motivo: 'pausado' };

  // Validade: a conversa já andou demais para isto ainda servir.
  if (e.falasConsolidadas - c.revisao > JANELA_DE_VALIDADE_EM_FALAS)
    return { acao: 'descartar', motivo: 'obsoleta' };

  const chave = chaveDoPonto(c.ponto);
  const outras = e.sugestoes.filter((s) => s.id !== c.id && chaveDoPonto(s.ponto) === chave);
  // Repetição: o mesmo ponto já foi mostrado, usado ou resolvido há pouco, ou está na tela.
  if (
    outras.some(
      (s) =>
        (s.estado === 'mostrada' ||
          ((s.estado === 'usada' || s.estado === 'resolvida') &&
            c.revisao - s.revisao < FALAS_PARA_REPETIR_UM_PONTO)),
    )
  )
    return { acao: 'descartar', motivo: 'repetida' };
  // Descartado pela pessoa: só volta com conversa nova suficiente.
  if (outras.some((s) => s.estado === 'descartada' && c.revisao - s.revisao < FALAS_APOS_DESCARTE))
    return { acao: 'descartar', motivo: 'recem_descartado' };

  // Orçamento de atenção.
  if (e.sugestoes.some((s) => s.id !== c.id && s.estado === 'mostrada'))
    return { acao: 'segurar', motivo: 'ja_ha_uma_na_tela' };
  const mostradas = e.sugestoes.filter((s) => s.mostradaEm !== undefined);
  const ultima = Math.max(0, ...mostradas.map((s) => s.mostradaEm!));
  if (ultima && e.agora - ultima < cfg.intervaloEntreSugestoesMs)
    return { acao: 'segurar', motivo: 'intervalo' };
  if (mostradas.filter((s) => e.agora - s.mostradaEm! < UMA_HORA).length >= cfg.limitePorHora)
    return { acao: 'segurar', motivo: 'limite_por_hora' };

  return { acao: 'mostrar', motivo: 'ok' };
}

export interface Plano {
  /** A única que passa a aparecer agora, se houver. */
  mostrar: Sugestao | null;
  /** Encerradas sem aparecer, com o motivo. */
  descartar: Array<{ sugestao: Sugestao; motivo: MotivoDaDecisao }>;
  /** Passaram na política mas perderam para a escolhida: só uma por vez. */
  substituir: Sugestao[];
  /** Estavam na tela e a conversa andou além da validade: saem sem esperar a pessoa. */
  expirarNaTela: Sugestao[];
}

/**
 * O que fazer com as pendentes desta reunião. Das que passam, aparece UMA: a
 * que serve ao objetivo, depois a mais nova (a conversa mais atual), depois a
 * mais bem sustentada. As outras que passaram caducam como substituídas — com
 * a conversa andando, a mais nova a vence.
 */
export function planejar(e: EstadoDoLaco): Plano {
  const plano: Plano = { mostrar: null, descartar: [], substituir: [], expirarNaTela: [] };
  // O que está na tela vence quando a conversa já foi longe demais.
  plano.expirarNaTela = e.sugestoes.filter(
    (s) => s.estado === 'mostrada' && e.falasConsolidadas - s.revisao > VALIDADE_NA_TELA_EM_FALAS,
  );
  const naTelaQueFica = e.sugestoes.map((s) => (plano.expirarNaTela.includes(s) ? { ...s, estado: 'expirada' as const } : s));
  const pendentes = naTelaQueFica.filter((s) => s.estado === 'pendente');
  const aptas: Sugestao[] = [];
  // A que sai da tela já não ocupa o lugar: as pendentes são decididas sem ela.
  const sem = { ...e, sugestoes: naTelaQueFica };
  for (const s of pendentes) {
    const d = decidir(s, sem);
    if (d.acao === 'descartar') plano.descartar.push({ sugestao: s, motivo: d.motivo });
    else if (d.acao === 'mostrar') aptas.push(s);
  }
  if (!aptas.length) return plano;
  aptas.sort(
    (a, b) =>
      Number(b.doObjetivo === true) - Number(a.doObjetivo === true) ||
      b.revisao - a.revisao ||
      b.evidencias.length - a.evidencias.length ||
      b.criadoEm - a.criadoEm,
  );
  plano.mostrar = aptas[0]!;
  plano.substituir = aptas.slice(1);
  return plano;
}

/** Vale chamar o modelo agora? É o orçamento de custo e de latência. */
export function podeAvaliar(p: {
  modo: ModoDeIntervencao;
  pausado: boolean;
  agora: number;
  falasConsolidadas: number;
  ultimaAvaliacao: { em: number; falas: number } | null;
}): boolean {
  const cfg = CONFIGURACAO_DOS_MODOS[p.modo];
  if (!cfg || p.pausado) return false;
  if (p.falasConsolidadas <= 0) return false;
  if (!p.ultimaAvaliacao) return true;
  return (
    p.agora - p.ultimaAvaliacao.em >= cfg.intervaloEntreAvaliacoesMs &&
    p.falasConsolidadas - p.ultimaAvaliacao.falas >= cfg.falasNovasParaAvaliar
  );
}

/** As abertas (pendentes ou na tela) da reunião. */
export const abertasDaReuniao = (sugestoes: readonly Sugestao[], reuniaoId: string): Sugestao[] =>
  sugestoes.filter((s) => s.reuniaoId === reuniaoId && estaAberta(s));
