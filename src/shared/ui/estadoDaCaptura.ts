/**
 * O estado da captura, derivado UMA vez para todas as superfícies.
 *
 * A cápsula (na página do Meet), a sidebar e a HOME liam `phase` e
 * `captureHealthy` cada uma do seu jeito — e por isso podiam discordar. Aqui
 * está a única tradução do estado da reunião para o que se mostra.
 *
 * Nada aqui inventa um sinal: usa só `phase`, `captureHealthy`, `startedAt`,
 * `lastChunkAt` e os segmentos, que o background já mantém.
 *
 * "Aguardando fonte" é a captura ligada sem nada chegando: pode ser silêncio ou
 * legenda desligada, e o rótulo não afirma qual — o monitor do Taq
 * (`features/taq/captura.ts`) usa os mesmos limites para dizer o mesmo.
 */
import type { MeetingPhase, MeetingState } from '@/shared/types/domain';
import type { EstadoDaCaptura } from './MarcaDaEscuta';

/** Janela em que "ainda nenhum trecho" é só o começo. */
export const INICIANDO_MS = 20_000;
/** Sem trecho há este tempo, com a captura de pé: aguardando a fonte. */
export const SEM_TRECHO_MS = 2 * 60_000;
/** Leitura impossível por este tempo, sem trecho: deixa de ser "religando" e é erro. */
export const ERRO_APOS_MS = 45_000;

/** Os únicos sinais de que a derivação precisa; a cápsula só tem estes. */
export interface SinaisDaCaptura {
  phase: MeetingPhase;
  /** `false` = há legenda na tela que a captura não está conseguindo ler. */
  captureHealthy?: boolean;
  startedAt: number | null;
  lastChunkAt?: number | null;
  falas: number;
}

export function sinaisDoEstado(state: MeetingState): SinaisDaCaptura {
  const s = state.session;
  return {
    phase: state.phase,
    captureHealthy: s?.captureHealthy,
    startedAt: s?.startedAt ?? null,
    lastChunkAt: s?.lastChunkAt ?? null,
    falas: s?.segments.length ?? 0,
  };
}

export function derivarEstadoDaCaptura(
  entrada: MeetingState | SinaisDaCaptura,
  agora: number = Date.now(),
): EstadoDaCaptura {
  const s = 'falas' in entrada ? entrada : sinaisDoEstado(entrada);
  switch (s.phase) {
    case 'captionsRequired':
      return 'preparando';
    case 'paused':
      return 'pausada';
    case 'ended':
      // Sem nenhuma fala não há transcrição salva: dizer "Salva" seria falso.
      return s.falas > 0 ? 'salva' : 'desligada';
    case 'recording': {
      if (s.startedAt === null) return 'desligada';
      const ultimo = s.lastChunkAt ?? null;
      const desdeUltimo = agora - (ultimo ?? s.startedAt);
      if (s.captureHealthy === false) {
        // Recém-interrompida a leitura religa sozinha; muito tempo sem nada
        // chegar é erro, e a pessoa precisa saber.
        return desdeUltimo > ERRO_APOS_MS ? 'erro' : 'interrompida';
      }
      if (ultimo === null && s.falas === 0) {
        return agora - s.startedAt < INICIANDO_MS ? 'iniciando' : 'aguardando_fonte';
      }
      if (desdeUltimo > SEM_TRECHO_MS) return 'aguardando_fonte';
      return 'capturando';
    }
    default:
      // Sem reunião e "agora não" são o mesmo fato para a captura: desligada.
      return 'desligada';
  }
}
/** O que cada estado diz, por extenso — o texto de leitor de tela e de tooltip. */
export const LEITURA_DO_ESTADO: Record<EstadoDaCaptura, string> = {
  capturando: 'Gravando: capturando as legendas agora',
  preparando: 'Preparando a captura: ligando as legendas do Meet',
  iniciando: 'Iniciando a captura',
  aguardando_fonte: 'Aguardando legendas: nenhuma fala chegou ainda (pode ser silêncio)',
  pausada: 'Captura pausada',
  interrompida: 'Captura interrompida: religando a leitura das legendas',
  erro: 'Erro na captura: as legendas não estão sendo lidas',
  salva: 'Transcrição salva',
  desligada: 'Captura desligada',
};
