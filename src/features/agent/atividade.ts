/**
 * A ATIVIDADE do agente — o que ele está fazendo agora, para quem desenha.
 *
 * ── Por que isto existe separado da conversa ─────────────────────────────
 *
 * O indicador do seletor "Conversa" e a ondinha com olhos precisam saber se o
 * agente está preparando, escrevendo, parado ou se falhou. Essa informação não
 * é derivável da lista de mensagens: uma resposta sendo preparada ainda não é
 * mensagem nenhuma, e uma que falhou também não. É estado de PROCESSO, e
 * processo tem dono próprio.
 *
 * ── O que publica aqui, hoje ─────────────────────────────────────────────
 *
 * O Taq (`src/features/taq/interface.ts`): cada execução do orquestrador anuncia
 * `preparando` com a ETAPA em curso (buscando contexto, consultando uma reunião,
 * criando documento), e termina em `concluido`, `falhou`, `cancelado` (a
 * pessoa desistiu) ou `interrompido` (limite de passos ou de tempo). Sem
 * servidor configurado, nada publica — o estado fica em `repouso`, que é a
 * leitura correta.
 *
 * O simulador de desenvolvimento (`src/dev`) também publica, e não entra na
 * build de produção.
 *
 * ── Por que um store e não um `useState` ─────────────────────────────────
 *
 * Duas superfícies leem o mesmo estado (o seletor e o ícone dentro da
 * conversa), e elas não são parentes na árvore. Levantar para o `App` também
 * resolveria, mas amarraria o barramento do agente à forma da sidebar — e o
 * mesmo estado vale para a HOME.
 */

export type AtividadeDoAgente =
  /** Parado, sem pedido em curso. A ondinha respira e pisca. */
  | 'repouso'
  /** Pedido enviado, resposta ainda não começou a chegar. */
  | 'preparando'
  /** A resposta está chegando. `parcial` cresce. */
  | 'escrevendo'
  /** Terminou de responder. Passa sozinho para `repouso`. */
  | 'concluido'
  /** O pedido falhou. Permanece até o próximo pedido — a tela precisa dizer. */
  | 'falhou'
  /** Quem perguntou desistiu. Também permanece, pelo mesmo motivo. */
  | 'cancelado'
  /** Parou num limite (passos, tempo, contexto). Permanece, como os dois acima. */
  | 'interrompido';

export interface EstadoDoAgente {
  atividade: AtividadeDoAgente;
  /**
   * O texto da resposta enquanto ela chega.
   *
   * Vive aqui, e não na conversa gravada, de propósito: uma resposta pela
   * metade não é um registro. Só o texto final vira mensagem no storage —
   * gravar a cada pedaço encheria o `onChanged` de escritas e deixaria
   * respostas truncadas no histórico se a página fechasse no meio.
   */
  parcial: string;
  /**
   * O que está sendo feito AGORA, em palavras de quem lê (`Buscando contexto`).
   * Vale durante `preparando`; `null` no resto.
   */
  etapa: string | null;
}

/**
 * Quanto tempo `concluido` dura antes de virar `repouso`.
 *
 * É o tempo de a ondinha se acomodar. Curto demais e a conclusão não é vista;
 * longo demais e o ícone fica anunciando uma conclusão antiga.
 */
export const ACOMODAR_MS = 1400;

const INICIAL: EstadoDoAgente = { atividade: 'repouso', parcial: '', etapa: null };

let atual: EstadoDoAgente = INICIAL;
const ouvintes = new Set<(estado: EstadoDoAgente) => void>();
let acomodarTimer: ReturnType<typeof setTimeout> | null = null;

function emitir(): void {
  for (const ouvinte of [...ouvintes]) ouvinte(atual);
}

export function agenteAgora(): EstadoDoAgente {
  return atual;
}

/**
 * Anuncia o que o agente está fazendo.
 *
 * `concluido` é o único estado com prazo: ele existe para a animação poder
 * mostrar a acomodação, e depois dela não há mais nada de diferente a dizer.
 * `falhou` e `cancelado` NÃO expiram — apagá-los sozinho seria a interface
 * esquecendo um desfecho que a pessoa talvez não tenha visto.
 */
export function publicarAtividade(atividade: AtividadeDoAgente): void {
  if (acomodarTimer !== null) {
    clearTimeout(acomodarTimer);
    acomodarTimer = null;
  }
  if (atividade === atual.atividade) return;

  // O parcial pertence a UMA resposta: qualquer estado que não seja a
  // continuação dela o descarta. Mantê-lo em `concluido` é o que deixa o texto
  // na tela durante a acomodação.
  const parcial = atividade === 'escrevendo' || atividade === 'concluido' ? atual.parcial : '';
  atual = { atividade, parcial, etapa: null };
  emitir();

  if (atividade === 'concluido') {
    acomodarTimer = setTimeout(() => {
      acomodarTimer = null;
      if (atual.atividade !== 'concluido') return;
      atual = INICIAL;
      emitir();
    }, ACOMODAR_MS);
  }
}

/** A etapa em curso. Só vale durante `preparando` — fora dele é ignorada. */
export function publicarEtapa(etapa: string): void {
  if (atual.atividade !== 'preparando' || atual.etapa === etapa) return;
  atual = { ...atual, etapa };
  emitir();
}

/** O texto que está chegando. Só vale durante `escrevendo`. */
export function publicarParcial(parcial: string): void {
  if (atual.atividade !== 'escrevendo') return;
  atual = { ...atual, parcial };
  emitir();
}

/** Assina o agente. Emite o valor atual na hora, como os demais observadores. */
export function observarAgente(cb: (estado: EstadoDoAgente) => void): () => void {
  ouvintes.add(cb);
  cb(atual);
  return () => ouvintes.delete(cb);
}

/** `true` enquanto há pedido em curso — o que acende o indicador da conversa. */
export function estaTrabalhando(atividade: AtividadeDoAgente): boolean {
  return atividade === 'preparando' || atividade === 'escrevendo';
}

/** Só para os testes: devolve o módulo ao estado inicial. */
export function _resetarAgente(): void {
  if (acomodarTimer !== null) clearTimeout(acomodarTimer);
  acomodarTimer = null;
  atual = INICIAL;
  ouvintes.clear();
}
