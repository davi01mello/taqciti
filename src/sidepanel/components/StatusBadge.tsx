/** Badge de status de um registro do histórico — com ponto vivo se estiver gravando. */
import type { HistoryStatus } from '@/shared/types/domain';
import { Badge } from '@/shared/ui/Badge';

export function StatusBadge({ status }: { status: HistoryStatus }) {
  switch (status) {
    case 'recording':
      return (
        <Badge tone="warning">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse-dot" />
          Gravando
        </Badge>
      );
    case 'ready':
      return <Badge tone="neutral">Guardada</Badge>;
  }
}
