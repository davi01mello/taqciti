/**
 * As conversas do Assistente, guardadas de verdade no `chrome.storage.local`.
 *
 * ── O que ENTRA aqui, e o que não entra ────────────────────────────────────
 *
 * Mensagens que alguém realmente escreveu, e as respostas que o Taq REALMENTE
 * deu (ver `features/taq/interface.ts`). Uma resposta só é gravada quando a
 * execução terminou com texto — concluída ou parcial, e a parcial vai marcada
 * como tal. Falha, cancelamento e tempo esgotado não gravam resposta nenhuma: a
 * tela diz o que aconteceu, e o histórico não ganha um texto que o produto não
 * produziu. A única exceção é quando a execução parou DEPOIS de criar um
 * documento: aí fica um registro factual do que as ferramentas confirmaram,
 * para o documento não ficar sem origem.
 *
 * Sem servidor configurado, nada responde, e a tela diz isso antes da escrita
 * — ver `AssistantView`. Guardar um texto de mentira aqui seria pior do que a
 * tela vazia: viraria histórico, sobreviveria ao recarregar, e alguém acabaria
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
import { comTravaLocal } from '@/shared/services/storageLock';
import { desvincularDaConversa } from '@/features/documents/store';

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

  // ── Só em respostas do Taq (`role: 'assistant'`) ──

  /** As fontes CONFERIDAS: existem, são recuperáveis e contêm o trecho. */
  fontes?: FonteDaResposta[];
  /** O que as ferramentas confirmaram ter criado ou editado. */
  documentos?: Array<{ id: string; titulo: string; acao: 'criado' | 'atualizado' }>;
  /** A execução que produziu esta resposta — ver `taq:execucoes`. */
  execucaoId?: string;
  /**
   * `parcial`: respondeu com o que tinha, antes de terminar o caminho;
   * `interrompido`: parou sem resposta, e esta mensagem só registra o efeito.
   */
  desfecho?: 'concluido' | 'parcial' | 'interrompido';
  limitacoes?: string[];
  emAberto?: string[];
  /**
   * A resposta é uma PERGUNTA do Taq, com opções clicáveis. O `motivo` é o que
   * faz a resposta da pessoa continuar o pedido (ver `efeitosDoPedido`).
   */
  pergunta?: {
    motivo:
      | 'tipo_de_documento'
      | 'registro_de_origem'
      | 'informacao_indispensavel'
      | 'confirmacao'
      | 'escolha_de_registro';
    opcoes: Array<{ rotulo: string; mensagem: string; descricao?: string }>;
  };
  /** Texto preparado para copiar (ex.: levar ao Claude). Nada foi enviado. */
  copiavel?: string;
  /**
   * O que uma operação fez num registro, como a FERRAMENTA confirmou — é daqui
   * que sai o link para o registro afetado, e não do texto da resposta.
   */
  operacoes?: Array<{
    acao: 'abrir' | 'renomear' | 'apagar' | 'restaurar' | 'exportar';
    tipo: 'reuniao' | 'documento' | 'conversa';
    id: string;
    titulo: string;
    ok: boolean;
    desfazivel?: boolean;
  }>;
}

/** Uma fonte citada, com o que é preciso para ABRIR a origem. */
export interface FonteDaResposta {
  ref: string;
  tipo: 'reuniao' | 'documento';
  registroId: string;
  titulo: string;
  trecho: string;
  segmento?: number;
  offsetMs?: number;
  sustenta?: string;
}

/**
 * A MEMÓRIA de uma conversa: os registros que ela já usou, para "essa reunião"
 * e "o documento de antes" continuarem fazendo sentido ao fechar e reabrir.
 *
 * São só ponteiros — tipo, id e o título de quando foram usados. Nenhum
 * conteúdo, nenhum resumo: o conteúdo continua na reunião e no documento, e
 * ponteiro não fica desatualizado em silêncio. Quem usa a memória REVALIDA cada
 * ponteiro contra os registros (ver `features/taq/memoria.ts`): registro
 * apagado sai, registro renomeado aparece com o nome atual.
 */
