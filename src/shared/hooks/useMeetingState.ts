/**
 * Fonte única de estado da reunião para as UIs.
 *
 * O passo duplo que morava aqui — pede o estado atual, e separadamente assina
 * os broadcasts — desceu para a camada de plataforma, porque a forma de
 * resolver a corrida entre os dois é diferente em cada mundo (`chrome.runtime`
 * responde na mesma máquina; a ponte responde por um socket). Aqui sobrou o
 * que é de fato do React: guardar o último valor.
 */
import { useEffect, useState } from 'react';
import type { MeetingState } from '@/shared/types/domain';
import { IDLE_STATE } from '@/shared/types/domain';
import { usePlatform } from '@/shared/platform/context';

export function useMeetingState(): MeetingState {
  const platform = usePlatform();
  const [state, setState] = useState<MeetingState>(IDLE_STATE);

  useEffect(() => platform.subscribeMeeting(setState), [platform]);

  return state;
}
