/**
 * O estado dos pontos como a sidebar o usa: o que está guardado para a reunião
 * aberta, e o gesto de atualizar (a pedido da pessoa).
 *
 * Atualizar custa uma chamada ao modelo, então é uma ação explícita da pessoa.
 * A única exceção é a leitura ao encerrar, que ela mesma liga no perfil.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { perfilQueValeParaAReuniao } from '@/features/conducao/contexto';
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

export function useEstadoDosPontos(state: MeetingState, taqPronto = false): EstadoDaReuniao {
  const sessao = state.session;
  const meetingId = sessao?.meetingId ?? null;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const adaptador = useRef(criarAdaptadorHttp());
  /** Sempre a sessão mais recente, sem recriar o callback a cada fala. */
  const ultima = useRef(state);
  ultima.current = state;
  const snapshotAtual = useRef<Snapshot | null>(null);
  snapshotAtual.current = snapshot;

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

  // Leitura ao encerrar: só para quem pediu no perfil, uma vez por reunião. O
  // resultado fica no cartão para revisão; nada é registrado sozinho.
  const encerrada = state.phase === 'ended';
  const jaLeu = useRef<string | null>(null);
  useEffect(() => {
    if (!encerrada || !taqPronto || !meetingId || jaLeu.current === meetingId) return;
    jaLeu.current = meetingId;
    void (async () => {
      const conducao = await lerConducao();
      if (!perfilQueValeParaAReuniao(conducao, meetingId)?.lerAoEncerrar) return;
      const total = ultima.current.session?.segments.length ?? 0;
      if (total === 0 || (snapshotAtual.current?.revisao ?? 0) >= total) return;
      await atualizar();
    })();
  }, [encerrada, taqPronto, meetingId, atualizar]);

  return { snapshot, atualizando, erro, lidoAte: snapshot?.revisao ?? null, atualizar };
}
