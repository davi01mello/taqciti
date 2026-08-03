/**
 * Barra de controles flutuante na base do painel ao vivo: pausar/retomar,
 * apagar transcrição (com confirmação) e finalizar reunião.
 */
import { useState } from 'react';
import { sendMessage } from '@/shared/services/messaging';
import { Button } from '@/shared/ui/Button';
import { ConfirmModal } from '@/shared/ui/ConfirmModal';
import { Icon } from '@/shared/ui/Icon';

interface ControlsBarProps {
  paused: boolean;
}

export function ControlsBar({ paused }: ControlsBarProps) {
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 p-4">
        <div className="glass pointer-events-auto flex items-center gap-2 rounded-card p-2 shadow-soft">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => void sendMessage({ type: paused ? 'ui/resume' : 'ui/pause' })}
          >
            <Icon name={paused ? 'play' : 'pause'} size={16} />
            {paused ? 'Retomar' : 'Pausar'}
          </Button>

          <Button
            variant="ghost"
            title="Apagar transcrição"
            aria-label="Apagar transcrição"
            onClick={() => setConfirmClear(true)}
            className="h-11 w-11 shrink-0 !px-0"
          >
            <Icon name="trash" size={17} />
          </Button>

          <Button
            variant="primary"
            className="flex-1"
            onClick={() => void sendMessage({ type: 'ui/finish' })}
          >
            <Icon name="stop" size={14} />
            Finalizar
          </Button>
        </div>
      </div>

      <ConfirmModal
        open={confirmClear}
        title="Apagar transcrição?"
        description="Isso apaga tudo o que foi capturado até agora nesta reunião. A captura continua a partir deste ponto."
        confirmLabel="Apagar"
        danger
        onConfirm={() => {
          setConfirmClear(false);
          void sendMessage({ type: 'ui/clearTranscript' });
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </>
  );
}
