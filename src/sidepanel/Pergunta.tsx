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
import { Wave } from '@/shared/ui/Wave';

interface Props {
  titulo: string;
  onAceitar: () => void;
  onRecusar: () => void;
}

export function Pergunta({ titulo, onAceitar, onRecusar }: Props) {
  return (
    <div className="tq-corpo tq-pergunta">
      <div className="tq-pergunta-marca">
        <Wave size={22} tone="green" animated />
      </div>
      <h2>Registrar esta reunião?</h2>
      <p className="tq-pergunta-sala">{titulo}</p>
      <p className="tq-pergunta-texto">
        O TaqCiti pode acompanhar esta reunião e guardar a transcrição neste
        computador.
      </p>
      <p className="tq-pergunta-fino">
        O que é lido são as <strong>legendas do Meet</strong> — não há gravação de
        áudio nem de vídeo, e nada sai daqui.
      </p>

      <div className="tq-pergunta-acoes">
        <button type="button" className="tq-botao-principal" onClick={onAceitar}>
          Registrar
        </button>
        <button type="button" className="tq-botao-fantasma" onClick={onRecusar}>
          Agora não
        </button>
      </div>
      <p className="tq-pergunta-fino">
        Dizendo não, nada é capturado. Dá para começar depois, por aqui mesmo.
      </p>
    </div>
  );
}
