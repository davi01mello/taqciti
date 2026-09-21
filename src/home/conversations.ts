/**
 * As conversas do Assistente, guardadas de verdade no `chrome.storage.local`.
 *
 * ── O que ENTRA aqui, e o que não entra ────────────────────────────────────
 *
 * Só mensagens que alguém realmente escreveu. Não existe, hoje, endpoint de
 * conversa no servidor (`server/app/api/` tem geração de documento, aplicação
 * de respostas e as rotas de bench/smoke — nenhuma é um chat), então **nenhuma
 * resposta de assistente é gravada**, nem sintetizada para a tela parecer
 * completa. O `role` já existe no tipo porque o dia em que houver backend a
 * forma do registro não deve mudar; enquanto não houver, só `'user'` aparece.
 *
 * A tela mostra, no lugar onde a resposta ficaria, um estado honesto — ver
 * `AssistantView`. Guardar um texto de mentira aqui seria pior do que a tela
 * vazia: viraria histórico, sobreviveria ao recarregar, e alguém acabaria
 * lendo como se o produto tivesse respondido aquilo.
 *
 * ── Por que não passa pelo background ──────────────────────────────────────
 *
 * O histórico de REUNIÕES passa, porque é escrito pelo content script enquanto
 * a captura acontece e precisa de um dono único. Uma conversa nasce e morre
 * dentro desta aba, a partir de um gesto de quem está olhando para ela — não
 * há segundo escritor para coordenar. O `onLocalChange` abaixo mantém outras
 * abas da HOME em sincronia, que é o único concorrente real.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange, readLocal, writeLocal } from '@/shared/services/storage';

export type MessageRole = 'user' | 'assistant';

/**
 * O CONTEXTO que a pessoa anexou explicitamente a uma pergunta.
 *
 * Explicitamente é a palavra: nada entra aqui por conta própria. A transcrição
 * da reunião, as notas e os prints só acompanham a pergunta se a pessoa os
 * tiver acrescentado — mandar o que estava por perto seria enviar a tela e os
 * rascunhos de alguém junto de "como assim?".
 *
 * Guardado NA MENSAGEM, e não na conversa, porque muda por pergunta: a primeira
 * pode partir de um trecho, a seguinte da reunião inteira.
 */
export interface ContextoDaPergunta {
  /** A reunião de onde o contexto veio. */
  meetingId: string;
  /** Título no instante da pergunta — a reunião pode ser renomeada depois. */
  meetingTitle: string;
  /** O trecho selecionado, quando a pergunta partiu de um. */
  excerpt?: string;
  /** `captionId` do trecho: liga a pergunta ao lugar exato da transcrição. */
  captionId?: string;
  /** A transcrição capturada até o momento acompanhou a pergunta. */
  comTranscricao?: boolean;
  /** As notas da reunião acompanharam a pergunta. */
  comNotas?: boolean;
  /** Quantos prints acompanharam. */
  prints?: number;
}

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  text: string;
  at: number;
  /** Nomes dos arquivos que a pessoa anexou a esta mensagem, se houve. */
  attachments?: string[];
  /** O que a pessoa juntou à pergunta. Ausente = pergunta solta. */
  contexto?: ContextoDaPergunta;
  /**
   * Mensagem de DEMONSTRAÇÃO, semeada em build de desenvolvimento para dar o
   * que olhar numa interface vazia (ver `src/dev/demo.ts`).
   *
   * Existe no tipo, e não só na tela, porque o selo "Demonstração" precisa
   * sobreviver ao storage: uma resposta fictícia que perdesse a marca ao ser
   * relida viraria, para todos os efeitos, uma resposta real no histórico.
   * `acrescentarMensagem` nunca escreve este campo — só o semeador.
   */
  demo?: true;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ConversationMessage[];
  /** Reunião usada como contexto, quando a conversa nasceu de uma. */
  meetingId?: string;
}

/** Teto de conversas guardadas. O storage local da extensão não é infinito, e
 *  uma lista sem fim vira lentidão silenciosa meses depois. */
