/**
 * Os avisos e o organizador, para as telas.
 *
 * ── Quem é o organizador ────────────────────────────────────────────────────
 *
 * O Meet, para este produto, só entrega UMA marca: o tile da própria pessoa
 * (`data-self-name`) vira `isHost: true`. Não há campo "quem convocou a
 * reunião". Então:
 *
 *   - `true`  — algum participante tem `isHost === true`: o mecanismo real do
 *               projeto reconhece a pessoa como anfitriã;
 *   - `false` — a lista de participantes existe e ninguém é anfitrião;
 *   - `null`  — não há participantes lidos, ou nenhum tem a marca definida:
 *               desconhecido, e desconhecido NÃO é "sim".
 *
 * Os avisos que são só do organizador ficam escondidos enquanto for `false` ou
 * `null`; os de `publico: 'todos'` (captura caiu, documento pronto) aparecem
 * sempre.
 */
import { useEffect, useMemo, useState } from 'react';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange, readLocal } from '@/shared/services/storage';
import type { MeetingRecord, Participant } from '@/shared/types/domain';
import { avisosVisiveis, naoLidos, observarAvisos, type Aviso } from './store';

export function souOrganizador(
  participantes: readonly Pick<Participant, 'isHost'>[] | null | undefined,
): boolean | null {
  if (!participantes?.length) return null;
  if (participantes.some((p) => p.isHost === true)) return true;
  return participantes.every((p) => p.isHost === false) ? false : null;
}

export function useAvisos(): { avisos: Aviso[]; carregado: boolean } {
  const [estado, setEstado] = useState<{ avisos: Aviso[]; carregado: boolean }>({
    avisos: [],
    carregado: false,
  });
  useEffect(() => observarAvisos((avisos) => setEstado({ avisos, carregado: true })), []);
  return estado;
}

/**
 * Na HOME não há uma reunião em andamento: os itens do organizador aparecem
 * para as reuniões guardadas em que o mecanismo real reconheceu a pessoa como
 * anfitriã (`souOrganizador` verdadeiro sobre os participantes gravados).
 */
export function useAvisosDaHome() {
  const { avisos, carregado } = useAvisos();
  const [organizadas, setOrganizadas] = useState<Set<string>>(new Set());
  useEffect(() => {
    let vivo = true;
    const montar = (bruto: unknown) => {
      const lista = Array.isArray(bruto) ? (bruto as MeetingRecord[]) : [];
      if (vivo)
        setOrganizadas(
          new Set(
            lista
              .filter((r) => r && typeof r.id === 'string' && souOrganizador(r.participants) === true)
              .map((r) => r.id),
          ),
        );
    };
    void readLocal<unknown>(STORAGE_KEYS.history).then(montar).catch(() => undefined);
    const parar = onLocalChange<unknown>(STORAGE_KEYS.history, montar);
    return () => {
      vivo = false;
      parar();
    };
  }, []);
  return useMemo(() => {
    const permitidos = avisos.filter(
      (a) => a.publico === 'todos' || (!!a.reuniaoId && organizadas.has(a.reuniaoId)),
    );
    const visiveis = avisosVisiveis(permitidos, { souOrganizador: true });
    const historico = permitidos
      .filter((a) => a.resolvido || a.dispensado)
      .sort((a, b) => b.atualizadoEm - a.atualizadoEm)
      .slice(0, 30);
    return { visiveis, historico, novos: naoLidos(visiveis), carregado };
  }, [avisos, organizadas, carregado]);
}

/** Os avisos que esta pessoa vê, o histórico (resolvidos e dispensados) e o que é novo. */
export function useAvisosVisiveis(filtro: { reuniaoId?: string; souOrganizador: boolean | null }) {
  const { avisos, carregado } = useAvisos();
  const { reuniaoId, souOrganizador: eu } = filtro;
  return useMemo(() => {
    const f = { ...(reuniaoId ? { reuniaoId } : {}), souOrganizador: eu };
    const visiveis = avisosVisiveis(avisos, f);
    const historico = avisos
      .filter((a) => a.resolvido || a.dispensado)
      .filter((a) => (reuniaoId ? a.reuniaoId === reuniaoId : true))
      .sort((a, b) => b.atualizadoEm - a.atualizadoEm)
      .slice(0, 30);
    return { visiveis, historico, novos: naoLidos(visiveis), carregado };
  }, [avisos, reuniaoId, eu, carregado]);
}
