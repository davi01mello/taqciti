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
 * ── Por que FINALIZAR não está mais aqui ─────────────────────────────────
 *
 * Ele morava numa segunda linha, sozinho, com a mesma cara de "Print". Não era
 * escolha: era onde a quebra de linha o deixava. E é a única ação daqui que
 * não se desfaz — encerra a captura. Agora ele é `FinalizarReuniao`, na ponta
 * da faixa das abas, em vermelho e com confirmação.
 *
 * ── O que continua fora daqui, de propósito ──────────────────────────────
 *
 * Marcar um trecho continua pertencendo ao TRECHO: um botão genérico de "marcar"
 * aqui em cima agiria sobre o quê? A marcação nasce do clique numa fala, que é
 * onde o alvo é explícito. O mesmo vale para "perguntar sobre este trecho" — o
 * botão daqui pergunta sobre a REUNIÃO, e os dois caminhos coexistem porque são
 * perguntas diferentes.
 */
import { useEffect, useState } from 'react';
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
}

export function AcoesDaReuniao({
  viva,
  pausada,
  printAberto,
  quantosPrints,
  onPrint,
  onPausar,
  onPerguntar,
}: Props) {
  return (
    <div className="tq-acoes" role="group" aria-label="Ações desta reunião">
      <button
        type="button"
        className={`tq-acao${printAberto ? ' aberta' : ''}`}
        aria-expanded={printAberto}
        onClick={onPrint}
      >
        <Icon name="image" size={16} />
        <span>Print</span>
        {quantosPrints > 0 && <span className="tq-acao-conta">{quantosPrints}</span>}
      </button>

      <button
        type="button"
        className={`tq-acao${pausada ? ' retomar' : ''}`}
        onClick={onPausar}
        disabled={!viva}
        title={viva ? undefined : 'A reunião já terminou — não há captura para pausar.'}
      >
        <Icon name={pausada ? 'play' : 'pause'} size={16} />
        <span>{pausada ? 'Retomar' : 'Pausar'}</span>
      </button>

      <button type="button" className="tq-acao" onClick={onPerguntar}>
        <Icon name="sparkles" size={16} />
        <span>Perguntar</span>
      </button>
    </div>
  );
}

/** Quanto tempo o pedido de confirmação fica de pé antes de desistir sozinho. */
const CONFIRMACAO_MS = 4000;

/**
 * Encerrar a captura — em dois toques.
 *
 * O primeiro arma; o segundo encerra. Armado, o botão diz o que vai acontecer
 * ("Encerrar agora") e volta ao normal sozinho em 4s, ou com Esc. Não é um
 * diálogo: um modal no meio da reunião tiraria a transcrição da tela para
 * perguntar uma coisa que cabe no próprio botão.
 *
 * O nome acessível é sempre a frase inteira ("Finalizar reunião"), mesmo
 * quando a palavra "reunião" está escondida para caber a 260px.
 */
export function FinalizarReuniao({ onFinalizar }: { onFinalizar: () => void }) {
  const [armado, setArmado] = useState(false);

  useEffect(() => {
    if (!armado) return;
    const t = setTimeout(() => setArmado(false), CONFIRMACAO_MS);
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setArmado(false);
    };
    document.addEventListener('keydown', esc);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', esc);
    };
  }, [armado]);

  return (
    <button
      type="button"
      className={`tq-finalizar${armado ? ' armado' : ''}`}
      onClick={() => {
        if (armado) {
          setArmado(false);
          onFinalizar();
        } else {
          setArmado(true);
        }
      }}
      onBlur={() => setArmado(false)}
    >
      <Icon name="stop" size={12} />
      {armado ? (
        <span>Encerrar agora</span>
      ) : (
        <span>
          Finalizar<span className="tq-so-leitor"> reunião</span>
        </span>
      )}
    </button>
  );
}
