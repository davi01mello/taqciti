/**
 * A FILEIRA DE AÇÕES da reunião — print, pausa e a pergunta rápida.
 *
 * ── O que mudou com a direção "Espectro" ─────────────────────────────────
 *
 * "Print" tira o print na hora (com o clarão de câmera e um "Desfazer"), em vez
 * de abrir uma seção com outro botão dentro; os guardados ficam na aba Prints.
 * "Perguntar" virou "Pergunta rápida": a pergunta é feita e respondida AQUI,
 * embaixo das ações, sem sair da reunião — e "Continuar na conversa" leva as
 * duas para a conversa quando o assunto rende.
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
  capturando: boolean;
  quantosPrints: number;
  rapidaAberta: boolean;
  /** Avisos do Taq ainda não lidos: um ponto discreto, nunca foco nem som. */
  avisosNovos?: number;
  avisosAberto?: boolean;
  onPrint: () => void;
  onPausar: () => void;
  onRapida: () => void;
  onAvisos?: () => void;
}

export function AcoesDaReuniao({
  viva,
  pausada,
  capturando,
  quantosPrints,
  rapidaAberta,
  avisosNovos = 0,
  avisosAberto = false,
  onPrint,
  onPausar,
  onRapida,
  onAvisos,
}: Props) {
  return (
    <div className="tq-acoes" role="group" aria-label="Ações desta reunião">
      <button
        type="button"
        className="tq-acao"
        onClick={onPrint}
        // Depois do fim, a aba mostra "você saiu da chamada": um print dela não
        // é um print da reunião.
        disabled={!viva || capturando}
        title={viva ? 'Guardar o que está na tela da reunião' : 'A reunião já terminou.'}
      >
        <Icon name="image" size={16} />
        <span>{capturando ? 'Print…' : 'Print'}</span>
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

      <button
        type="button"
        className="tq-acao tq-acao-rapida"
        aria-expanded={rapidaAberta}
        aria-controls="tq-rapida"
        onClick={onRapida}
      >
        <Icon name="sparkles" size={16} />
        <span>Pergunta rápida</span>
      </button>

      {onAvisos && (
        <button
          type="button"
          className="tq-acao tq-acao-avisos"
          aria-expanded={avisosAberto}
          aria-controls="tq-avisos-popup"
          aria-label={
            avisosNovos > 0
              ? `Avisos do Taq, ${avisosNovos} ${avisosNovos === 1 ? 'novo' : 'novos'}`
              : 'Avisos do Taq'
          }
          title="Sugestões e avisos do Taq para quem organiza"
          onClick={onAvisos}
        >
          <Icon name="bell" size={16} />
          <span>Avisos</span>
          {avisosNovos > 0 && <span className="tq-acao-ponto" aria-hidden="true" />}
        </button>
      )}
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
