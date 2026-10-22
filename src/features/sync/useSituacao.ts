/**
 * A situação da sincronização e a cota, vivas: relidas a cada passada que o
 * background grava (`sincronizacao.ts` escreve `syncEstado` ao terminar).
 */
import { useEffect, useState } from 'react';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange, readLocal } from '@/shared/services/storage';
import { resumoDaCota, situacaoDoSync, type ResumoDaCota, type SituacaoDoSync } from './sincronizacao';

export function useSituacaoDoSync(): { situacao: SituacaoDoSync; cota: ResumoDaCota | null } {
  const [bruto, setBruto] = useState<unknown>(null);
  useEffect(() => {
    let vivo = true;
    void readLocal<unknown>(STORAGE_KEYS.syncEstado).then((e) => vivo && setBruto(e));
    const parar = onLocalChange<unknown>(STORAGE_KEYS.syncEstado, (e) => vivo && setBruto(e));
    return () => {
      vivo = false;
      parar();
    };
  }, []);
  return { situacao: situacaoDoSync(bruto), cota: resumoDaCota(bruto) };
}
