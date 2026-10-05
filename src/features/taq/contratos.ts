/**
 * Os CONTRATOS do Taq — agente, tarefa, resultado, evidência e ferramenta.
 *
 * Tudo aqui é validado em tempo de execução (zod), e não só tipado. A razão é a
 * mesma em todos os casos: o que atravessa estas formas vem de fora do código —
 * do modelo (argumentos de ferramenta), de um especialista registrado depois
 * (resultado), do storage gravado por outra versão (execuções). Um `as` num
 * desses pontos é onde uma resposta inventada viraria registro.
 *
 * `zod/v4` e não `zod`: é a mesma dependência (3.25), no subcaminho que
 * converte schema em JSON Schema (`z.toJSONSchema`). É dali que saem as
 * declarações de ferramenta mandadas ao modelo — o schema que valida o
 * argumento é o MESMO que o descreve, e os dois não têm como divergir.
 */
import { z } from 'zod/v4';

// ---------------------------------------------------------------- escopo

/**
 * `interface`: mexe na TELA de quem usa — abrir uma reunião, baixar um arquivo.
 * Não muda registro nenhum, mas também não pode acontecer porque uma
 * transcrição mandou: só quando a pessoa pediu.
 */
export const EFEITOS = ['leitura', 'escrita_local', 'interface', 'acao_externa'] as const;
export const efeitoSchema = z.enum(EFEITOS);
export type Efeito = z.infer<typeof efeitoSchema>;

/**
 * O que UMA execução pode alcançar. Montado pelo runtime a partir da conversa
 * (ver `politica.ts`), nunca pelo modelo: nenhum argumento de ferramenta amplia
 * isto.
 */
export const escopoSchema = z.object({
  /** `todas` = todas as reuniões deste computador; lista = só estas. */
  reunioes: z.union([z.literal('todas'), z.array(z.string().min(1))]),
  /**
   * `todos` = qualquer documento; `vinculados` = só os ligados às reuniões do
   * escopo ou a esta conversa.
   */
  documentos: z.enum(['todos', 'vinculados']),
  conversaId: z.string().min(1),
  /** Os efeitos que as ferramentas desta execução podem ter. */
  efeitos: z.array(efeitoSchema).min(1),
});
export type Escopo = z.infer<typeof escopoSchema>;

// --------------------------------------------------------------- limites

export const limitesSchema = z.object({
  /** Chamadas ao modelo, somando a execução principal e as delegadas. */
  maxPassos: z.number().int().min(1).max(30),
  maxChamadasDeFerramenta: z.number().int().min(0).max(60),
  tempoMaxMs: z
    .number()
    .int()
    .min(1_000)
    .max(10 * 60_000),
  /** Teto do que vai ao modelo por turno (contexto + histórico + resultados). */
  maxCaracteresDeContexto: z.number().int().min(2_000).max(300_000),
  maxCaracteresPorResultado: z.number().int().min(500).max(40_000),
  maxTokensDeSaida: z.number().int().min(64).max(8_192),
  /** 0 = sem delegação; 1 = o orquestrador delega, o especialista não. */
  maxProfundidadeDeDelegacao: z.number().int().min(0).max(2),
  /** Novas tentativas para falha TRANSITÓRIA do provedor. Escrita nunca repete. */
  maxTentativasTransitorias: z.number().int().min(0).max(3),
});
export type Limites = z.infer<typeof limitesSchema>;

export const LIMITES_PADRAO: Limites = {
  maxPassos: 8,
  maxChamadasDeFerramenta: 16,
  tempoMaxMs: 120_000,
  maxCaracteresDeContexto: 120_000,
  maxCaracteresPorResultado: 12_000,
  maxTokensDeSaida: 2_048,
  maxProfundidadeDeDelegacao: 1,
  maxTentativasTransitorias: 2,
};

// ------------------------------------------------------------- evidência

