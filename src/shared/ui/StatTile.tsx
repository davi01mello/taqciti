/** Bloco de número + rótulo usado nos resumos de reunião. Componente puro. */

interface StatTileProps {
  value: string;
  label: string;
}

export function StatTile({ value, label }: StatTileProps) {
  return (
    <div className="glass-lite rounded-panel px-3 py-3 text-center">
      <b className="block text-lg font-bold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </b>
      <span className="mt-1.5 block text-micro font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
    </div>
  );
}
