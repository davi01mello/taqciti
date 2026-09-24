/**
 * A FILEIRA DE AÇÕES da reunião — print, pausa e perguntar à IA.
 *
 * ── Por que as três ficam à vista ────────────────────────────────────────
 *
 * São as coisas que se faz DURANTE uma reunião, e durante uma reunião ninguém
 * procura. Antes elas estavam espalhadas: o print era uma seção no meio da
 * rolagem, a pausa era um botão de texto entre outros, e "perguntar à IA" só
 * existia depois de clicar num trecho — três gestos para chegar a uma pergunta.
 *
 * ── Por que a NOTA não está mais aqui ────────────────────────────────────
 *
 * Porque havia dois caminhos para a mesma coisa: este botão e a aba "Notas",
 * logo abaixo, abrindo o MESMO editor. Dois controles para um destino é uma
 * pergunta a mais a cada vez ("são a mesma nota?"), e o estado de um tinha de
 * ser espelhado no outro. Quem escolhe o que ler é a fileira de abas —
 * transcrição ou notas —, e a nota passou a ser só um dos dois lados dela. O
 * selo de "já tem nota" foi junto, para a aba.
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
  printAberto: boolean;
  quantosPrints: number;
  onPrint: () => void;
  onPausar: () => void;
  onPerguntar: () => void;
  onFinalizar: () => void;
}

export function AcoesDaReuniao({
  viva,
  pausada,
  printAberto,
  quantosPrints,
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
