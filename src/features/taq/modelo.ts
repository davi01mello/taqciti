/**
 * ModelAdapter — a comunicação com o provedor de IA, do lado da extensão.
 *
 * A extensão nunca fala com o provedor diretamente: uma chave de provedor no
 * bundle seria uma chave pública. Ela fala com `POST /api/taq/turno` no
 * servidor do TaqCiti, que tem a chave e as instruções do Taq, e faz UMA chamada
 * ao modelo por pedido. Ver `server/lib/taq/contrato.ts`, de que este arquivo é
 * o espelho — os dois lados validam a forma.
 *
 * O que sai daqui para o servidor (e dele para o provedor) é só o turno: a
 * mensagem da pessoa, o contexto inicial magro (títulos e o que ela
 * selecionou), e os resultados das ferramentas que o modelo pediu — trechos
 * limitados, nunca a base inteira. Guardar localmente não quer dizer processar
 * localmente, e a interface diz isso.
 */
import { z } from 'zod/v4';
import {
  SERVER_BASE_URL,
  SERVER_SHARED_KEY,
  SERVER_SHARED_KEY_HEADER,
} from '@/shared/config/serverConfig';

// ------------------------------------------------------------- contrato

const chamadaSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1),
  argumentos: z.record(z.string(), z.unknown()),
});
export type ChamadaDoModelo = z.infer<typeof chamadaSchema>;

export type MensagemDoTurno =
  | { papel: 'pessoa'; texto: string }
  | { papel: 'modelo'; texto?: string; chamadas: ChamadaDoModelo[]; continuacao?: string }
  | {
      papel: 'ferramenta';
      resultados: Array<{
        chamadaId: string;
        nome: string;
        conteudo: Record<string, unknown>;
      }>;
    };

export interface DeclaracaoDeFerramenta {
  nome: string;
  descricao: string;
  parametros: Record<string, unknown> & { type: 'object' };
}

export interface PedidoDeTurno {
  instrucoes: string;
  contexto: string;
  mensagens: MensagemDoTurno[];
  ferramentas: DeclaracaoDeFerramenta[];
  maxTokensDeSaida: number;
}

export const respostaDoTurnoSchema = z.object({
  tipo: z.enum(['final', 'ferramentas', 'truncado']),
  texto: z.string(),
  chamadas: z.array(chamadaSchema),
  continuacao: z.string().optional(),
  uso: z.object({
    entrada: z.number().int().nonnegative(),
    saida: z.number().int().nonnegative(),
    cache: z.number().int().nonnegative().optional(),
  }),
  provedor: z.string(),
  modelo: z.string(),
  instrucoesVersao: z.string(),
  latenciaMs: z.number().nonnegative(),
});
export type RespostaDoTurno = z.infer<typeof respostaDoTurnoSchema>;

const erroSchema = z.object({
  erro: z.object({ codigo: z.string(), mensagem: z.string(), transitorio: z.boolean() }),
});

export const estadoDoTaqSchema = z.object({
  pronto: z.boolean(),
  provedor: z.string().nullable(),
  modelo: z.string().nullable(),
  instrucoesVersao: z.string(),
  politicaDeDados: z.enum(['private', 'training']),
  pendencias: z.array(z.string()),
});
export type EstadoDoTaq = z.infer<typeof estadoDoTaqSchema>;

/** A versão de instruções que esta build espera do servidor. */
export const INSTRUCOES_ESPERADAS = 'taq-v6';

// ---------------------------------------------------------------- erros

export class ErroDoModelo extends Error {
  readonly codigo: string;
  readonly transitorio: boolean;

  constructor(codigo: string, mensagem: string, transitorio = false) {
    super(mensagem);
    this.name = 'ErroDoModelo';
    this.codigo = codigo;
    this.transitorio = transitorio;
  }
}

// -------------------------------------------------------------- adaptador

export interface AdaptadorDeModelo {
  turno(pedido: PedidoDeTurno, sinal: AbortSignal): Promise<RespostaDoTurno>;
}

export interface AdaptadorHttp extends AdaptadorDeModelo {
  estado(sinal?: AbortSignal): Promise<EstadoDoTaq>;
}

export function criarAdaptadorHttp(
  opcoes: {
    baseUrl?: string;
    chave?: string;
    transporte?: typeof fetch;
    /**
     * Declara ao servidor que o conteúdo é SINTÉTICO. Só o teste ao vivo
     * (`taq.live.test.ts`, com reuniões inventadas) liga isto; a interface
     * nunca — registro real não é sintético, e o servidor com chave de
     * treinamento o recusa, que é o comportamento certo.
     */
    sintetica?: boolean;
  } = {},
): AdaptadorHttp {
  const baseUrl = (opcoes.baseUrl ?? SERVER_BASE_URL).replace(/\/+$/, '');
  const chave = opcoes.chave ?? SERVER_SHARED_KEY;
  const transporte =
    opcoes.transporte ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function pedir(caminho: string, init: RequestInit): Promise<unknown> {
    let resposta: Response;
    try {
      resposta = await transporte(`${baseUrl}${caminho}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          [SERVER_SHARED_KEY_HEADER]: chave,
          ...(init.headers ?? {}),
        },
      });
    } catch {
      if (init.signal?.aborted) throw new ErroDoModelo('cancelado', 'Cancelado.');
      throw new ErroDoModelo(
        'servidor_inalcancavel',
        `O servidor do TaqCiti não respondeu (${baseUrl}).`,
        true,
      );
    }

    let corpo: unknown = null;
    try {
      corpo = await resposta.json();
    } catch {
      /* corpo vazio ou não-JSON: tratado abaixo */
    }
    if (!resposta.ok) {
      const lido = erroSchema.safeParse(corpo);
      if (lido.success) {
        throw new ErroDoModelo(
          lido.data.erro.codigo,
          lido.data.erro.mensagem,
          lido.data.erro.transitorio,
        );
      }
      if (resposta.status === 401) {
        throw new ErroDoModelo(
          'nao_autorizado',
          'O servidor recusou a chave desta extensão.',
        );
      }
      throw new ErroDoModelo(
        'falha_do_servidor',
        `O servidor respondeu ${resposta.status}.`,
        resposta.status >= 500,
      );
    }
    return corpo;
  }

  return {
    async turno(pedido, sinal) {
      const corpo = await pedir('/api/taq/turno', {
        method: 'POST',
        body: JSON.stringify(opcoes.sintetica ? { ...pedido, sintetica: true } : pedido),
        signal: sinal,
      });
      const lido = respostaDoTurnoSchema.safeParse(corpo);
      if (!lido.success) {
        throw new ErroDoModelo(
          'resposta_invalida',
          'O servidor devolveu um turno fora do contrato.',
        );
      }
      return lido.data;
    },

    async estado(sinal) {
      const corpo = await pedir('/api/taq/estado', {
        method: 'GET',
        ...(sinal ? { signal: sinal } : {}),
      });
      const lido = estadoDoTaqSchema.safeParse(corpo);
      if (!lido.success) {
        throw new ErroDoModelo(
          'resposta_invalida',
          'O servidor devolveu um estado fora do contrato.',
        );
      }
      return lido.data;
    },
  };
}
