/**
 * O apoio à condução, como a sidebar o usa: liga o laço à reunião aberta e
 * entrega à tela só o que ela precisa mostrar.
 *
 * O laço roda enquanto a sidebar está aberta (é onde a pessoa vê a sugestão) e
 * para quando ela fecha ou a reunião muda. Sem o assistente conectado, nada é
 * chamado: o laço só encerra o que ficou aberto quando a reunião acaba.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { observarConducao, type Conducao } from '@/features/conducao/store';
import { perfilQueValeParaAReuniao } from '@/features/conducao/contexto';
import { criarAdaptadorHttp } from '@/features/taq/modelo';
import type { MeetingState } from '@/shared/types/domain';
import { criarLaco, type Laco } from './laco';
import { observarApoio, type Apoio, type Sugestao } from './store';

/** De quanto em quanto tempo a política é reavaliada só pela passagem do tempo. */
const PASSO_DO_RELOGIO_MS = 15_000;

export interface ApoioAoVivo {
  /** A única sugestão na tela, se houver. */
  naTela: Sugestao | null;
  guardadas: Sugestao[];
  pausado: boolean;
  /** O modo da pessoa para esta reunião; `null` = sem perfil (o apoio está desligado). */
  modo: 'sob_demanda' | 'discreto' | 'participativo' | null;
}

const VAZIO_DO_APOIO: Apoio = { versao: 1, sugestoes: [], feedback: [], pausadas: {}, medicoes: {} };
const VAZIA_A_CONDUCAO: Conducao = { versao: 1, perfil: null, briefings: [] };

export function useApoioAoVivo(state: MeetingState, taqPronto: boolean): ApoioAoVivo {
  const sessao = state.session;
  const fase = state.phase;
  const meetingId = sessao?.meetingId ?? null;
  const [apoio, setApoio] = useState<Apoio>(VAZIO_DO_APOIO);
  const [conducao, setConducao] = useState<Conducao>(VAZIA_A_CONDUCAO);
  const laco = useRef<Laco | null>(null);

  useEffect(() => observarApoio(setApoio), []);
  useEffect(() => observarConducao(setConducao), []);

  useEffect(() => {
    laco.current = criarLaco({ adaptador: criarAdaptadorHttp() });
    return () => {
      laco.current?.parar();
      laco.current = null;
    };
  }, []);

  const total = sessao?.segments.length ?? 0;
  const modoDaReuniao = meetingId ? (perfilQueValeParaAReuniao(conducao, meetingId)?.intervencao.modo ?? null) : null;
  const pausado = meetingId ? apoio.pausadas[meetingId] === true : false;

  // A reunião mudou (uma fala, o perfil, a pausa, o fim): uma passada. `sessao` muda a
  // cada fala; só o que decide se há trabalho novo entra aqui.
  useEffect(() => {
    if (!sessao || !laco.current) return;
    if (fase !== 'recording' && fase !== 'paused' && fase !== 'ended') return;
    const encerrada = fase === 'ended';
    // Sem assistente conectado só o encerramento passa (para não deixar cartão pendurado).
    if (!taqPronto && !encerrada) return;
    void laco.current.aoMudar({
      reuniao: { id: sessao.meetingId, titulo: sessao.title },
      falas: sessao.segments,
      encerrada,
      gravando: fase === 'recording',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, total, fase, taqPronto, modoDaReuniao, pausado]);

  // O tempo passa mesmo sem fala nova: o intervalo mínimo pode ter acabado.
  useEffect(() => {
    if (!taqPronto || fase !== 'recording') return;
    const t = setInterval(() => void laco.current?.cutucar(), PASSO_DO_RELOGIO_MS);
    return () => clearInterval(t);
  }, [taqPronto, fase]);

  return useMemo(() => {
    const doMeeting = meetingId ? apoio.sugestoes.filter((s) => s.reuniaoId === meetingId) : [];
    return {
      naTela: doMeeting.find((s) => s.estado === 'mostrada') ?? null,
      guardadas: doMeeting.filter((s) => s.estado === 'guardada'),
      pausado,
      modo: modoDaReuniao,
    };
  }, [apoio, meetingId, pausado, modoDaReuniao]);
}
