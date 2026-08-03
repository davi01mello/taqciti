import type { AccountBoundaryState } from '@/shared/types/domain';

interface AccountBoundaryNoticeProps {
  boundary: AccountBoundaryState | undefined;
  compact?: boolean;
}

/** Mostra qual conta do Meet a captura está observando — informativo, nunca login. */
export function AccountBoundaryNotice({
  boundary,
  compact = false,
}: AccountBoundaryNoticeProps) {
  if (!boundary?.meet) return null;

  const spacing = compact ? 'px-3 py-2 text-caption' : 'px-3.5 py-2.5 text-caption';
  return (
    <p
      role="status"
      className={`${spacing} rounded-control border border-primary/20 bg-primary/8 leading-relaxed text-muted`}
    >
      Conta do Meet: <strong className="font-semibold text-foreground">{boundary.meet.email}</strong>
    </p>
  );
}
