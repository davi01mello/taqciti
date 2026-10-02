/**
 * AgentRuntime — o ciclo de execução, com limites, cancelamento e erros.
 *
 *   1. manda ao modelo o contexto, o histórico e as ferramentas autorizadas;
 *   2. o modelo responde ou pede ferramentas;
 *   3. cada pedido é conferido (oferecida? efeito permitido? argumentos
 *      válidos? orçamento? repetição?) e executado — ou recusado com erro
 *      estruturado, que volta ao modelo como dado;
 *   4. repete até: resposta final, limite, cancelamento, tempo, ou falha.
 *
 * Não há chamada separada de planejamento: um pedido simples é um turno só, e
 * o modelo decide sozinho se precisa de ferramenta.
 *
 * ── O que nunca acontece ────────────────────────────────────────────────────
 *
 *   - Resposta de sucesso depois de falha do provedor. Falhou = `falhou`, sem
 *     texto; a interface diz que falhou.
 *   - Escrita repetida por tentativa automática. Só a chamada ao MODELO é
 *     repetida em falha transitória (é leitura); ferramenta nunca.
 *   - Documento "criado" sem a ferramenta confirmar: a lista de documentos do
 *     resultado vem das ferramentas, não do texto do modelo.
 *
 * ── Resultado parcial ───────────────────────────────────────────────────────
 *
 * Quando só resta um passo (ou acabaram as chamadas de ferramenta), o turno
 * seguinte vai SEM ferramentas e com um aviso nos resultados: o modelo responde
 * com o que já tem. Essa resposta sai marcada como `parcial`. Parar por tempo ou
 * cancelamento não tem esse último turno — não há o que esperar.
 */
import {
  cartaoSchema,
  resultadoDoAgenteSchema,
  type CartaoDaResposta,
  type DocumentoProduzido,
  type ErroEstruturado,
  type EstadoDeExecucao,
  type Pergunta,
  type ReferenciaDeEvidencia,
  type ResultadoDoAgente,
  type Tarefa,
} from './contratos';
import { conferirCitacoes } from './evidencias';
import {
  ErroDoModelo,
  type MensagemDoTurno,
  type PedidoDeTurno,
  type RespostaDoTurno,
} from './modelo';
import {
  executarChamada,
  declarar,
  type RegistroDeFerramentas,
} from './registroDeFerramentas';
import type { RegistroDeAgentes } from './registroDeAgentes';
import type {
  AmbienteDeExecucao,
  ContextoDeFerramenta,
  OperacaoRegistrada,
  PedidoDeDelegacao,
} from './tipos';

// ------------------------------------------------------------ utilidades

/** Motivo gravado no `abort()` — é por ele que se distingue tempo de desistência. */
export const MOTIVO_TEMPO = 'tempo_esgotado';
export const MOTIVO_CANCELADO = 'cancelado';

function motivoDoSinal(sinal: AbortSignal): 'tempo_esgotado' | 'cancelado' | null {
  if (!sinal.aborted) return null;
  return sinal.reason === MOTIVO_TEMPO ? 'tempo_esgotado' : 'cancelado';
}

function esperar(ms: number, sinal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (sinal.aborted) return resolve();
    const t = setTimeout(() => {
      sinal.removeEventListener('abort', parar);
      resolve();
    }, ms);
    const parar = () => {
      clearTimeout(t);
      resolve();
    };
    sinal.addEventListener('abort', parar, { once: true });
  });
}

