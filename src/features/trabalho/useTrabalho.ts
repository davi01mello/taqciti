/**
 * Os registros de trabalho e as reuniões guardadas, para as telas.
 *
 * Os cartões do Taq mostram compromissos, decisões e achados no estado de
 * AGORA, e não no da resposta: observam o storage, então concluir um
 * compromisso noutra aba aparece aqui, e uma reunião apagada faz a fonte virar
 * "origem indisponível" sem recarregar.
 */
import { useEffect, useState } from 'react';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange, readLocal } from '@/shared/services/storage';
import type { MeetingRecord } from '@/shared/types/domain';
import { observarTrabalho, TRABALHO_VAZIO, type Trabalho } from './store';

export function useTrabalho(): { trabalho: Trabalho; carregado: boolean } {
  const [estado, setEstado] = useState<{ trabalho: Trabalho; carregado: boolean }>({
    trabalho: TRABALHO_VAZIO,
    carregado: false,
  });
  useEffect(() => observarTrabalho((trabalho) => setEstado({ trabalho, carregado: true })), []);
  return estado;
}

/** Id → versão (`<fim>:<segmentos>`) das reuniões guardadas. */
export function useVersoesDasReunioes(): Map<string, { versao: string; titulo: string }> | null {
  const [mapa, setMapa] = useState<Map<string, { versao: string; titulo: string }> | null>(null);
  useEffect(() => {
    let vivo = true;
    const montar = (bruto: unknown) => {
      const lista = Array.isArray(bruto) ? (bruto as MeetingRecord[]) : [];
      setMapa(
        new Map(
          lista
            .filter((r) => r && typeof r.id === 'string' && Array.isArray(r.segments))
            .map((r) => [r.id, { versao: `${r.endedAt}:${r.segments.length}`, titulo: r.title }]),
        ),
      );
    };
    void readLocal<unknown>(STORAGE_KEYS.history)
      .then((b) => vivo && montar(b))
      .catch(() => vivo && setMapa(new Map()));
    const parar = onLocalChange<unknown>(STORAGE_KEYS.history, (b) => vivo && montar(b));
    return () => {
      vivo = false;
      parar();
    };
  }, []);
  return mapa;
}
