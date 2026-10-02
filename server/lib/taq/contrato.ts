/**
 * O CONTRATO de um turno do Taq entre a extensão e o servidor.
 *
 * ── Por que o servidor só vê "um turno" ─────────────────────────────────────
 *
 * Os registros do TaqCiti moram no `chrome.storage.local` de quem usa. O
 * servidor não os alcança, e não deveria: a sincronização é opcional, e o
 * assistente precisa funcionar para quem nunca a ligou. Então o CICLO do agente
 * (chamar o modelo, executar ferramenta, devolver o resultado, repetir) roda na
 * extensão, ao lado dos dados — ver `src/features/taq/runtime.ts`.
 *
 * O servidor faz a única coisa que a extensão não pode fazer sem expor segredo:
 * falar com o provedor. Cada POST é UMA chamada ao modelo. O que a extensão
 * manda é o histórico do ciclo até ali (mensagens da pessoa, respostas do
 * modelo, resultados de ferramenta) e as DECLARAÇÕES das ferramentas que ela
 * autorizou para esta execução. O que volta é texto e/ou pedidos de ferramenta,
 * que a extensão valida e executa — ou recusa.
 *
 * ── Neutro quanto ao provedor ───────────────────────────────────────────────
 *
 * Nada aqui é Gemini. A exceção declarada é `continuacao`: alguns provedores
 * exigem que partes opacas da resposta (a assinatura do raciocínio, no Gemini
 * 3) voltem intactas no turno seguinte. O campo é uma string que a extensão
 * guarda e devolve sem ler.
 *
 * O espelho deste arquivo do lado da extensão é `src/features/taq/modelo.ts`.
 * Os dois são validados por zod em tempo de execução — mudar um sem o outro é
 * erro de validação na primeira chamada, não comportamento estranho.
 */
import { z } from 'zod';

/** Nome de ferramenta aceito por todos os provedores com function calling. */
const nomeDeFerramenta = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);

export const chamadaDeFerramentaSchema = z.object({
  id: z.string().min(1).max(200),
  nome: nomeDeFerramenta,
  /** Os argumentos como o MODELO os produziu. A extensão valida antes de usar. */
  argumentos: z.record(z.unknown()),
});
export type ChamadaDeFerramenta = z.infer<typeof chamadaDeFerramentaSchema>;

export const mensagemDoTurnoSchema = z.discriminatedUnion('papel', [
  z.object({ papel: z.literal('pessoa'), texto: z.string().min(1) }),
  z.object({
    papel: z.literal('modelo'),
    texto: z.string().optional(),
    chamadas: z.array(chamadaDeFerramentaSchema).max(16).default([]),
    /** Opaco. Ver o cabeçalho. */
    continuacao: z.string().max(200_000).optional(),
  }),
  z.object({
    papel: z.literal('ferramenta'),
    resultados: z
      .array(
        z.object({
          chamadaId: z.string().min(1).max(200),
          nome: nomeDeFerramenta,
          /** O que a ferramenta devolveu — sucesso ou erro estruturado. */
          conteudo: z.record(z.unknown()),
        }),
      )
      .min(1)
      .max(16),
  }),
]);
export type MensagemDoTurno = z.infer<typeof mensagemDoTurnoSchema>;

export const declaracaoDeFerramentaSchema = z.object({
  nome: nomeDeFerramenta,
  descricao: z.string().min(1).max(4_000),
  /** JSON Schema de um objeto. A forma interna é problema do provedor. */
  parametros: z.object({ type: z.literal('object') }).passthrough(),
});
export type DeclaracaoDeFerramenta = z.infer<typeof declaracaoDeFerramentaSchema>;

export const pedidoDeTurnoSchema = z.object({
  /** A versão das instruções que a extensão espera. Ver `instrucoes.ts`. */
  /** `taq-v3`, `documents-v1`, `app-assistant-v1`… — ver `instrucoes.ts`. */
  instrucoes: z.string().regex(/^[a-z][a-z-]*-v\d+$/),
  /**
   * O contexto inicial montado pela extensão (o que a pessoa selecionou, o
   * índice magro dos registros no escopo). Vai para o modelo como DADO, nunca
   * concatenado às instruções.
   */
  contexto: z.string().max(40_000).default(''),
  mensagens: z.array(mensagemDoTurnoSchema).min(1).max(200),
  ferramentas: z.array(declaracaoDeFerramentaSchema).max(16).default([]),
  maxTokensDeSaida: z.number().int().min(64).max(8_192),
  /**
   * Declaração de que o conteúdo é sintético. Só é exigida quando a chave do
   * servidor manda conteúdo para treinamento do provedor — mesma regra das
   * rotas de geração (ver `activeDataPolicyWarning`).
   */
  sintetica: z.boolean().optional(),
});
export type PedidoDeTurno = z.infer<typeof pedidoDeTurnoSchema>;

export const usoSchema = z.object({
  entrada: z.number().int().nonnegative(),
  saida: z.number().int().nonnegative(),
  cache: z.number().int().nonnegative().optional(),
});
export type Uso = z.infer<typeof usoSchema>;

export const respostaDoTurnoSchema = z.object({
  /**
   * `final`       — o modelo respondeu, sem pedir ferramenta;
   * `ferramentas` — o modelo pediu uma ou mais ferramentas;
   * `truncado`    — a saída bateu no teto de tokens antes de terminar.
   */
  tipo: z.enum(['final', 'ferramentas', 'truncado']),
  texto: z.string(),
  chamadas: z.array(chamadaDeFerramentaSchema),
  continuacao: z.string().optional(),
  uso: usoSchema,
  provedor: z.string(),
  modelo: z.string(),
  instrucoesVersao: z.string(),
  latenciaMs: z.number().nonnegative(),
});
export type RespostaDoTurno = z.infer<typeof respostaDoTurnoSchema>;

/**
 * Os erros que a rota devolve, com código estável.
 *
 * `transitorio` é o que decide se a extensão tenta de novo: só sobrecarga e
 * cota por minuto se resolvem esperando. Os demais se repetiriam iguais.
 */
export const CODIGOS_DE_ERRO = [
  'nao_autorizado',
  'pedido_invalido',
  'configuracao_pendente',
  'politica_de_dados',
  'contexto_grande_demais',
  'limite_do_provedor',
  'provedor_sobrecarregado',
  /** O provedor não respondeu dentro do `timeout` da chamada (ver `gemini.ts`). */
  'provedor_lento',
  'falha_do_provedor',
  'cancelado',
] as const;
export type CodigoDeErro = (typeof CODIGOS_DE_ERRO)[number];

export interface ErroDoTurno {
  erro: {
    codigo: CodigoDeErro;
    mensagem: string;
    transitorio: boolean;
    /** Quanto o provedor pediu para esperar antes de tentar de novo, quando disse. */
    esperarMs?: number;
  };
}

/** O que `GET /api/taq/estado` devolve — antes de a pessoa escrever. */
export interface EstadoDoTaq {
  pronto: boolean;
  provedor: string | null;
  modelo: string | null;
  instrucoesVersao: string;
  /** `training` = a chave pode usar o conteúdo para treinar o provedor. */
  politicaDeDados: 'private' | 'training';
  /** O que falta, em frases que a interface mostra como estão. */
  pendencias: string[];
}