export interface MemoriaDaConversa {
  /** O registro de que a conversa estava falando por último. */
  foco?: RegistroLembrado;
  /** Os usados mais recentemente, do mais novo para o mais antigo. */
  recentes: RegistroLembrado[];
}

export interface RegistroLembrado {
  tipo: 'reuniao' | 'documento';
  id: string;
  titulo: string;
  /** Quando foi usado por último. */
  em: number;
}

/** Quantos ponteiros a memória guarda. */
export const MAX_LEMBRADOS = 8;

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ConversationMessage[];
  /** Reunião usada como contexto, quando a conversa nasceu de uma. */
  meetingId?: string;
  /** Ver `MemoriaDaConversa`. Ausente em conversas que nunca usaram registro. */
  memoria?: MemoriaDaConversa;
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
  // Sob trava: a resposta do Taq chega DEPOIS, pela mesma chave, e duas
  // escritas `ler → mudar → gravar` soltas perdem uma das mensagens.
  return comTravaLocal(STORAGE_KEYS.conversations, async () => {
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
  });
}

export type NovaResposta = Omit<ConversationMessage, 'id' | 'role' | 'at' | 'demo'>;

/**
 * Abre uma conversa em que o PRIMEIRO a falar é o Taq — para as perguntas que
 * sobraram de uma geração de documento.
 *
 * O documento já foi salvo; o que ficou sem resposta está nele como "A
 * preencher". As perguntas vêm para cá, e não para um formulário na frente do
 * documento, porque quem pergunta é o Taq, na conversa: a resposta da pessoa
 * continua o pedido (`informacao_indispensavel`) e o documento é atualizado.
 * O texto é o que a geração produziu — nada aqui é inventado.
 */
export async function abrirConversaDoTaq(p: {
  titulo: string;
  texto: string;
  meetingId?: string;
  documento?: { id: string; titulo: string };
}): Promise<string> {
  return comTravaLocal(STORAGE_KEYS.conversations, async () => {
    const conversas = await lerConversas();
    const agora = Date.now();
    const nova: Conversation = {
      id: novoId(),
      title: tituloDe(p.titulo),
      createdAt: agora,
      updatedAt: agora,
      ...(p.meetingId ? { meetingId: p.meetingId } : {}),
      messages: [
        {
          id: novoId(),
          role: 'assistant',
          text: p.texto.trim(),
          at: agora,
          desfecho: 'concluido',
          pergunta: { motivo: 'informacao_indispensavel', opcoes: [] },
          ...(p.documento
            ? { documentos: [{ id: p.documento.id, titulo: p.documento.titulo, acao: 'criado' as const }] }
            : {}),
        },
      ],
    };
    await gravar([nova, ...conversas]);
    return nova.id;
  });
}

/**
 * Grava a resposta do Taq na conversa. Só quem chama é o adaptador de interface
 * do Taq, e só com o texto que a execução produziu — ver o cabeçalho.
 */
export async function acrescentarResposta(
  conversaId: string,
  resposta: NovaResposta,
): Promise<void> {
  return comTravaLocal(STORAGE_KEYS.conversations, async () => {
    const conversas = await lerConversas();
    const conversa = conversas.find((c) => c.id === conversaId);
    // A conversa pode ter sido apagada enquanto o Taq trabalhava. Não ressuscita.
    if (!conversa) return;
    const agora = Date.now();
    conversa.messages = [
      ...conversa.messages,
      {
        ...resposta,
        id: novoId(),
        role: 'assistant',
        text: resposta.text.trim(),
        at: agora,
      },
    ];
    conversa.updatedAt = agora;
    await gravar([conversa, ...conversas.filter((c) => c.id !== conversaId)]);
  });
}

/**
 * Guarda na memória da conversa os registros que uma resposta usou. O primeiro
 * da lista vira o foco. Conversa apagada enquanto o Taq trabalhava: não faz
 * nada — memória de conversa que não existe não ressuscita a conversa.
 */