export const tipoDeRegistroSchema = z.enum(['reuniao', 'documento']);
export type TipoDeRegistro = z.infer<typeof tipoDeRegistroSchema>;

/**
 * Onde, dentro do registro, o trecho está. Reunião: o segmento (índice), o
 * instante na reunião e o `captionId` quando existe. Documento: o intervalo de
 * caracteres.
 */
export const localizacaoSchema = z.object({
  segmento: z.number().int().nonnegative().optional(),
  offsetMs: z.number().int().nonnegative().optional(),
  captionId: z.string().optional(),
  inicio: z.number().int().nonnegative().optional(),
  fim: z.number().int().nonnegative().optional(),
});
export type Localizacao = z.infer<typeof localizacaoSchema>;

export const referenciaDeEvidenciaSchema = z.object({
  /** `r<n>` — é por este id que o modelo cita. Único por execução. */
  id: z.string().regex(/^r\d+$/),
  tipo: tipoDeRegistroSchema,
  registroId: z.string().min(1),
  titulo: z.string(),
  /** Reunião: `<fim>:<segmentos>`; documento: `updatedAt`. Muda quando a fonte muda. */
  versao: z.string().min(1),
  trecho: z.string(),
  local: localizacaoSchema,
  /** A frase da resposta que esta referência sustenta. Preenchido na citação. */
  sustenta: z.string().optional(),
});
export type ReferenciaDeEvidencia = z.infer<typeof referenciaDeEvidenciaSchema>;

// ---------------------------------------------------------------- erros

export const erroEstruturadoSchema = z.object({
  codigo: z.string().min(1),
  mensagem: z.string(),
  ferramenta: z.string().optional(),
  agente: z.string().optional(),
  transitorio: z.boolean().optional(),
});
export type ErroEstruturado = z.infer<typeof erroEstruturadoSchema>;

// ------------------------------------------------------------- resultado

export const ESTADOS_DE_EXECUCAO = [
  'concluido',
  /** Terminou, mas com parte do caminho cortada (saída ou orçamento). */
  'parcial',
  'falhou',
  'cancelado',
  'tempo_esgotado',
  'limite_atingido',
  /** O agente pedido existe, mas não está disponível. */
  'indisponivel',
] as const;
export const estadoDeExecucaoSchema = z.enum(ESTADOS_DE_EXECUCAO);
export type EstadoDeExecucao = z.infer<typeof estadoDeExecucaoSchema>;

export const documentoProduzidoSchema = z.object({
  id: z.string().min(1),
  titulo: z.string(),
  acao: z.enum(['criado', 'atualizado']),
  versao: z.string(),
});
export type DocumentoProduzido = z.infer<typeof documentoProduzidoSchema>;

export const metricasSchema = z.object({
  duracaoMs: z.number().nonnegative(),
  passos: z.number().int().nonnegative(),
  chamadasDeFerramenta: z.number().int().nonnegative(),
  uso: z.object({
    entrada: z.number().int().nonnegative(),
    saida: z.number().int().nonnegative(),
  }),
  provedor: z.string().optional(),
  modelo: z.string().optional(),
  instrucoesVersao: z.string().optional(),
});
export type Metricas = z.infer<typeof metricasSchema>;

/**
 * Uma pergunta do Taq à pessoa, com opções clicáveis quando houver. As opções
 * de tipo de documento saem do CATÁLOGO, e as de reunião, dos registros do
 * escopo — nunca do texto do modelo. `mensagem` é o que o clique envia.
 */
export const MOTIVOS_DE_PERGUNTA = [
  'tipo_de_documento',
  'registro_de_origem',
  'informacao_indispensavel',
  'confirmacao',
  /** Mais de um registro casa com o que a pessoa disse. */
  'escolha_de_registro',
] as const;
export const perguntaSchema = z.object({
  motivo: z.enum(MOTIVOS_DE_PERGUNTA),
  texto: z.string().min(1),
  opcoes: z.array(
    z.object({
      rotulo: z.string().min(1),
      mensagem: z.string().min(1),
      descricao: z.string().optional(),
    }),
  ),
});
export type Pergunta = z.infer<typeof perguntaSchema>;

