/**
 * O aviso no chat do Meet: "Estou usando o TaqCiti para transcrever esta
 * reunião."
 *
 * ── Por que a janela é DERIVADA, e não um cronômetro ──────────────────────
 *
 * O requisito é explícito: reabrir a sidebar ou a página re-renderizar não pode
 * reiniciar a contagem. Um `setTimeout` de 60s iniciado quando a tela monta faz
 * exatamente o contrário — cada montagem ganharia um minuto novo, e o atalho
 * "temporário" reapareceria a tarde inteira.
 *
 * Aqui não existe cronômetro de vida própria: a janela é uma CONTA sobre
 * `session.startedAt`, que já é persistido pela máquina de estados e sobrevive
 * ao service worker dormir, à aba recarregar e à sidebar fechar. Quem monta
 * depois do minuto simplesmente calcula que já passou.
 *
 * ── Por que a decisão é gravada ───────────────────────────────────────────
 *
 * "Após envio bem-sucedido, impedir duplicação." Em memória isso duraria até a
 * sidebar fechar. Gravado por reunião, o aviso é enviado uma vez e pronto — e a
 * interface tem como mostrar a confirmação em vez de oferecer o botão de novo.
 *
 * O texto é fixo e está aqui, num lugar só: ele vai para PESSOAS, no chat de
 * uma reunião, e não pode divergir entre a tela que o anuncia e o código que o
 * envia.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { mapaGuardado } from './store';

export const TEXTO_DO_AVISO =
  'Estou usando o TaqCiti para transcrever esta reunião.';

/** A janela em que o atalho existe, a partir do início efetivo da reunião. */
export const JANELA_MS = 60_000;

export interface AvisoEnviado {
  meetingId: string;
  at: number;
}

function ehAviso(v: unknown): v is AvisoEnviado {
  if (!v || typeof v !== 'object') return false;
  const a = v as Partial<AvisoEnviado>;
  return typeof a.meetingId === 'string' && typeof a.at === 'number';
}

const mapa = mapaGuardado<AvisoEnviado>(STORAGE_KEYS.chatNotice, ehAviso);

export const observarAvisos = mapa.observar;

export async function registrarAvisoEnviado(meetingId: string): Promise<void> {
  await mapa.atualizar(meetingId, (atual) => atual ?? { meetingId, at: Date.now() });
}

/**
 * O estado do atalho, num instante.
 *
 * Puro: recebe tudo de que precisa e não olha relógio nem storage por conta
 * própria. É o que permite testar os quatro casos sem esperar um minuto.
 *
 *   'oferecer'  — dentro da janela, capturando, ainda não enviado
 *   'enviado'   — já foi; mostra confirmação, nunca o botão
 *   'fora'      — a janela passou (ou a captura começou depois dela)
 *   'inativo'   — não há captura acontecendo; o aviso não faz sentido
 */
export type EstadoDoAviso = 'oferecer' | 'enviado' | 'fora' | 'inativo';

export function estadoDoAviso({
  capturando,
  inicioDaReuniao,
  jaEnviado,
  agora,
}: {
  /** A captura está de fato rodando agora. */
  capturando: boolean;
  /** `session.startedAt`, o início efetivo. */
  inicioDaReuniao: number | null;
  jaEnviado: boolean;
  agora: number;
}): EstadoDoAviso {
  if (jaEnviado) return 'enviado';
  if (!capturando || inicioDaReuniao === null) return 'inativo';
  // "Se iniciar depois dessa janela, não exibir o atalho temporário": a conta é
  // sempre contra o início da reunião, nunca contra o início da captura.
  return agora - inicioDaReuniao <= JANELA_MS ? 'oferecer' : 'fora';
}

/** Quanto falta da janela, em segundos, para a interface poder dizê-lo. */
export function segundosRestantes(inicioDaReuniao: number, agora: number): number {
  return Math.max(0, Math.ceil((inicioDaReuniao + JANELA_MS - agora) / 1000));
}
