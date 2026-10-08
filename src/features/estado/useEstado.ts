/**
 * O estado dos pontos como a sidebar o usa: o que está guardado para a reunião
 * aberta, e o gesto de atualizar (a pedido da pessoa).
 *
 * Atualizar custa uma chamada ao modelo, então é sempre uma ação explícita: o
 * hook não roda sozinho.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { lerConducao } from '@/features/conducao/store';
import { carregarRetomada } from '@/features/conducao/retomada';
import { criarAdaptadorHttp } from '@/features/taq/modelo';
import type { MeetingState } from '@/shared/types/domain';
import { falasConsolidadas } from '@/features/apoio/laco';
import { atualizarEstadoDaReuniao } from './atualizar';
import { observarEstados, type Snapshot } from './store';

export interface EstadoDaReuniao {
  snapshot: Snapshot | null;
  atualizando: boolean;
  /** A última tentativa falhou: a mensagem para a pessoa. O que estava guardado continua. */
  erro: string | null;
  /** Quantas falas foram lidas na última atualização. */
  lidoAte: number | null;
  atualizar: () => Promise<void>;
}

export function useEstadoDosPontos(state: MeetingState): EstadoDaReuniao {
  const sessao = state.session;
  const meetingId = sessao?.meetingId ?? null;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const adaptador = useRef(criarAdaptadorHttp());
  /** Sempre a sessão mais recente, sem recriar o callback a cada fala. */
  const ultima = useRef(state);
  ultima.current = state;

  useEffect(
    () => observarEstados((m) => setSnapshot(meetingId ? (m[meetingId] ?? null) : null)),
    [meetingId],
  );

  const atualizar = useCallback(async () => {
    const s = ultima.current.session;
    if (!s || atualizando) return;
    setAtualizando(true);
    setErro(null);
    try {
      const conducao = await lerConducao();
      const r = await atualizarEstadoDaReuniao({
        adaptador: adaptador.current,
        reuniao: { id: s.meetingId, titulo: s.title },
        falas: s.segments,
        falasConsolidadas: falasConsolidadas(s.segments.length, ultima.current.phase === 'ended'),
        conducao,
        retomada: await carregarRetomada(conducao, s.meetingId),
      });
      if (r.tipo === 'erro') setErro(r.mensagem);
    } catch (e) {
      setErro((e as Error)?.message ?? 'Não foi possível atualizar.');
    } finally {
      setAtualizando(false);
    }
  }, [atualizando]);

  return { snapshot, atualizando, erro, lidoAte: snapshot?.revisao ?? null, atualizar };
}