// --------------------------------------------------------------- cartões

/**
 * Os CARTÕES de uma resposta — o que a interface desenha como componente, e
 * não como texto. Só as ferramentas os produzem (`registrarCartao`), validados
 * aqui; o texto do modelo nunca vira cartão, botão ou confirmação de escrita.
 *
 * Os cartões de registro (compromissos, decisões, achados, análise) levam só
 * IDS: a tela os desenha a partir do armazenamento, no estado de AGORA — um
 * compromisso concluído depois aparece concluído, um apagado aparece como
 * indisponível. Os demais (rascunho, sugestão de horário, revisão) são o
 * próprio resultado, guardado com a mensagem.
 */
export const evidenciaDoCartaoSchema = z.object({
  tipo: tipoDeRegistroSchema,
  registroId: z.string().min(1),
  titulo: z.string(),
  versao: z.string(),
  trecho: z.string(),
  segmento: z.number().int().nonnegative().optional(),
  offsetMs: z.number().int().nonnegative().optional(),
});

const idsDeRegistro = z.array(z.string().min(1)).min(1).max(40);

export const cartaoSchema = z.discriminatedUnion('tipo', [
  /** Captura de tela sob pedido: o cartão traz os botões; quem captura é a pessoa, no clique. */
  z.object({
    tipo: z.literal('captura_de_tela'),
    reuniaoId: z.string().min(1).optional(),
    titulo: z.string().optional(),
    /** A reunião tem aba aberta e ativa para o print da própria aba. */
    emAndamento: z.boolean(),
  }),
  z.object({ tipo: z.literal('compromissos'), ids: idsDeRegistro }),
  z.object({
    tipo: z.literal('sugestoes_de_compromisso'),
    reuniaoId: z.string().optional(),
    itens: z
      .array(
        z.object({
          descricao: z.string().min(1),
          responsavel: z.string().nullable(),
          prazo: z.string().nullable(),
          prazoData: z.string().optional(),
          evidencias: z.array(evidenciaDoCartaoSchema).min(1),
        }),
      )
      .min(1)
      .max(30),
  }),
  z.object({ tipo: z.literal('decisoes'), ids: idsDeRegistro }),
  z.object({ tipo: z.literal('achados'), ids: idsDeRegistro }),
  z.object({ tipo: z.literal('analise'), id: z.string().min(1) }),
  z.object({
    tipo: z.literal('rascunho_de_mensagem'),
    canal: z.enum(['email', 'chat', 'outro']),
    publico: z.enum(['interno', 'externo']),
    destinatarios: z.array(
      z.object({
        nome: z.string().min(1),
        endereco: z.string().optional(),
        /** `verificado`: nome achado nos participantes; `informado`: endereço dito pela pessoa. */
        situacao: z.enum(['verificado', 'informado', 'nao_encontrado', 'ambiguo']),
        candidatos: z.array(z.string()).optional(),
      }),
    ),
    assunto: z.string().optional(),
    corpo: z.string().min(1),
    alertas: z.array(z.string()),
  }),
  z.object({
    tipo: z.literal('sugestao_de_evento'),
    titulo: z.string().min(1),
    descricao: z.string().optional(),
    duracaoMin: z.number().int().min(5).max(480),
    fuso: z.string().min(1),
    participantes: z.array(z.string()),
    opcoes: z
      .array(z.object({ inicio: z.string(), fim: z.string(), rotulo: z.string() }))
      .min(1)
      .max(6),
  }),
  z.object({
    tipo: z.literal('estado_da_captura'),
    reuniaoId: z.string().min(1),
    titulo: z.string(),
    situacao: z.enum([
      'capturando',
      'pausada',
      'aguardando_legendas',
      'sem_legendas',
      'silencio_provavel',
      'problema_na_captura',
      'encerrada',
      'desconhecida',
    ]),
    avaliacao: z.enum(['sem_problemas_detectados', 'com_ressalvas', 'problemas_detectados']),
    sinais: z.array(z.string()),
    intervalos: z.array(z.object({ deMs: z.number(), ateMs: z.number() })),
    lacunasConhecidas: z
      .array(z.object({ tipo: z.enum(['reconexao', 'descartados', 'leitura_degradada']), quantidade: z.number().int().positive() }))
      .optional(),
    ultimaAtualizacao: z.number().optional(),
    segmentos: z.number().int().nonnegative(),
  }),
  z.object({
    /**
     * Uma ação que sai do computador (e-mail, evento): a prévia que espera a
     * confirmação, ou o desfecho. `aceito` = o Google aceitou; não diz que
     * alguém recebeu. `desconhecido` = pode ter saído: não reenviar sozinho.
     */
    tipo: z.literal('acao_externa'),
    operacao: z.enum(['email', 'evento_criar', 'evento_remarcar', 'evento_cancelar']),
    estado: z.enum(['aguardando_confirmacao', 'aceito', 'falhou', 'desconhecido']),
    titulo: z.string().min(1),
    linhas: z.array(z.string()).max(12),
    alertas: z.array(z.string()),
    /** Só um link do Google (evento criado). */
    link: z.string().optional(),
  }),
  z.object({
    tipo: z.literal('revisao_de_documento'),
    documentoId: z.string().min(1),
    titulo: z.string(),
    versao: z.string(),
    problemas: z.array(
      z.object({
        gravidade: z.enum(['alta', 'media', 'baixa']),
        tipo: z.string(),
        texto: z.string(),
      }),
    ),
    fontes: z.array(
      z.object({
        numero: z.number().int(),
        /** `conferida`: o trecho ainda está na fonte. Não diz se a frase o interpreta bem. */
        situacao: z.enum(['conferida', 'alterada', 'indisponivel', 'nao_conferivel']),
        texto: z.string(),
      }),
    ),
  }),
]);
export type CartaoDaResposta = z.infer<typeof cartaoSchema>;

