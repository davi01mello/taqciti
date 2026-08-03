/** Badge de status de um registro do histórico — com ponto vivo se estiver gravando. */
import type { HistoryStatus, MeetingRecord } from '@/shared/types/domain';
import { Badge } from '@/shared/ui/Badge';

export function StatusBadge({
  status,
  syncState,
}: {
  status: HistoryStatus;
  syncState?: MeetingRecord['syncState'];
}) {
  if (syncState?.status === 'syncing') {
    return <Badge tone="warning">Sincronizando…</Badge>;
  }
  if (syncState?.status === 'pending') {
    return <Badge tone="warning">Envio pendente</Badge>;
  }
  if (syncState?.status === 'error') {
    return <Badge tone="danger">Falha no envio</Badge>;
  }
  if (status === 'sent' && syncState?.receipt?.processing.status === 'failed') {
    return <Badge tone="danger">Análise falhou</Badge>;
  }
  if (
    status === 'sent' &&
    (syncState?.receipt?.processing.status === 'pending' ||
      syncState?.receipt?.processing.status === 'running')
  ) {
    return <Badge tone="warning">Análise pendente</Badge>;
  }
  switch (status) {
    case 'recording':
      return (
        <Badge tone="warning">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse-dot" />
          Gravando
        </Badge>
      );
    case 'sent':
      return <Badge tone="primary">Sincronizada</Badge>;
    case 'ready':
      return <Badge tone="neutral">Guardada</Badge>;
  }
}
