/**
 * Fonte única de estado para as UIs: pede o estado atual ao background na
 * montagem e assina os broadcasts `state/updated`.
 */
import { useEffect, useState } from 'react';
import type { MeetingState } from '@/shared/types/domain';
import { IDLE_STATE } from '@/shared/types/domain';
import { onMessage, sendMessage } from '@/shared/services/messaging';
import { meetingStateSchema } from '@/shared/types/messages';

export function useMeetingState(): MeetingState {
  const [state, setState] = useState<MeetingState>(IDLE_STATE);

  useEffect(() => {
    let mounted = true;

    void sendMessage<MeetingState>({ type: 'ui/getState' }).then((raw) => {
      const parsed = meetingStateSchema.safeParse(raw);
      if (mounted && parsed.success) setState(parsed.data as MeetingState);
    });

    const unsubscribe = onMessage((message) => {
      if (message.type === 'state/updated') {
        setState(message.state as MeetingState);
      }
      return undefined;
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return state;
}