export const resultadoDoAgenteSchema = z.object({
  estado: estadoDeExecucaoSchema,
  /** Texto para a pessoa. Ausente quando a execução não chegou a responder. */
  resposta: z.string().optional(),
  /** Saída estruturada, validada contra o `schemaDeSaida` do agente. */
  saida: z.unknown().optional(),
  evidencias: z.array(referenciaDeEvidenciaSchema),
  documentos: z.array(documentoProduzidoSchema),
  informacoesAusentes: z.array(z.string()),
  limitacoes: z.array(z.string()),
  erros: z.array(erroEstruturadoSchema),
  metricas: metricasSchema,
  /** A execução terminou perguntando — ver `ask_user`. */
  pergunta: perguntaSchema.optional(),
  /** O que uma operação fez (ou tentou fazer) em um registro — ver `app_assistant`. */
  operacoes: z
    .array(
      z.object({
        acao: z.enum([
          'abrir',
          'renomear',
          'apagar',
          'restaurar',
          'exportar',
          'preparar_copia',
          'baixar',
          'contexto',
        ]),
        tipo: z.enum(['reuniao', 'documento', 'conversa']),
        id: z.string(),
        titulo: z.string(),
        ok: z.boolean(),
        /** Pode ser desfeita (a reunião apagada está na lixeira). */
        desfazivel: z.boolean().optional(),
      }),
    )
    .optional(),
  /** Texto preparado para a pessoa copiar e levar a outro lugar. Nada é enviado. */
  textoCopiavel: z.string().optional(),
  /** Cartões que as ferramentas produziram — ver `cartaoSchema`. */
  cartoes: z.array(cartaoSchema).optional(),
  /** Quantas escritas locais as ferramentas CONFIRMARAM (inclui as dos especialistas). */
  escritas: z.number().int().nonnegative().optional(),
});
export type ResultadoDoAgente = z.infer<typeof resultadoDoAgenteSchema>;

