/**
 * Mantém os avisos da reunião em dia enquanto a sidebar está aberta:
 *
 *   1. a reconciliação dos avisos do acompanhamento com os registros;
 *   2. o aviso de captura interrompida, enquanto ela estiver interrompida.
 *
 * Quem decide o que é compromisso é o agente (`commitments`), não regra de
 * texto: nada é extraído da legenda aqui.
 *
 * Nada disso abre popup nem pede foco: só grava. A tela mostra o indicador.
 */
import { useEffect } from 'react';
import type { MeetingState } from '@/shared/types/domain';
import { useTrabalho } from '@/features/trabalho/useTrabalho';
import { sincronizarAvisoDeCaptura, sincronizarAvisosDoAcompanhamento } from './produtores';

export function useAvisosDaReuniao(state: MeetingState): void {
  const { trabalho, carregado } = useTrabalho();

  const sessao = state.session;
  const fase = state.phase;
  const meetingId = sessao?.meetingId ?? null;

  useEffect(() => {
    if (carregado) void sincronizarAvisosDoAcompanhamento(trabalho).catch(() => undefined);
  }, [trabalho, carregado]);

  const saudavel = sessao?.captureHealthy;
  useEffect(() => {
    if (!sessao) return;
    void sincronizarAvisoDeCaptura(
      { meetingId: sessao.meetingId, title: sessao.title, captureHealthy: saudavel },
      fase,
    ).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, saudavel, fase]);
}