/** Serialização com chaves ordenadas: `{a,b}` e `{b,a}` são a mesma chamada. */
function estavel(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(estavel).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor as object)
      .sort()
      .map(
        (k) => `${JSON.stringify(k)}:${estavel((valor as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(valor);
}

const ESPERA_BASE_MS = 600;
/** Cota por minuto sem esperarMs: o bastante para a janela do provedor virar. */
const ESPERA_DE_COTA_MS = 15_000;

async function chamarModelo(
  ambiente: AmbienteDeExecucao,
  pedido: PedidoDeTurno,
  tarefa: Tarefa,
): Promise<RespostaDoTurno> {
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      return await ambiente.modelo.turno(pedido, tarefa.sinal);
    } catch (e) {
      const transitorio = e instanceof ErroDoModelo && e.transitorio;
      // O provedor pode dizer quanto esperar (cota por minuto): vale o maior,
      // desde que caiba no prazo da execução — senão desiste já.
      // Cota por minuto sem dizer quanto: uma espera razoável para a janela virar.
      const pedida =
        e instanceof ErroDoModelo
          ? (e.esperarMs ?? (e.codigo === 'limite_do_provedor' ? ESPERA_DE_COTA_MS : 0))
          : 0;
      const espera = Math.max(ESPERA_BASE_MS * 2 ** tentativa, pedida + 250);
      const cabe = Date.now() + espera < ambiente.orcamento.prazo;
      if (
        !transitorio ||
        tentativa >= tarefa.limites.maxTentativasTransitorias ||
        !cabe ||
        tarefa.sinal.aborted
      ) {
        throw e;
      }
      await esperar(espera, tarefa.sinal);
    }
  }
}

const AVISO_ULTIMO_PASSO =
  'Aviso do runtime: este é o último turno disponível para esta execução. Responda agora ' +
  'com o que já foi obtido, dizendo claramente o que ficou incompleto. Não há mais ferramentas.';

// ----------------------------------------------------------------- ciclo

export interface ConfiguracaoDoCiclo {
  instrucoes: string;
  contexto: string;
  historico: readonly MensagemDoTurno[];
}

export async function executarCiclo(
  tarefa: Tarefa,
  ambiente: AmbienteDeExecucao,
  cfg: ConfiguracaoDoCiclo,
): Promise<ResultadoDoAgente> {
  const inicio = Date.now();
  const { orcamento, livro } = ambiente;
  const limites = tarefa.limites;

  const documentos = new Map<string, DocumentoProduzido>();
  const ausentes: string[] = [];
  const erros: ErroEstruturado[] = [];
  const limitacoes: string[] = [];
  const uso = { entrada: 0, saida: 0 };
  let passos = 0;
  let chamadas = 0;
  let repeticoes = 0;
  let meta: { provedor?: string; modelo?: string; instrucoesVersao?: string } = {};
  let pergunta: Pergunta | undefined;
  let textoCopiavel: string | undefined;
  let respostaFinal: { texto: string; parcial: boolean } | undefined;
  const operacoes: OperacaoRegistrada[] = [];
  const cartoes: CartaoDaResposta[] = [];
  const usosPorFerramenta = new Map<string, number>();
  const assinaturas = new Map<string, number>();

  const ofertadas = ambiente.ferramentas;
  const declaracoes = ofertadas.map(declarar);
  const mensagens: MensagemDoTurno[] = [
    ...cfg.historico,
    { papel: 'pessoa', texto: tarefa.objetivo },
  ];

  const ctx: ContextoDeFerramenta = {
    tarefa,
    armazenamento: ambiente.armazenamento,
    livro,
    registrarDocumento: (d) => {
      const anterior = documentos.get(d.id);
      documentos.set(d.id, anterior?.acao === 'criado' ? { ...d, acao: 'criado' } : d);
    },
    registrarAusentes: (itens) => {
      for (const i of itens) if (!ausentes.includes(i)) ausentes.push(i);
    },
    registrarPergunta: (p) => {
      pergunta = p;
    },
    registrarCopiavel: (t) => {
      textoCopiavel = t;
    },
    registrarOperacao: (op) => {
      operacoes.push(op);
    },
    registrarRespostaFinal: (texto, parcial) => {
      respostaFinal = { texto, parcial };
    },
    registrarCartao: (c) => {
      // Validado aqui: cartão fora do contrato é erro de ferramenta, não tela quebrada.
      const lido = cartaoSchema.parse(c);
      const assinatura = JSON.stringify(lido);
      const repetido = cartoes.findIndex((x) => JSON.stringify(x) === assinatura);
      if (repetido === -1) cartoes.push(lido);
    },
    ...(ambiente.acoes ? { acoes: ambiente.acoes } : {}),
    ...(ofertadas.some((f) => f.requisitos.includes('agentes'))
      ? {
          delegar: (p: PedidoDeDelegacao) => ambiente.delegar(tarefa, p),
        }
      : {}),
  };

  ambiente.emitir({
    tipo: 'inicio',
    execucaoId: tarefa.execucaoId,
    tarefaId: tarefa.tarefaId,
    agenteId: tarefa.agenteId,
  });

  const fim = (
    estado: EstadoDeExecucao,
    extra: { resposta?: string; evidencias?: ReferenciaDeEvidencia[] } = {},
  ): ResultadoDoAgente => {
    ambiente.emitir({ tipo: 'fim', tarefaId: tarefa.tarefaId, estado });
    return resultadoDoAgenteSchema.parse({
      estado,
      ...(extra.resposta ? { resposta: extra.resposta } : {}),
      evidencias: extra.evidencias ?? [],
      documentos: [...documentos.values()],
      informacoesAusentes: ausentes,
      limitacoes,
      erros,
      metricas: {
        duracaoMs: Date.now() - inicio,
        passos,
        chamadasDeFerramenta: chamadas,
        uso,
        ...meta,
      },
      ...(pergunta ? { pergunta } : {}),
      ...(textoCopiavel ? { textoCopiavel } : {}),
      ...(operacoes.length ? { operacoes } : {}),
      ...(cartoes.length ? { cartoes } : {}),
    });
  };

  for (;;) {
    const parada =
      motivoDoSinal(tarefa.sinal) ?? (orcamento.estourouPrazo() ? MOTIVO_TEMPO : null);
    if (parada) {
      limitacoes.push(
        parada === MOTIVO_TEMPO
          ? 'A execução passou do tempo máximo.'
          : 'A execução foi cancelada.',
      );
      return fim(parada);
    }
    if (orcamento.passosRestantes() <= 0) {
      limitacoes.push(
        `Limite de ${limites.maxPassos} passos atingido antes de uma resposta.`,
      );
      return fim('limite_atingido');
    }

    const ultimo =
      orcamento.passosRestantes() === 1 || orcamento.chamadasRestantes() <= 0;
    const ferramentasDoTurno = ultimo ? [] : declaracoes;

    orcamento.passos += 1;
    passos += 1;
    ambiente.emitir({ tipo: 'modelo', tarefaId: tarefa.tarefaId, passo: passos });

    let resposta: RespostaDoTurno;
    try {
      resposta = await chamarModelo(
        ambiente,
        {
          instrucoes: cfg.instrucoes,
          contexto: cfg.contexto,
          mensagens,
          ferramentas: ferramentasDoTurno,
          maxTokensDeSaida: limites.maxTokensDeSaida,
        },
        tarefa,
      );
    } catch (e) {
      const motivo = motivoDoSinal(tarefa.sinal);
      if (motivo) {
        limitacoes.push(
          motivo === MOTIVO_TEMPO
            ? 'A execução passou do tempo máximo.'
            : 'A execução foi cancelada.',
        );
        return fim(motivo);
      }
      const x =
        e instanceof ErroDoModelo
          ? e
          : new ErroDoModelo('falha_desconhecida', (e as Error)?.message ?? 'erro');
      erros.push({ codigo: x.codigo, mensagem: x.message, transitorio: x.transitorio });
      return fim('falhou');
    }

    orcamento.somarUso(resposta.uso);
    uso.entrada += resposta.uso.entrada;
    uso.saida += resposta.uso.saida;
    meta = {
      provedor: resposta.provedor,
      modelo: resposta.modelo,
      instrucoesVersao: resposta.instrucoesVersao,
    };

    if (resposta.tipo !== 'ferramentas') {
      const texto = resposta.texto.trim();
      if (!texto) {
        erros.push({
          codigo: 'resposta_vazia',
          mensagem: 'O modelo não devolveu texto.',
        });
        return fim('falhou');
      }
      const conferidas = await conferirCitacoes(texto, livro, ambiente.armazenamento);
      if (conferidas.naoVerificadas.length) {
        limitacoes.push(
          `Referências citadas que não puderam ser verificadas: ${conferidas.naoVerificadas.join(', ')}.`,
        );
      }
      let estado: EstadoDeExecucao = 'concluido';
      if (resposta.tipo === 'truncado') {
        limitacoes.push('A resposta foi cortada pelo limite de tamanho de saída.');
        estado = 'parcial';
      } else if (ultimo && passos > 1) {
        limitacoes.push(
          'A resposta foi dada no último passo disponível, com o que já tinha sido obtido.',
        );
        estado = 'parcial';
      }
      return fim(estado, {
        resposta: conferidas.texto,
        evidencias: conferidas.evidencias,
      });
    }

    if (!ferramentasDoTurno.length) {
      limitacoes.push('O modelo pediu ferramentas quando nenhuma estava disponível.');
      return fim('limite_atingido');
    }

    mensagens.push({
      papel: 'modelo',
      ...(resposta.texto ? { texto: resposta.texto } : {}),
      chamadas: resposta.chamadas,
      ...(resposta.continuacao ? { continuacao: resposta.continuacao } : {}),
    });

    const resultados: Array<{
      chamadaId: string;
      nome: string;
      conteudo: Record<string, unknown>;
    }> = [];
    for (const chamada of resposta.chamadas) {
      const def = ofertadas.find((f) => f.nome === chamada.nome);
      const assinatura = `${chamada.nome}:${estavel(chamada.argumentos)}`;
      const vezes = assinaturas.get(assinatura) ?? 0;
      const usos = usosPorFerramenta.get(chamada.nome) ?? 0;
      let conteudo: Record<string, unknown>;

      if (tarefa.sinal.aborted) {
        conteudo = { erro: { codigo: 'cancelado', mensagem: 'Execução cancelada.' } };
      } else if (orcamento.chamadasRestantes() <= 0) {
        conteudo = {
          erro: {
            codigo: 'limite_de_chamadas',
            mensagem: 'Acabaram as chamadas de ferramenta desta execução.',
          },
        };
      } else if (
        def?.politica.maxPorExecucao !== undefined &&
        usos >= def.politica.maxPorExecucao
      ) {
        conteudo = {
          erro: {
            codigo: 'limite_da_ferramenta',
            mensagem: `${def.nome} já foi usada o máximo de vezes nesta execução.`,
          },
        };
      } else if (def?.politica.repeticao === 'leitura' && vezes >= 1) {
        repeticoes += 1;
        conteudo = {
          erro: {
            codigo: 'chamada_repetida',
            mensagem:
              'Esta chamada, com estes argumentos, já foi feita. Use o resultado anterior.',
          },
        };
      } else {
        orcamento.chamadas += 1;
        chamadas += 1;
        usosPorFerramenta.set(chamada.nome, usos + 1);
        const t0 = Date.now();
        ambiente.emitir({
          tipo: 'ferramenta_inicio',
          tarefaId: tarefa.tarefaId,
          nome: chamada.nome,
          etapa: def?.etapa ?? chamada.nome,
        });
        const r = await executarChamada(
          ofertadas,
          chamada,
          ctx,
          limites.maxCaracteresPorResultado,
        );
        conteudo = r.conteudo;
        ambiente.emitir({
          tipo: 'ferramenta_fim',
          tarefaId: tarefa.tarefaId,
          nome: chamada.nome,
          ok: r.ok,
          ...(r.codigoDeErro ? { codigoDeErro: r.codigoDeErro } : {}),
          duracaoMs: Date.now() - t0,
          resumo: r.ok && def ? def.resumir(r.conteudo) : `erro: ${r.codigoDeErro}`,
        });
        if (!r.ok && r.codigoDeErro) {
          erros.push({
            codigo: r.codigoDeErro,
            mensagem: String((r.conteudo.erro as { mensagem?: string })?.mensagem ?? ''),
            ferramenta: chamada.nome,
          });
        }
      }
      assinaturas.set(assinatura, vezes + 1);
      resultados.push({ chamadaId: chamada.id, nome: chamada.nome, conteudo });

      // Uma pergunta à pessoa encerra a execução: a resposta dela é a próxima
      // mensagem da conversa, não algo que o modelo possa esperar aqui dentro.
      // As chamadas seguintes do mesmo turno não rodam.
      if (pergunta) {
        return fim('concluido', { resposta: pergunta.texto });
      }
    }

    // Um especialista já respondeu: a resposta dele é a desta execução. Reescrevê-la
    // custaria mais uma chamada ao modelo sem acrescentar fato nenhum.
    if (respostaFinal) {
      const conferidas = await conferirCitacoes(respostaFinal.texto, livro, ambiente.armazenamento);
      if (conferidas.naoVerificadas.length) {
        limitacoes.push(`Referências que não puderam ser verificadas: ${conferidas.naoVerificadas.join(', ')}.`);
      }
      return fim(respostaFinal.parcial ? 'parcial' : 'concluido', {
        resposta: conferidas.texto,
        evidencias: conferidas.evidencias,
      });
    }

    if (repeticoes >= 3) {
      limitacoes.push(
        'Ciclo repetitivo interrompido: o modelo repetiu as mesmas chamadas.',
      );
      return fim('limite_atingido');
    }

    const proximoEhUltimo =
      orcamento.passosRestantes() === 1 || orcamento.chamadasRestantes() <= 0;
    mensagens.push({
      papel: 'ferramenta',
      resultados: proximoEhUltimo
        ? resultados.map((r) => ({
            ...r,
            conteudo: { ...r.conteudo, aviso_do_runtime: AVISO_ULTIMO_PASSO },
          }))
        : resultados,
    });

    const tamanho = cfg.contexto.length + JSON.stringify(mensagens).length;
    if (tamanho > limites.maxCaracteresDeContexto) {
      limitacoes.push('O contexto acumulado passou do tamanho máximo configurado.');
      return fim('limite_atingido');
    }
  }
}

// -------------------------------------------------------------- delegação

let contadorDeTarefas = 0;
export function novoIdDeTarefa(): string {
  contadorDeTarefas += 1;
  return `t${Date.now().toString(36)}${contadorDeTarefas.toString(36)}`;
}

function recusa(
  agenteId: string,
  estado: 'indisponivel' | 'falhou',
  codigo: string,
  mensagem: string,
): ResultadoDoAgente {
  return {
    estado,
    evidencias: [],
    documentos: [],
    informacoesAusentes: [],
    limitacoes: [],
    erros: [{ codigo, mensagem, agente: agenteId }],
    metricas: {
      duracaoMs: 0,
      passos: 0,
      chamadasDeFerramenta: 0,
      uso: { entrada: 0, saida: 0 },
    },
  };
}

/**
 * A porta de delegação — a mesma para qualquer especialista.
 *
 * O filho herda o escopo e os EFEITOS (o mesmo objeto, nunca mais largo), o
 * orçamento, o livro de evidências, o histórico e o sinal de cancelamento. As
 * ferramentas dele são as que ELE declara, recortadas por esse escopo: um
 * especialista pode ter ferramentas que o pai não tem (o `app_assistant` tem
 * `rename_meeting`), mas não efeito que a execução não autorizou.
 */
export function criarDelegador(deps: {
  agentes: RegistroDeAgentes;
  ferramentas: RegistroDeFerramentas;
  base: Omit<AmbienteDeExecucao, 'ferramentas' | 'delegar'>;
}): AmbienteDeExecucao['delegar'] {
  const delegar: AmbienteDeExecucao['delegar'] = async (superior, pedido) => {
    const agente = deps.agentes.obter(pedido.agenteId);
    if (!agente) {
      return recusa(
        pedido.agenteId,
        'falhou',
        'agente_desconhecido',
        `Não existe agente "${pedido.agenteId}".`,
      );
    }
    if (agente.estado !== 'available' || !agente.executor) {
      return recusa(
        agente.id,
        'indisponivel',
        'agente_indisponivel',
        `O especialista "${agente.id}" está "${agente.estado}" e não pode ser executado.`,
      );
    }
    if (agente.id === superior.agenteId) {
      return recusa(
        agente.id,
        'falhou',
        'delegacao_recursiva',
        'Um agente não delega para si mesmo.',
      );
    }
    if (superior.profundidade + 1 > superior.limites.maxProfundidadeDeDelegacao) {
      return recusa(
        agente.id,
        'falhou',
        'profundidade_excedida',
        'Profundidade máxima de delegação atingida.',
      );
    }
    const entrada = agente.schemaDeEntrada.safeParse(pedido.entrada);
    if (!entrada.success) {
      return recusa(
        agente.id,
        'falhou',
        'entrada_invalida',
        `Entrada inválida para ${agente.id}: ${entrada.error.issues[0]?.message}`,
      );
    }

    const filho: Tarefa = {
      ...superior,
      tarefaId: novoIdDeTarefa(),
      agenteId: agente.id,
      objetivo: pedido.objetivo,
      entrada: entrada.data,
      tarefaSuperiorId: superior.tarefaId,
      profundidade: superior.profundidade + 1,
    };
    const podeDelegar =
      filho.profundidade < filho.limites.maxProfundidadeDeDelegacao &&
      deps.agentes.disponiveis(agente.id).length > 0;
    const ferramentas = deps.ferramentas.recortar(
      agente.ferramentasPermitidas,
      filho.escopo,
      { semDelegacao: !podeDelegar },
    );

    deps.base.emitir({
      tipo: 'delegacao',
      tarefaId: filho.tarefaId,
      agenteId: agente.id,
      estado: 'iniciada',
    });
    let resultado: ResultadoDoAgente;
    try {
      resultado = resultadoDoAgenteSchema.parse(
        await agente.executor(filho, { ...deps.base, ferramentas, delegar }),
      );
    } catch (e) {
      resultado = recusa(
        agente.id,
        'falhou',
        'executor_falhou',
        (e as Error)?.message ?? 'erro',
      );
    }
    if (
      resultado.saida !== undefined &&
      !agente.schemaDeSaida.safeParse(resultado.saida).success
    ) {
      resultado = recusa(
        agente.id,
        'falhou',
        'saida_invalida',
        `A saída de ${agente.id} não cumpre o contrato.`,
      );
    }
    deps.base.emitir({
      tipo: 'delegacao',
      tarefaId: filho.tarefaId,
      agenteId: agente.id,
      estado: resultado.estado,
    });
    return resultado;
  };
  return delegar;
}
