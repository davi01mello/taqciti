/**
 * A FILEIRA DE AÇÕES da reunião — nota, print, pausa e perguntar à IA.
 *
 * ── Por que as quatro ficam à vista ──────────────────────────────────────
 *
 * São as coisas que se faz DURANTE uma reunião, e durante uma reunião ninguém
 * procura. Antes elas estavam espalhadas: a nota era uma aba, o print era uma
 * seção no meio da rolagem, a pausa era um botão de texto entre outros, e
 * "perguntar à IA" só existia depois de clicar num trecho — três gestos para
 * chegar a uma pergunta.
 *
 * Aqui são quatro alvos de 44px, com ícone e nome, no topo da seção. O que abre
 * painel (nota, print) fica MARCADO enquanto está aberto, para o segundo clique
 * ser obviamente o que recolhe.
 *
 * ── O que continua fora daqui, de propósito ──────────────────────────────
 *
 * Marcar um trecho continua pertencendo ao TRECHO: um botão genérico de "marcar"
 * aqui em cima agiria sobre o quê? A marcação nasce do clique numa fala, que é
 * onde o alvo é explícito. O mesmo vale para "perguntar sobre este trecho" — o
 * botão daqui pergunta sobre a REUNIÃO, e os dois caminhos coexistem porque são
 * perguntas diferentes.
 */
import { Icon } from '@/shared/ui/Icon';

interface Props {
  /** `false` quando a reunião já terminou: não há o que pausar. */
  viva: boolean;
  pausada: boolean;
  notaAberta: boolean;
  /** Já existe nota guardada para esta reunião. */
  notaExiste: boolean;
  printAberto: boolean;
  quantosPrints: number;
  onNota: () => void;
  onPrint: () => void;
  onPausar: () => void;
  onPerguntar: () => void;
  onFinalizar: () => void;
}

export function AcoesDaReuniao({
  viva,
  pausada,
  notaAberta,
  notaExiste,
  printAberto,
  quantosPrints,
  onNota,
  onPrint,
  onPausar,
  onPerguntar,
  onFinalizar,
}: Props) {
  return (
    <>
      <div className="tq-acoes" role="group" aria-label="Ações desta reunião">
        <button
          type="button"
          className={`tq-acao${notaAberta ? ' aberta' : ''}`}
          aria-expanded={notaAberta}
          aria-controls="tq-editor-de-nota"
          onClick={onNota}
        >
          <Icon name="doc" size={18} />
          <span>Nota</span>
          {notaExiste && <span className="tq-acao-selo" aria-label="já tem nota" />}
        </button>

        <button
          type="button"
          className={`tq-acao${printAberto ? ' aberta' : ''}`}
          aria-expanded={printAberto}
          onClick={onPrint}
        >
          <Icon name="image" size={18} />
          <span>Print</span>
          {quantosPrints > 0 && <span className="tq-acao-conta">{quantosPrints}</span>}
        </button>

        <button
          type="button"
          className="tq-acao"
          onClick={onPausar}
          disabled={!viva}
          title={
            viva
              ? undefined
              : 'A reunião já terminou — não há captura para pausar.'
          }
        >
          <Icon name={pausada ? 'play' : 'pause'} size={18} />
          <span>{pausada ? 'Retomar' : 'Pausar'}</span>
        </button>

        <button type="button" className="tq-acao" onClick={onPerguntar}>
          <Icon name="sparkles" size={18} />
          <span>Perguntar</span>
        </button>
      </div>

      {viva && (
        <div className="tq-acoes-linha">
          <button type="button" className="tq-botao-fantasma" onClick={onFinalizar}>
            <Icon name="stop" size={13} />
            Finalizar reunião
          </button>
        </div>
      )}
    </>
  );
}
