/**
 * Barra de controles na base do painel ao vivo: pausar/retomar, apagar
 * transcrição (com confirmação) e finalizar reunião.
 *
 * ── Por que ela NÃO é `position: fixed` ────────────────────────────────────
 *
 * Era. E como o `AppShell` já reserva uma faixa de rodapé para ela, o
 * resultado é que a faixa colapsava para altura zero (conteúdo `fixed` sai do
 * fluxo e não mede nada) e a barra passava a flutuar POR CIMA da região de
 * rolagem. Os últimos ~76px da transcrição ficavam permanentemente atrás da
 * barra: a rolagem chegava ao fim, mas o fim estava coberto. Era esse o
 * "conteúdo cortado / área impossível de alcançar" — e nenhum ajuste de
 * `overflow` resolveria, porque a rolagem estava correta o tempo todo; o que
 * estava errado era a barra não ocupar o espaço que ela própria consome.
 *
 * No fluxo, o vidro continua flutuando visualmente (sombra e raio fazem esse
 * trabalho) e a transcrição termina exatamente onde a barra começa.
 */
import { useState } from 'react';
import { usePlatform } from '@/shared/platform/context';
import { Button } from '@/shared/ui/Button';
import { ConfirmModal } from '@/shared/ui/ConfirmModal';
import { Icon } from '@/shared/ui/Icon';

interface ControlsBarProps {
  paused: boolean;
}

export function ControlsBar({ paused }: ControlsBarProps) {
  const platform = usePlatform();
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <>
      <div className="px-3 pb-3 pt-1">
        <div className="glass flex items-center gap-2 rounded-card p-2 shadow-float">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => void platform.send({ type: paused ? 'ui/resume' : 'ui/pause' })}
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
            onClick={() => void platform.send({ type: 'ui/finish' })}
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
          void platform.send({ type: 'ui/clearTranscript' });
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </>
  );
}
