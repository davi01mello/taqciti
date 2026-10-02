/**
 * A PERGUNTA que antecede a captura.
 *
 * Abrir a sidebar não começa a transcrever — quem começa é o "sim" daqui. É a
 * única tela que ocupa o painel inteiro, porque enquanto ela existe não há
 * nada acontecendo para mostrar ao lado.
 *
 * O texto diz o que é capturado: as LEGENDAS do Meet. "Gravar a reunião" faria
 * pensar em áudio e vídeo, que esta extensão nunca tocou — e a diferença
 * importa para quem está decidindo.
 */
import type { GravacaoAnterior } from '@/features/meeting/consent';
import { Wave } from '@/shared/ui/Wave';

interface Props {
  titulo: string;
  /** A última gravação desta sala: dá para continuá-la em vez de começar outra. */
  anterior?: GravacaoAnterior | null;
  onAceitar: () => void;
  onContinuar?: (id: string) => void;
  onRecusar: () => void;
}

function quando(ms: number): string {
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function Pergunta({ titulo, anterior = null, onAceitar, onContinuar, onRecusar }: Props) {
  return (
    <div className="tq-corpo tq-pergunta">
      <h2>Registrar esta reunião?</h2>
      <p className="tq-pergunta-sala">
        <span className="tq-pergunta-marca" aria-hidden="true">
          <Wave size={18} tone="green" animated />
        </span>
        <span>{titulo}</span>
      </p>
      <p className="tq-pergunta-texto">
        O TaqCiti pode acompanhar esta reunião e guardar a transcrição neste
        computador.
      </p>
      <p className="tq-pergunta-fino">
        O que é lido são as <strong>legendas do Meet</strong> — não há gravação de
        áudio nem de vídeo, e nada sai daqui.
      </p>

      {anterior && onContinuar && (
        <p className="tq-pergunta-texto">
          Esta sala já tem uma gravação: <strong>{anterior.title}</strong>, de {quando(anterior.endedAt)},
          com {anterior.segmentos} fala(s). Dá para continuar nela, de onde parou.
        </p>
      )}

      <div className="tq-pergunta-acoes">
        {anterior && onContinuar && (
          <button type="button" className="tq-botao-principal" onClick={() => onContinuar(anterior.id)}>
            Continuar de onde parou
          </button>
        )}
        <button
          type="button"
          className={anterior && onContinuar ? 'tq-botao-fantasma' : 'tq-botao-principal'}
          onClick={onAceitar}
        >
          {anterior && onContinuar ? 'Nova gravação' : 'Registrar'}
        </button>
        <button type="button" className="tq-botao-fantasma" onClick={onRecusar}>
          Agora não
        </button>
      </div>
      <p className="tq-pergunta-fino">
        Dizendo não, nada é capturado nesta participação. A pergunta volta se você
        entrar de novo na sala mais tarde.
      </p>
    </div>
  );
}
