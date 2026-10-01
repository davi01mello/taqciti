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
        acao: z.enum(['abrir', 'renomear', 'apagar', 'restaurar', 'exportar']),
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
