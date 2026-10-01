/**
 * OS DOIS SELETORES — "Transcrição" e "Conversa", lado a lado.
 *
 * ── Seleção e atividade são coisas diferentes ────────────────────────────
 *
 * Isto é o ponto do componente, e a razão de ele existir separado do corpo da
 * sidebar. Qual seção está ABERTA é uma coisa; o que cada uma está FAZENDO é
 * outra, e as duas precisam ser lidas ao mesmo tempo: a captura corre enquanto
 * se lê a conversa, e o agente responde enquanto se lê a transcrição.
 *
 * A linguagem separa as duas leituras:
 *
 *   - SELEÇÃO é luz neutra — o mesmo realce branco que a HOME usa para "você
 *     está aqui", mais `aria-current`;
 *   - ATIVIDADE é a animação e a palavra ao lado do nome. Verde só quando algo
 *     acontece de verdade, e nunca sozinho: sempre acompanhado de texto, porque
 *     um ponto colorido não diz nada a quem não distingue a cor.
 *
 * Os dois desenhos são irmãos, e não o mesmo: a conversa é a marca do Taq (a
 * voz dele); a transcrição é a onda virando escrita (`MarcaDaEscuta.tsx`). O
 * mesmo traço e a mesma tinta; cada um com seu gesto.
 *
 * ── Por que a animação mora aqui ─────────────────────────────────────────
 *
 * Porque o seletor está sempre na tela. O requisito proíbe que o sinal de
 * captura dependa da seção "Transcrição" estar aberta — e a única superfície
 * que satisfaz isso sem voltar a desenhar por cima da página é esta.
 */
import type { AtividadeDoAgente } from '@/features/agent/atividade';
import { MarcaDoTaq } from '@/shared/ui/MarcaDoTaq';
import { MarcaDaEscuta, type EstadoDaCaptura } from '@/shared/ui/MarcaDaEscuta';

export type Modo = 'transcricao' | 'conversa';

interface Props {
  modo: Modo;
  onModo: (modo: Modo) => void;
  captura: EstadoDaCaptura;
  /** Sobe a cada trecho novo: é o que dispara a reação discreta da onda. */
  pulso: number;
  agente: AtividadeDoAgente;
  /** Muda a cada passo real do agente (etapa, texto): cada um ondula a marca. */
  sinalDoAgente?: string | number;
}

/** A palavra que acompanha cada estado da captura. Nunca só a cor. */
const PALAVRA_DA_CAPTURA: Record<EstadoDaCaptura, string> = {
  capturando: 'ON',
  preparando: 'Preparando',
  pausada: 'Pausada',
  interrompida: 'Interrompida',
  salva: 'Salva',
  desligada: 'Desligada',
};

/** O que a captura está fazendo, por extenso, para quem usa leitor de tela. */
const LEITURA_DA_CAPTURA: Record<EstadoDaCaptura, string> = {
  capturando: 'capturando as legendas agora',
  preparando: 'preparando a captura',
  pausada: 'captura pausada',
  interrompida: 'captura interrompida',
  salva: 'transcrição salva',
  desligada: 'captura desligada',
};

const PALAVRA_DO_AGENTE: Partial<Record<AtividadeDoAgente, string>> = {
  preparando: 'Preparando',
  escrevendo: 'Escrevendo',
  concluido: 'Pronto',
  falhou: 'Falhou',
  cancelado: 'Cancelado',
  interrompido: 'Interrompido',
};

const LEITURA_DO_AGENTE: Partial<Record<AtividadeDoAgente, string>> = {
  preparando: 'o agente está preparando uma resposta',
  escrevendo: 'o agente está escrevendo a resposta',
  concluido: 'resposta concluída',
  falhou: 'a resposta falhou',
  cancelado: 'a resposta foi cancelada',
  interrompido: 'a resposta foi interrompida',
};

/** Verde só quando algo está mesmo acontecendo. */
const CAPTURA_VIVA: ReadonlySet<EstadoDaCaptura> = new Set<EstadoDaCaptura>([
  'capturando',
]);
const CAPTURA_ATENCAO: ReadonlySet<EstadoDaCaptura> = new Set<EstadoDaCaptura>([
  'pausada',
  'interrompida',
  'preparando',
]);

export function Seletores({
  modo,
  onModo,
  captura,
  pulso,
  agente,
  sinalDoAgente,
}: Props) {
  const agenteTrabalhando = agente === 'preparando' || agente === 'escrevendo';
  const agenteFalhou =
    agente === 'falhou' || agente === 'cancelado' || agente === 'interrompido';
  const palavraAgente = PALAVRA_DO_AGENTE[agente] ?? '';

  return (
    <nav className="tq-modos" aria-label="Seções da sidebar">
      <button
        type="button"
        className={`tq-modo${modo === 'transcricao' ? ' atual' : ''}`}
        aria-current={modo === 'transcricao' ? 'page' : undefined}
        onClick={() => onModo('transcricao')}
      >
        <MarcaDaEscuta estado={captura} pulso={pulso} tamanho={24} />
        <span className="tq-modo-nome">Transcrição</span>
        <span
          className={`tq-modo-estado${
            CAPTURA_VIVA.has(captura)
              ? ' vivo'
              : CAPTURA_ATENCAO.has(captura)
                ? ' atencao'
                : ''
          }`}
        >
          {PALAVRA_DA_CAPTURA[captura]}
        </span>
        {/* A frase inteira, só para leitor de tela: a palavra curta acima é
            suficiente para quem vê, e insuficiente para quem ouve. */}
        <span className="tq-so-leitor" role="status">
          Transcrição: {LEITURA_DA_CAPTURA[captura]}
        </span>
      </button>

      <button
        type="button"
        className={`tq-modo${modo === 'conversa' ? ' atual' : ''}`}
        aria-current={modo === 'conversa' ? 'page' : undefined}
        onClick={() => onModo('conversa')}
      >
        <MarcaDoTaq estado={agente} tamanho={24} sinal={sinalDoAgente} ouve />
        <span className="tq-modo-nome">Conversa</span>
        <span
          className={`tq-modo-estado${
            agenteTrabalhando ? ' vivo' : agenteFalhou ? ' atencao' : ''
          }`}
        >
          {palavraAgente}
        </span>
        <span className="tq-so-leitor" role="status">
          {LEITURA_DO_AGENTE[agente] ?? 'Conversa: o agente está parado'}
        </span>
      </button>
    </nav>
  );
}
