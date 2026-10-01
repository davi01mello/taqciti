/**
 * Copiar uma mensagem da conversa — a da pessoa ou a resposta do Taq.
 *
 * Aparece discreto e acende ao passar o mouse sobre o turno (ver
 * `respostaDoTaq.css`); pelo teclado ele está sempre alcançável. "Copiado" só
 * aparece quando a área de transferência confirmou: prometer a cópia sem ela
 * ter acontecido é pior que não ter o botão.
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon';

export function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [estado, setEstado] = useState<'parado' | 'copiado' | 'falhou'>('parado');

  useEffect(() => {
    if (estado === 'parado') return;
    const t = window.setTimeout(() => setEstado('parado'), 1800);
    return () => window.clearTimeout(t);
  }, [estado]);

  return (
    <button
      type="button"
      className={`tq-copiar${estado === 'copiado' ? ' copiado' : ''}`}
      aria-label={rotulo}
      title={rotulo}
      onClick={() => {
        const area = navigator.clipboard;
        if (!area) {
          setEstado('falhou');
          return;
        }
        void area.writeText(texto).then(
          () => setEstado('copiado'),
          () => setEstado('falhou'),
        );
      }}
    >
      <Icon name={estado === 'copiado' ? 'check' : 'copy'} size={13} />
      <span>{estado === 'copiado' ? 'Copiado' : estado === 'falhou' ? 'Não copiou' : 'Copiar'}</span>
    </button>
  );
}
