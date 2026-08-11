/**
 * Modal de confirmação — usado apenas onde há risco real de perda de dado
 * (apagar transcrição, ignorar reunião, apagar do histórico).
 *
 * O overlay também é vidro: desfoca o que está atrás em vez de cobrir com um
 * preto chapado. É o que mantém o modal DENTRO do mesmo sistema — a tela não
 * desaparece, ela recua para fora de foco, e a caixa de decisão fica sendo a
 * única superfície nítida.
 */
import { useEffect, type ReactNode } from 'react';
import { Button } from './Button';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  /* Esc fecha. Um diálogo que só sai pelo clique fora é uma armadilha para
     quem navega por teclado — e aqui o botão de confirmação é destrutivo. */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-[6px] animate-fade-in"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="glass w-full max-w-sm rounded-card p-5 shadow-float animate-entry"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-sm font-semibold">{title}</h2>
        <p className="mb-5 text-read leading-relaxed text-muted">{description}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
