/**
 * Mantém os avisos da reunião em dia enquanto a sidebar está aberta:
 *
 *   1. a extração incremental de compromissos da legenda consolidada (local,
 *      limitada por frequência, idempotente);
 *   2. a reconciliação dos avisos do acompanhamento com os registros;
 *   3. o aviso de captura interrompida, enquanto ela estiver interrompida.
 *
 * Nada disso abre popup nem pede foco: só grava. A tela mostra o indicador.
 */
import { useEffect, useRef } from 'react';
import type { MeetingState } from '@/shared/types/domain';
import { criarExtratorIncremental, type ExtratorIncremental } from '@/features/trabalho/extracao';
import { lerTrabalho } from '@/features/trabalho/store';
import { useTrabalho } from '@/features/trabalho/useTrabalho';
import { sincronizarAvisoDeCaptura, sincronizarAvisosDoAcompanhamento } from './produtores';

export function useAvisosDaReuniao(state: MeetingState): void {
  const { trabalho, carregado } = useTrabalho();
  const extrator = useRef<ExtratorIncremental | null>(null);

  const sessao = state.session;
  const fase = state.phase;
  const meetingId = sessao?.meetingId ?? null;

  useEffect(() => {
    extrator.current = criarExtratorIncremental({
      aoCriar: () => {
        void lerTrabalho()
          .then((t) => sincronizarAvisosDoAcompanhamento(t))
          .catch(() => undefined);
      },
    });
    return () => {
      extrator.current?.parar();
      extrator.current = null;
    };
  }, []);

  const total = sessao?.segments.length ?? 0;
  useEffect(() => {
    if (!sessao || (fase !== 'recording' && fase !== 'paused' && fase !== 'ended')) return;
    extrator.current?.aoMudar({
      reuniaoId: sessao.meetingId,
      titulo: sessao.title,
      inicio: sessao.startedAt,
      segmentos: sessao.segments,
      participantes: sessao.participants,
      encerrada: fase === 'ended',
      versao: `${sessao.endedAt ?? sessao.startedAt}:${sessao.segments.length}`,
    });
    // `sessao` muda a cada fala; só o que decide se há trabalho novo entra aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, total, fase]);

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