// ---------------------------------------------------------------- tarefa

export const registroSelecionadoSchema = z.object({
  tipo: tipoDeRegistroSchema,
  id: z.string().min(1),
  /** Um trecho específico, quando a pessoa partiu de um. */
  trecho: z.string().optional(),
  captionId: z.string().optional(),
});
export type RegistroSelecionado = z.infer<typeof registroSelecionadoSchema>;

export const tarefaSchema = z.object({
  execucaoId: z.string().min(1),
  tarefaId: z.string().min(1),
  conversaId: z.string().min(1),
  agenteId: z.string().min(1),
  objetivo: z.string().min(1),
  /**
   * A mensagem que a PESSOA escreveu. Numa delegação o `objetivo` é escrito
   * pelo modelo; as regras que dependem do que a pessoa pediu (tipo escolhido,
   * pedido fora do catálogo, confirmação de exclusão) leem daqui.
   */
  pedidoOriginal: z.string().min(1),
  entrada: z.unknown(),
  selecionados: z.array(registroSelecionadoSchema),
  /**
   * O registro EM FOCO na conversa: o último que ela usou (ver `memoria.ts`),
   * já revalidado — existe e está no escopo. É o que resolve "essa reunião"
   * quando a pessoa não nomeia outra e a tela não selecionou nada. Um nome dito
   * pela pessoa, ou um registro selecionado na tela, vence o foco.
   */
  foco: registroSelecionadoSchema.optional(),
  escopo: escopoSchema,
  limites: limitesSchema,
  /** Quando a tarefa veio de uma delegação. */
  tarefaSuperiorId: z.string().optional(),
  profundidade: z.number().int().nonnegative(),
  /**
   * Esta mensagem RESPONDE a uma pergunta que o Taq fez (o motivo dela). É o
   * que permite a resposta "x1" continuar um pedido de escrita feito antes.
   */
  continua: z.enum(MOTIVOS_DE_PERGUNTA).optional(),
  sinal: z.instanceof(AbortSignal),
});
export type Tarefa = z.infer<typeof tarefaSchema>;

// ---------------------------------------------------------------- agente

export const ESTADOS_DE_AGENTE = ['planned', 'available', 'disabled'] as const;
export type EstadoDoAgenteRegistrado = (typeof ESTADOS_DE_AGENTE)[number];

/**
 * A FICHA de um agente — tudo menos o executor, que é função e não se valida
 * como dado. A regra "disponível exige executor" é do registro
 * (`registroDeAgentes.ts`), que recusa o cadastro que a violar.
 */
export const fichaDeAgenteSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  nome: z.string().min(1),
  descricao: z.string().min(1),
  finalidade: z.string().min(1),
  entradas: z.array(z.string()).min(1),
  saidas: z.array(z.string()).min(1),
  capacidades: z.array(z.string()),
  limites: z.array(z.string()),
  /** Onde este agente termina e o vizinho começa. */
  fronteiras: z.array(z.string()),
  estado: z.enum(ESTADOS_DE_AGENTE),
  /** `false` = serviço determinístico; não gasta chamada de modelo. */
  usaModelo: z.boolean(),
  ferramentasPermitidas: z.array(z.string()),
  /** Ex.: `taq-v1`. `null` para quem não usa modelo ou ainda não tem instruções. */
  versaoDasInstrucoes: z.string().nullable(),
});
export type FichaDeAgente = z.infer<typeof fichaDeAgenteSchema>;

// Tipos que dependem de módulos do runtime ficam em `tipos.ts` — ver lá o porquê.
