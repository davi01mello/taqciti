/**
 * OS DOIS SELETORES — "Reunião" e "Conversa", lado a lado.
 *
 * ── Por que "Reunião" e não "Transcrição" ────────────────────────────────
 *
 * Dentro da seção há as abas "Transcrição" e "Notas". Com o seletor também
 * chamado "Transcrição", a mesma palavra aparecia duas vezes, uma em cima da
 * outra, com dois sentidos — o modo e o conteúdo —, e não dava para dizer qual
 * mandava em qual. O assunto da seção é a reunião (a de agora, ou as de antes);
 * a transcrição é uma das coisas que se lê nela.
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
 *   - SELEÇÃO é a barrinha embaixo do nome (sem moldura nos botões), o nome
 *     em branco, mais `aria-current`;
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
import { useRef, useState } from 'react';
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

/**
 * A palavra que acompanha cada estado da captura. Nunca só a cor — com uma
 * exceção pedida (18/10/2026): "desligada" não diz nada ao lado de "Reunião",
 * porque é o estado de quem não está numa reunião. A marca fica apagada, e o
 * leitor de tela continua ouvindo "captura desligada" (`LEITURA_DA_CAPTURA`).
 */
const PALAVRA_DA_CAPTURA: Record<EstadoDaCaptura, string> = {
  capturando: 'Ao vivo',
  preparando: 'Preparando',
  iniciando: 'Iniciando',
  aguardando_fonte: 'Aguardando',
  pausada: 'Pausada',
  interrompida: 'Interrompida',
  erro: 'Erro',
  salva: 'Salva',
  desligada: '',
};

/** O que a captura está fazendo, por extenso, para quem usa leitor de tela. */
const LEITURA_DA_CAPTURA: Record<EstadoDaCaptura, string> = {
  capturando: 'capturando as legendas agora',
  preparando: 'preparando a captura',
  iniciando: 'iniciando a captura',
  aguardando_fonte: 'aguardando legendas, nenhuma fala chegou ainda',
  pausada: 'captura pausada',
  interrompida: 'captura interrompida',
  erro: 'erro na captura, as legendas não estão sendo lidas',
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
  'iniciando',
  'aguardando_fonte',
  'erro',
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

  /*
   * A BARRINHA embaixo dos dois nomes (18/10/2026): ela marca a seção aberta e
   * é ela mesma um controle — arrastar para o outro lado, ou clicar numa das
   * metades do trilho, troca a seção. Os botões continuam os alvos de teclado
   * e de leitor de tela; o trilho é só para o ponteiro (`aria-hidden`).
   *
   * Durante o arrasto a posição segue o ponteiro, em fração do trilho (0 =
   * Reunião, 1 = Conversa); ao soltar, vale a metade mais perto.
   */
  const fracao = modo === 'conversa' ? 1 : 0;
  const [arrasto, setArrasto] = useState<number | null>(null);
  const gesto = useRef<{ x: number; de: number; moveu: boolean; largura: number; esquerda: number } | null>(
    null,
  );

  const comecar = (e: React.PointerEvent<HTMLSpanElement>) => {
    const caixa = e.currentTarget.getBoundingClientRect();
    gesto.current = { x: e.clientX, de: fracao, moveu: false, largura: caixa.width, esquerda: caixa.left };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const mover = (e: React.PointerEvent<HTMLSpanElement>) => {
    const g = gesto.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    if (Math.abs(dx) > 3) g.moveu = true;
    if (!g.moveu) return;
    setArrasto(Math.min(1, Math.max(0, g.de + dx / (g.largura / 2))));
  };

  const soltar = (e: React.PointerEvent<HTMLSpanElement>) => {
    const g = gesto.current;
    gesto.current = null;
    if (!g) return;
    // Arrastou: vale a metade mais perto. Clicou: vale a metade clicada.
    const destino = g.moveu
      ? (arrasto ?? g.de) >= 0.5
      : e.clientX - g.esquerda >= g.largura / 2;
    setArrasto(null);
    const novo: Modo = destino ? 'conversa' : 'transcricao';
    if (novo !== modo) onModo(novo);
  };

  return (
    <nav className="tq-modos" aria-label="Seções da sidebar">
      <button
        type="button"
        className={`tq-modo${modo === 'transcricao' ? ' atual' : ''}`}
        aria-current={modo === 'transcricao' ? 'page' : undefined}
        onClick={() => onModo('transcricao')}
      >
        <MarcaDaEscuta estado={captura} pulso={pulso} tamanho={20} />
        <span className="tq-modo-nome">Reunião</span>
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
      </button>
      {/* A frase inteira, só para leitor de tela, e FORA do botão: dentro, ela
          entrava no nome dele junto com a palavra curta ("Transcrição Ao vivo
          Transcrição: capturando…"). */}
      <span className="tq-so-leitor" role="status">
        Reunião: {LEITURA_DA_CAPTURA[captura]}
      </span>

      <button
        type="button"
        className={`tq-modo${modo === 'conversa' ? ' atual' : ''}`}
        aria-current={modo === 'conversa' ? 'page' : undefined}
        onClick={() => onModo('conversa')}
      >
        <MarcaDoTaq estado={agente} tamanho={20} sinal={sinalDoAgente} ouve />
        <span className="tq-modo-nome">Conversa</span>
        {/* O assistente trabalhando é violeta, não verde: verde é quem fala na
            reunião, violeta são as ideias que voltam dela. */}
        <span
          className={`tq-modo-estado${
            agenteTrabalhando ? ' ideia' : agenteFalhou ? ' atencao' : ''
          }`}
        >
          {palavraAgente}
        </span>
      </button>
      <span className="tq-so-leitor" role="status">
        Conversa: {LEITURA_DO_AGENTE[agente] ?? 'o agente está parado'}
      </span>

      <span
        className={`tq-modos-trilho${arrasto !== null ? ' arrastando' : ''}`}
        aria-hidden="true"
        onPointerDown={comecar}
        onPointerMove={mover}
        onPointerUp={soltar}
        onPointerCancel={() => {
          gesto.current = null;
          setArrasto(null);
        }}
      >
        <span
          className="tq-modos-barra"
          style={{ transform: `translateX(${(arrasto ?? fracao) * 100}%)` }}
        />
      </span>
    </nav>
  );
}
