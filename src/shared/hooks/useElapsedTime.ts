/** Relógio de duração: recalcula a cada segundo a partir de um epoch inicial. */
import { useEffect, useState } from 'react';

export function useElapsedTime(startedAt: number | null): number {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (startedAt === null) return;
    const update = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return startedAt === null ? 0 : elapsedMs;
}