export async function lembrarRegistros(
  conversaId: string,
  usados: ReadonlyArray<Omit<RegistroLembrado, 'em'>>,
): Promise<void> {
  if (!usados.length) return;
  return comTravaLocal(STORAGE_KEYS.conversations, async () => {
    const conversas = await lerConversas();
    const conversa = conversas.find((c) => c.id === conversaId);
    if (!conversa) return;
    const agora = Date.now();
    const novos = usados.map((u) => ({ tipo: u.tipo, id: u.id, titulo: u.titulo, em: agora }));
    const chave = (r: { tipo: string; id: string }) => `${r.tipo}:${r.id}`;
    const vistos = new Set<string>();
    const recentes = [...novos, ...(conversa.memoria?.recentes ?? [])]
      .filter((r) => (vistos.has(chave(r)) ? false : (vistos.add(chave(r)), true)))
      .slice(0, MAX_LEMBRADOS);
    conversa.memoria = { foco: novos[0], recentes };
    await gravar(conversas);
  });
}

/**
 * As conversas que ESTA página apagou. Serve a quem escreve depois — o
 * registro da execução que apagou a própria conversa, por exemplo — para não
 * gravar um ponteiro para ela. Outra página que apague fica de fora: aí vale a
 * regra de não escrever em conversa que não existe.
 */
const APAGADAS_NESTA_PAGINA = new Set<string>();

export function conversaFoiApagada(id: string): boolean {
  return APAGADAS_NESTA_PAGINA.has(id);
}

export interface ResultadoDaExclusao {
  /** Os ids que existiam e saíram. */
  apagadas: string[];
  /** Documentos que continuam em Documentos, sem o vínculo com a conversa. */
  documentosDesvinculados: number;
}

/**
 * Apaga conversas — a MESMA operação para a tela e para o Taq.
 *
 * O que sai: a conversa, com as mensagens e a memória dela, e o registro das
 * execuções que rodaram nela (`taq:execucoes`, que só tem ids e contagens).
 * O que fica: reuniões e documentos. Documento gerado na conversa continua em
 * Documentos, só sem o vínculo `conversationId` — o mesmo que acontece com a
 * reunião apagada (ver `desvincularDaReuniao`).
 *
 * Uma resposta que chegue depois não recria nada: `acrescentarResposta` e
 * `lembrarRegistros` não escrevem em conversa que não existe, e o Taq em curso
 * nela é cancelado ao ver a conversa sumir (ver `perguntarAoTaq`).
 */
export async function apagarConversas(ids: readonly string[]): Promise<ResultadoDaExclusao> {
  const alvo = new Set(ids);
  const apagadas = await comTravaLocal(STORAGE_KEYS.conversations, async () => {
    const conversas = await lerConversas();
    const saem = conversas.filter((c) => alvo.has(c.id)).map((c) => c.id);
    if (saem.length) await gravar(conversas.filter((c) => !alvo.has(c.id)));
    return saem;
  });
  for (const id of apagadas) APAGADAS_NESTA_PAGINA.add(id);
  if (!apagadas.length) return { apagadas, documentosDesvinculados: 0 };
  const documentosDesvinculados = await desvincularDaConversa(apagadas);
  await comTravaLocal(STORAGE_KEYS.taqExecucoes, async () => {
    const execucoes = await readLocal<Array<{ conversaId?: string }>>(STORAGE_KEYS.taqExecucoes);
    if (!Array.isArray(execucoes)) return;
    const ficam = execucoes.filter((e) => !e?.conversaId || !apagadas.includes(e.conversaId));
    if (ficam.length !== execucoes.length) await writeLocal(STORAGE_KEYS.taqExecucoes, ficam);
  });
  return { apagadas, documentosDesvinculados };
}

export async function apagarConversa(id: string): Promise<void> {
  await apagarConversas([id]);
}