const MAX_CONVERSAS = 60;

function novoId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Título derivado da primeira frase — o que a pessoa escreveu é o melhor
 *  rótulo possível, e não custa uma chamada de modelo. */
export function tituloDe(texto: string): string {
  const limpo = texto.trim().replace(/\s+/g, ' ');
  if (limpo.length <= 62) return limpo || 'Conversa sem título';
  return `${limpo.slice(0, 59)}…`;
}

export async function lerConversas(): Promise<Conversation[]> {
  const guardadas = await readLocal<Conversation[]>(STORAGE_KEYS.conversations);
  if (!Array.isArray(guardadas)) return [];
  // Defensivo: registros gravados por uma versão anterior (ou corrompidos por
  // uma escrita interrompida) não podem derrubar a tela inteira.
  return guardadas.filter(
    (c): c is Conversation =>
      !!c && typeof c.id === 'string' && Array.isArray(c.messages),
  );
}

async function gravar(conversas: Conversation[]): Promise<void> {
  await writeLocal(STORAGE_KEYS.conversations, conversas.slice(0, MAX_CONVERSAS));
}

/** Observa a lista inteira. Emite o valor atual e cada mudança — mesma regra
 *  dos `subscribe` da plataforma, para a UI não precisar do passo duplo. */
export function observarConversas(cb: (conversas: Conversation[]) => void): () => void {
  let vivo = true;
  void lerConversas().then((c) => {
    if (vivo) cb(c);
  });
  const parar = onLocalChange<Conversation[]>(STORAGE_KEYS.conversations, (valor) => {
    if (vivo) cb(Array.isArray(valor) ? valor : []);
  });
  return () => {
    vivo = false;
    parar();
  };
}

export interface NovaMensagem {
  texto: string;
  attachments?: string[];
  meetingId?: string;
  contexto?: ContextoDaPergunta;
}

/**
 * Acrescenta uma mensagem, criando a conversa se ela ainda não existir.
 * Devolve o id da conversa — quem chamou precisa dele para continuar nela.
 */
export async function acrescentarMensagem(
  conversaId: string | null,
  { texto, attachments, meetingId, contexto }: NovaMensagem,
): Promise<string> {
  const conversas = await lerConversas();
  const agora = Date.now();
  // Apara as pontas aqui, e não só em quem chama: o texto é renderizado com
  // `white-space: pre-wrap`, então espaço sobrando nas bordas vira recuo
  // visível. As quebras de linha do MEIO (o Shift+Enter) ficam intactas —
  // essas a pessoa escreveu de propósito.
  const limpo = texto.trim();
  const mensagem: ConversationMessage = {
    id: novoId(),
    role: 'user',
    text: limpo,
    at: agora,
    ...(attachments?.length ? { attachments } : {}),
    ...(contexto ? { contexto } : {}),
  };

  const existente = conversaId ? conversas.find((c) => c.id === conversaId) : undefined;

  if (existente) {
    existente.messages = [...existente.messages, mensagem];
    existente.updatedAt = agora;
    /*
     * A reunião da conversa é gravada na PRIMEIRA vez que um contexto aparece,
     * e não é trocada depois. Navegar por outras conversas, ou perguntar sobre
     * outra reunião numa conversa antiga, não pode mudar em silêncio a reunião
     * que ela representa — o requisito é explícito sobre isso.
     */
    if (meetingId && !existente.meetingId) existente.meetingId = meetingId;
    // Reordena para o topo: a lista é "mais recente primeiro" em toda a HOME.
    await gravar([existente, ...conversas.filter((c) => c.id !== existente.id)]);
    return existente.id;
  }

  const nova: Conversation = {
    id: novoId(),
    title: tituloDe(limpo),
    createdAt: agora,
    updatedAt: agora,
    messages: [mensagem],
    ...(meetingId ? { meetingId } : {}),
  };
  await gravar([nova, ...conversas]);
  return nova.id;
}

export async function apagarConversa(id: string): Promise<void> {
  const conversas = await lerConversas();
  await gravar(conversas.filter((c) => c.id !== id));
}
