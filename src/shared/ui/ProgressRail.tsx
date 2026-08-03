/**
 * O trilho de progresso do fluxo: seta de voltar, barra fina e a contagem.
 * Fica no topo de todas as telas de pergunta, sempre no mesmo lugar.
 */
import { Icon } from './Icon';

interface ProgressRailProps {
  position: number;
  total: number;
  /** Ausente no primeiro passo: não há para onde voltar. */
  onBack?: (() => void) | undefined;
}

export function ProgressRail({ position, total, onBack }: ProgressRailProps) {
  const percent = Math.round((position / Math.max(1, total)) * 100);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        disabled={!onBack}
        aria-label="Voltar"
        className="shrink-0 rounded-full p-1 text-muted transition-all duration-200 ease-flow hover:bg-white/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
      >
        <Icon name="chevron" size={16} className="rotate-90" />
      </button>

      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#17a94a] to-[#2fd267] transition-[width] duration-300 ease-flow motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>

      <span className="shrink-0 text-micro font-semibold tabular-nums text-muted/80">
        {position} de {total}
      </span>
    </div>
  );
}
