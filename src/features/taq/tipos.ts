/**
 * Os contratos que carregam FUNÇÃO — executor de agente, executor de
 * ferramenta, o ambiente de execução.
 *
 * Separados de `contratos.ts` porque função não se valida como dado: o que dá
 * para checar em tempo de execução (a ficha, a tarefa, o resultado, os
 * argumentos) está lá, em zod; o que é comportamento está aqui, em tipo, e é
 * cobrado pelo registro na hora do cadastro.
 */
import type { z } from 'zod/v4';
import type {
  CartaoDaResposta,
  DocumentoProduzido,
  Efeito,
  FichaDeAgente,
  Pergunta,
  ResultadoDoAgente,
  Tarefa,
} from './contratos';
import type { ArmazenamentoDoTaq } from './armazenamento';
import type { LivroDeEvidencias } from './evidencias';
import type { AdaptadorDeModelo, MensagemDoTurno } from './modelo';
import type { Orcamento } from './orcamento';

// ------------------------------------------------------------- eventos

export type EventoDeExecucao =
  | { tipo: 'inicio'; execucaoId: string; tarefaId: string; agenteId: string }
  | { tipo: 'modelo'; tarefaId: string; passo: number }
  | { tipo: 'ferramenta_inicio'; tarefaId: string; nome: string; etapa: string }
  | {
      tipo: 'ferramenta_fim';
      tarefaId: string;
      nome: string;
      ok: boolean;
      codigoDeErro?: string;
      duracaoMs: number;
      /** Uma linha, sem conteúdo dos registros: "3 resultados", "documento criado". */
      resumo: string;
    }
  | { tipo: 'delegacao'; tarefaId: string; agenteId: string; estado: string }
  | { tipo: 'redigindo'; tarefaId: string }
  | { tipo: 'fim'; tarefaId: string; estado: string };

// ---------------------------------------------------------- ferramentas

/** Erro que a ferramenta devolve ao modelo como DADO, para ele corrigir o rumo. */
export class ErroDeFerramenta extends Error {
  readonly codigo: string;
  readonly detalhe?: Record<string, unknown>;

  constructor(codigo: string, mensagem: string, detalhe?: Record<string, unknown>) {
    super(mensagem);
    this.name = 'ErroDeFerramenta';
    this.codigo = codigo;
    this.detalhe = detalhe;
  }
}

/**
 * O que a TELA sabe fazer e o runtime não: navegar e falar com o background.
 * Quem monta é a superfície que iniciou a execução (HOME ou sidebar). Ausente
 * = esta execução não tem tela (teste, especialista sem interface).
 */
export interface AcoesDaInterface {
  /** Manda uma mensagem ao background — o mesmo `platform.send` da tela. */
  enviar: (mensagem: { type: string } & Record<string, unknown>) => Promise<unknown>;
  abrirReuniao: (id: string) => void;
  abrirDocumento: (id: string) => void;
}

export type OperacaoRegistrada = NonNullable<ResultadoDoAgente['operacoes']>[number];

export interface ContextoDeFerramenta {
  tarefa: Tarefa;
  armazenamento: ArmazenamentoDoTaq;
  livro: LivroDeEvidencias;
  /** Anota um documento criado/alterado — é daqui que a interface lista o que foi produzido. */
  registrarDocumento: (doc: DocumentoProduzido) => void;
  /** Anota o que ficou em aberto (campos que as fontes não trazem). */
  registrarAusentes: (itens: string[]) => void;
  /** Registra a pergunta que encerra o turno (`ask_user`). */
  registrarPergunta: (pergunta: Pergunta) => void;
  /** Registra um texto para a pessoa copiar (`prepare_external_brief`). */
  registrarCopiavel: (texto: string) => void;
  /** Registra o que uma operação fez num registro (ok ou não). */
  registrarOperacao: (op: OperacaoRegistrada) => void;
  /** Escritas confirmadas por um especialista delegado — contam para esta tarefa. */
  registrarEscritas: (n: number) => void;
  /** Um cartão para a interface desenhar — validado contra `cartaoSchema`. */
  registrarCartao: (cartao: CartaoDaResposta) => void;
  /**
   * A resposta de um especialista já pronta para a pessoa: o runtime encerra
   * com ela, sem gastar outra chamada ao modelo para reescrevê-la.
   */
  registrarRespostaFinal: (texto: string, parcial: boolean) => void;
  acoes?: AcoesDaInterface;
  /** Só existe quando a delegação está autorizada nesta tarefa. */
  delegar?: (pedido: PedidoDeDelegacao) => Promise<ResultadoDoAgente>;
}

export interface DefinicaoDeFerramenta<A = unknown> {
  nome: string;
  descricao: string;
  /** Valida o argumento do modelo E gera a declaração mandada a ele. */
  schemaDeEntrada: z.ZodType<A>;
  efeito: Efeito;
  /** O que a ferramenta alcança — a política confere cada id contra o escopo. */
  requisitos: ReadonlyArray<'reunioes' | 'documentos' | 'agentes'>;
  politica: {
    /**
     * `idempotente` — repetir com os mesmos argumentos devolve o mesmo efeito
     * (a escrita se protege sozinha); `leitura` — pode repetir, mas repetição
     * idêntica em sequência é sinal de ciclo.
     */
    repeticao: 'leitura' | 'idempotente';
    maxPorExecucao?: number;
    /** Executada com sucesso, encerra a execução: é uma pergunta à pessoa. */
    encerraTurno?: boolean;
  };
  /** Como a interface descreve o passo: "Consultando uma reunião". */
  etapa: string;
  executar(argumentos: A, ctx: ContextoDeFerramenta): Promise<Record<string, unknown>>;
  /** Uma linha para o registro da execução, sem conteúdo dos registros. */
  resumir(saida: Record<string, unknown>): string;
}

// -------------------------------------------------------------- agentes

export interface PedidoDeDelegacao {
  agenteId: string;
  objetivo: string;
  entrada: unknown;
}

export interface AmbienteDeExecucao {
  modelo: AdaptadorDeModelo;
  armazenamento: ArmazenamentoDoTaq;
  livro: LivroDeEvidencias;
  /** Compartilhado com a execução principal: delegar não cria orçamento novo. */
  orcamento: Orcamento;
  emitir: (evento: EventoDeExecucao) => void;
  /** As ferramentas que ESTA tarefa pode usar — já recortadas pelo registro. */
  ferramentas: readonly DefinicaoDeFerramenta[];
  /** O histórico da conversa, compartilhado com os especialistas. */
  historico: readonly MensagemDoTurno[];
  acoes?: AcoesDaInterface;
  /** Delegar herda escopo, efeitos, orçamento e livro — nunca amplia nenhum. */
  delegar: (tarefaSuperior: Tarefa, pedido: PedidoDeDelegacao) => Promise<ResultadoDoAgente>;
}

export type ExecutorDeAgente = (
  tarefa: Tarefa,
  ambiente: AmbienteDeExecucao,
) => Promise<ResultadoDoAgente>;

export interface DefinicaoDeAgente extends FichaDeAgente {
  schemaDeEntrada: z.ZodType;
  schemaDeSaida: z.ZodType;
  /** Obrigatório para `available`; ausente em `planned` — o registro cobra. */
  executor?: ExecutorDeAgente;
}
