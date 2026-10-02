/**
 * O MONITOR DE CAPTURA — quanto dá para confiar numa transcrição, dito por
 * sinais que o código consegue verificar.
 *
 * Serviço determinístico: compara relógios e lê os contadores que a captura já
 * mantém (`metadata`, e o estado vivo do background quando a reunião está em
 * curso). Não chama modelo e não interpreta conteúdo.
 *
 * ── O que ele NÃO afirma ─────────────────────────────────────────────────────
 *
 *   - Silêncio não é falha. Um intervalo sem fala transcrita aparece como
 *     "intervalo sem fala transcrita (pode ser silêncio)", nunca como perda.
 *   - Verde não é "tudo capturado". O melhor resultado possível é "nenhum
 *     problema detectado" — a legenda do Meet pode ter errado palavras que
 *     nenhum contador vê.
 *   - Lacuna sem instante conhecido não ganha instante inventado: os
 *     intervalos vêm dos tempos dos próprios segmentos.
 */
import type { MeetingRecord, MeetingState } from '@/shared/types/domain';

/** Intervalo entre falas a partir do qual vale mencionar. */
export const INTERVALO_NOTAVEL_MS = 3 * 60_000;
/** Sem trecho novo há este tempo, com a reunião em curso: aguardando legendas. */
export const SEM_TRECHO_MS = 2 * 60_000;

export type SituacaoDaCaptura =
  | 'capturando'
  | 'pausada'
  | 'aguardando_legendas'
  | 'problema_na_captura'
  | 'encerrada'
  | 'desconhecida';

export interface AvaliacaoDaCaptura {
  situacao: SituacaoDaCaptura;
  avaliacao: 'sem_problemas_detectados' | 'com_ressalvas' | 'problemas_detectados';
  /** Sinais verificáveis, em frases. */
  sinais: string[];
  /** Intervalos sem fala transcrita, pelos tempos dos segmentos. */
  intervalos: Array<{ deMs: number; ateMs: number }>;
  ultimaAtualizacao?: number;
  segmentos: number;
}

function minutos(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m <= 1 ? '1 min' : `${m} min`;
}

export function avaliarCaptura(
  r: MeetingRecord,
  vivo: MeetingState | null,
  agora: number = Date.now(),
): AvaliacaoDaCaptura {
  const sinais: string[] = [];
  let problemas = 0;
  let ressalvas = 0;
  const md = r.metadata ?? {
    capturedCaptions: true,
    droppedSegments: 0,
    reconnectCount: 0,
    wasDiscardedAndRestarted: false,
  };

  // O estado vivo só vale se for DESTA reunião.
  const sessao = vivo?.session && vivo.session.meetingId === r.id ? vivo.session : null;
  const ultimo = sessao?.lastChunkAt ?? md.lastChunkAt ?? undefined;

  let situacao: SituacaoDaCaptura;
  if (r.status !== 'recording') situacao = 'encerrada';
  else if (!sessao) situacao = 'desconhecida';
  else if (vivo!.phase === 'paused') situacao = 'pausada';
  else if (sessao.captureHealthy === false) situacao = 'problema_na_captura';
  else if (vivo!.phase === 'captionsRequired' || !ultimo || agora - ultimo > SEM_TRECHO_MS)
    situacao = 'aguardando_legendas';
  else situacao = 'capturando';

  if (situacao === 'desconhecida')
    sinais.push('A reunião consta em andamento, mas o estado vivo da captura não está acessível daqui.');
  if (situacao === 'problema_na_captura') {
    problemas += 1;
    sinais.push('Há legenda na tela que a captura não está conseguindo ler agora.');
  }
  if (situacao === 'aguardando_legendas' && ultimo)
    sinais.push(`Nenhum trecho novo há ${minutos(agora - ultimo)} — pode ser silêncio ou legenda desligada.`);
  if (!md.capturedCaptions) {
    problemas += 1;
    sinais.push('A captura não registrou legendas nesta reunião.');
  }
  if (md.droppedSegments > 0) {
    problemas += 1;
    sinais.push(`${md.droppedSegments} trecho(s) descartado(s) pela captura.`);
  }
  if ((md.captureDegradedCount ?? 0) > 0) {
    ressalvas += 1;
    sinais.push(`A leitura das legendas entrou em modo degradado ${md.captureDegradedCount} vez(es).`);
  }
  if (md.reconnectCount > 0) {
    ressalvas += 1;
    sinais.push(`A captura reconectou ${md.reconnectCount} vez(es); falas durante a reconexão podem faltar.`);
  }
  if (md.wasDiscardedAndRestarted) {
    ressalvas += 1;
    sinais.push('A captura foi descartada e reiniciada durante a reunião.');
  }

  const intervalos: Array<{ deMs: number; ateMs: number }> = [];
  for (let i = 1; i < r.segments.length; i += 1) {
    const antes = r.segments[i - 1]!;
    const depois = r.segments[i]!;
    const de = Math.max(antes.endOffsetMs, antes.startOffsetMs);
    if (depois.startOffsetMs - de >= INTERVALO_NOTAVEL_MS)
      intervalos.push({ deMs: Math.round(de), ateMs: Math.round(depois.startOffsetMs) });
  }
  if (intervalos.length)
    sinais.push(
      `${intervalos.length} intervalo(s) de 3 min ou mais sem fala transcrita — pode ser silêncio, não é necessariamente perda.`,
    );
  if (!r.segments.length) {
    ressalvas += 1;
    sinais.push('Nenhuma fala foi transcrita.');
  }

  return {
    situacao,
    avaliacao: problemas ? 'problemas_detectados' : ressalvas ? 'com_ressalvas' : 'sem_problemas_detectados',
    sinais,
    intervalos,
    ...(ultimo ? { ultimaAtualizacao: ultimo } : {}),
    segmentos: r.segments.length,
  };
}

export const ROTULO_DA_SITUACAO: Record<SituacaoDaCaptura, string> = {
  capturando: 'Capturando',
  pausada: 'Pausada',
  aguardando_legendas: 'Aguardando legendas',
  problema_na_captura: 'Problema na captura',
  encerrada: 'Encerrada',
  desconhecida: 'Estado desconhecido',
};

export const ROTULO_DA_AVALIACAO: Record<AvaliacaoDaCaptura['avaliacao'], string> = {
  sem_problemas_detectados: 'Nenhum problema detectado',
  com_ressalvas: 'Com ressalvas',
  problemas_detectados: 'Problemas detectados',
};
