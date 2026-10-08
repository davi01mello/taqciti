/**
 * Os especialistas IMPLEMENTADOS — e como cada um é executado.
 *
 * Dois jeitos, a mesma porta (`ativar`):
 *
 *   DE MODELO: o mesmo ciclo do runtime (`executarCiclo`) com instruções
 *   próprias, versionadas no servidor (`server/lib/prompts/taq/`), e só as
 *   ferramentas que o catálogo declara para ele. Recebem da execução principal
 *   o histórico, o pedido LITERAL da pessoa (as regras que dependem do que ela
 *   disse leem `tarefa.pedidoOriginal`, nunca o objetivo escrito pelo modelo
 *   ao delegar), o escopo, os efeitos, o orçamento e o livro de evidências.
 *
 *   DETERMINÍSTICOS: `capture_monitor`, `evidence_verifier`, `quality_review`
 *   e `privacy_review`. Chamam a ferramenta deles direto, sem modelo, e
 *   respondem com uma frase montada do resultado. Não gastam passo nem token.
 */
import type { ResultadoDoAgente, Tarefa } from './contratos';
import { montarContextoInicial } from './contexto';
import { ROTULO_DA_AVALIACAO, ROTULO_DA_SITUACAO, type SituacaoDaCaptura } from './captura';
import type { RegistroDeAgentes } from './registroDeAgentes';
import { executarCiclo } from './runtime';
import { peloTitulo } from './ferramentasDeTrabalho';
import { podeLerDocumento } from './politica';
import {
  ErroDeFerramenta,
  type AmbienteDeExecucao,
  type ContextoDeFerramenta,
  type ExecutorDeAgente,
} from './tipos';

export const INSTRUCOES_DOCUMENTOS = 'documents-v3';
export const INSTRUCOES_APP = 'app-assistant-v5';
export const INSTRUCOES_ANALISTA = 'analyst-v1';
export const INSTRUCOES_COMPROMISSOS = 'commitments-v1';
export const INSTRUCOES_CONTINUIDADE = 'continuity-v1';
export const INSTRUCOES_PASSAGEM = 'handoff-v1';
export const INSTRUCOES_COMUNICACAO = 'communication-v3';
export const INSTRUCOES_AGENDA = 'scheduling-v3';
export const INSTRUCOES_MEMORIA = 'memory-v1';
export const INSTRUCOES_CONTEXTO = 'context-v1';
export const INSTRUCOES_COPILOTO = 'copilot-v1';

/** Especialista de modelo → a versão das instruções dele. */
export const ESPECIALISTAS_DE_MODELO: Readonly<Record<string, string>> = {
  documents: INSTRUCOES_DOCUMENTOS,
  app_assistant: INSTRUCOES_APP,
  meeting_analyst: INSTRUCOES_ANALISTA,
  commitments: INSTRUCOES_COMPROMISSOS,
  continuity: INSTRUCOES_CONTINUIDADE,
  handoff_analysis: INSTRUCOES_PASSAGEM,
  communication: INSTRUCOES_COMUNICACAO,
  scheduling: INSTRUCOES_AGENDA,
  organizational_memory: INSTRUCOES_MEMORIA,
  context: INSTRUCOES_CONTEXTO,
  meeting_copilot: INSTRUCOES_COPILOTO,
};

/**
 * A ferramenta sem a qual o pedido não está feito, por especialista. Só é
 * cobrada quando foi oferecida — ou seja, quando a política autorizou aquele
 * efeito para ESTE pedido (`registre o desalinhamento` sim; `compare` não).
 */
const EXIGIDA: Readonly<Record<string, string | readonly string[]>> = {
  meeting_analyst: 'save_analysis',
  // Com a integração disponível, enviar/marcar também cumpre o pedido.
  communication: ['prepare_message', 'send_email'],
  scheduling: ['prepare_event', 'list_availability', 'create_event', 'reschedule_event', 'cancel_event'],
  handoff_analysis: 'save_finding',
  continuity: 'record_decision',
};

function executorDeModelo(instrucoes: string, exigir?: string | readonly string[]): ExecutorDeAgente {
  return async (tarefa, ambiente) => {
    const entrada =
      tarefa.entrada && typeof tarefa.entrada === 'object' && Object.keys(tarefa.entrada).length
        ? `\nO Taq passou: ${JSON.stringify(tarefa.entrada).slice(0, 1_000)}`
        : '';
    const contexto =
      (await montarContextoInicial(tarefa, ambiente.armazenamento)) +
      `\n\nPedido literal da pessoa nesta mensagem: "${tarefa.pedidoOriginal.slice(0, 1_000)}"` +
      entrada;
    return executarCiclo(tarefa, ambiente, {
      instrucoes,
      contexto,
      historico: ambiente.historico,
      ...(exigir ? { exigir } : {}),
    });
  };
}

// --------------------------------------------------------- determinísticos

interface Coletado {
  cartoes: NonNullable<ResultadoDoAgente['cartoes']>;
  copiavel?: string;
}

function vazio(estado: ResultadoDoAgente['estado'], inicio: number): ResultadoDoAgente {
  return {
    estado,
    evidencias: [],
    documentos: [],
    informacoesAusentes: [],
    limitacoes: [],
    erros: [],
    metricas: { duracaoMs: Date.now() - inicio, passos: 0, chamadasDeFerramenta: 1, uso: { entrada: 0, saida: 0 } },
  };
}

/**
 * Roda a ferramenta do agente direto, sem modelo. Os mesmos recortes valem:
 * só a ferramenta que o registro entregou a ESTA tarefa (escopo e efeitos).
 */
function executorDeterministico(
  nomeDaFerramenta: string,
  argumentos: (tarefa: Tarefa, ambiente: AmbienteDeExecucao) => Record<string, unknown> | Promise<Record<string, unknown>>,
  redigir: (saida: Record<string, unknown>, coletado: Coletado) => { resposta: string; saida?: unknown },
): ExecutorDeAgente {
  return async (tarefa: Tarefa, ambiente: AmbienteDeExecucao) => {
    const inicio = Date.now();
    const ferramenta = ambiente.ferramentas.find((f) => f.nome === nomeDaFerramenta);
    if (!ferramenta) {
      return {
        ...vazio('falhou', inicio),
        erros: [{ codigo: 'ferramenta_nao_disponivel', mensagem: `${nomeDaFerramenta} não está disponível nesta tarefa.` }],
      };
    }
    const coletado: Coletado = { cartoes: [] };
    const ctx: ContextoDeFerramenta = {
      tarefa,
      armazenamento: ambiente.armazenamento,
      livro: ambiente.livro,
      registrarDocumento: () => undefined,
      registrarAusentes: () => undefined,
      registrarPergunta: () => undefined,
      registrarCopiavel: (t) => {
        coletado.copiavel = t;
      },
      registrarOperacao: () => undefined,
      registrarRespostaFinal: () => undefined,
      registrarEscritas: () => undefined,
      registrarCartao: (c) => {
        coletado.cartoes.push(c);
      },
    };
    ambiente.emitir({ tipo: 'ferramenta_inicio', tarefaId: tarefa.tarefaId, nome: ferramenta.nome, etapa: ferramenta.etapa });
    const lido = ferramenta.schemaDeEntrada.safeParse(await argumentos(tarefa, ambiente));
    try {
      if (!lido.success) throw new ErroDeFerramenta('argumentos_invalidos', lido.error.issues[0]?.message ?? 'inválido');
      const saida = await ferramenta.executar(lido.data, ctx);
      ambiente.emitir({
        tipo: 'ferramenta_fim',
        tarefaId: tarefa.tarefaId,
        nome: ferramenta.nome,
        ok: true,
        duracaoMs: Date.now() - inicio,
        resumo: ferramenta.resumir(saida),
      });
      const { resposta, saida: estruturada } = redigir(saida, coletado);
      return {
        ...vazio('concluido', inicio),
        resposta,
        ...(estruturada !== undefined ? { saida: estruturada } : {}),
        ...(coletado.cartoes.length ? { cartoes: coletado.cartoes } : {}),
        ...(coletado.copiavel ? { textoCopiavel: coletado.copiavel } : {}),
      };
    } catch (e) {
      const erro =
        e instanceof ErroDeFerramenta
          ? { codigo: e.codigo, mensagem: e.message }
          : { codigo: 'falha_interna', mensagem: (e as Error)?.message ?? 'erro' };
      ambiente.emitir({
        tipo: 'ferramenta_fim',
        tarefaId: tarefa.tarefaId,
        nome: ferramenta.nome,
        ok: false,
        codigoDeErro: erro.codigo,
        duracaoMs: Date.now() - inicio,
        resumo: `erro: ${erro.codigo}`,
      });
      // A explicação do erro É a resposta: o Taq não precisa reescrevê-la.
      return { ...vazio('concluido', inicio), resposta: erro.mensagem, erros: [{ ...erro, ferramenta: ferramenta.nome }] };
    }
  };
}

/** O id que o Taq passou na delegação, ou o que a tela selecionou. */
function idDe(tarefa: Tarefa, campo: string, tipo: 'reuniao' | 'documento'): string | undefined {
  const entrada = tarefa.entrada as Record<string, unknown> | undefined;
  const dado = entrada?.[campo];
  if (typeof dado === 'string' && dado) return dado;
  return tarefa.selecionados.find((s) => s.tipo === tipo)?.id ?? (tarefa.foco?.tipo === tipo ? tarefa.foco.id : undefined);
}

const monitorDeCaptura = executorDeterministico(
  'get_capture_state',
  (t) => {
    const id = idDe(t, 'reuniao_id', 'reuniao');
    return id ? { reuniao_id: id } : {};
  },
  (s) => {
    const situacao = s.situacao as SituacaoDaCaptura;
    const avaliacao = s.avaliacao as keyof typeof ROTULO_DA_AVALIACAO;
    const sinais = s.sinais as string[];
    const reuniao = s.reuniao as { titulo: string };
    const resposta = [
      `**${reuniao.titulo}** — ${ROTULO_DA_SITUACAO[situacao]}. ${ROTULO_DA_AVALIACAO[avaliacao]}.`,
      ...(sinais.length ? sinais.map((x) => `- ${x}`) : []),
      avaliacao === 'sem_problemas_detectados'
        ? 'Isso quer dizer que nenhum contador acusou falha — não que cada palavra foi transcrita certo.'
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    return { resposta, saida: { situacao, avaliacao, sinais } };
  },
);

const revisaoDeDocumento = (foco: 'qualidade' | 'fontes') =>
  executorDeterministico(
    'check_document',
    async (t, ambiente) => {
      const id =
        idDe(t, 'documento_id', 'documento') ??
        // "Revise a ata da sprint": o documento nomeado pelo título, se só um casa.
        peloTitulo(
          (await ambiente.armazenamento.listarDocumentos()).filter((d) => podeLerDocumento(t.escopo, d)),
          t.pedidoOriginal,
          (d) => d.title,
        )?.id;
      return id ? { documento_id: id } : {};
    },
    (s) => {
      const doc = s.documento as { titulo: string };
      const problemas = (s.problemas as Array<{ gravidade: string; tipo: string; texto: string }>).filter((p) =>
        foco === 'fontes'
          ? p.tipo.startsWith('fonte_') || p.tipo === 'nota_sem_fonte'
          : !p.tipo.startsWith('fonte_'),
      );
      const fontes = s.fontes as Array<{ numero: number; situacao: string }>;
      const titulo =
        foco === 'fontes'
          ? `Conferi as fontes de **${doc.titulo}**: ${fontes.filter((f) => f.situacao === 'conferida').length} de ${fontes.length} com o trecho ainda presente na origem.`
          : `Revisei a estrutura de **${doc.titulo}**.`;
      const resposta = [
        titulo,
        ...(problemas.length ? problemas.map((p) => `- ${p.texto}`) : ['Nenhum problema encontrado nessa conferência.']),
        foco === 'fontes'
          ? 'A conferência diz se o trecho está na fonte, não se a frase do documento o interpreta bem.'
          : 'É uma conferência de forma: não avalia se o conteúdo está correto.',
      ].join('\n');
      return {
        resposta,
        saida:
          foco === 'fontes'
            ? { fontes }
            : { problemas: problemas.map((p) => ({ gravidade: p.gravidade, texto: p.texto })) },
      };
    },
  );

const revisaoDePrivacidade = executorDeterministico(
  'review_privacy',
  (t) => {
    const e = t.entrada as Record<string, unknown> | undefined;
    const texto = typeof e?.texto === 'string' ? e.texto : typeof e?.conteudo === 'string' ? e.conteudo : t.pedidoOriginal;
    return { texto };
  },
  (s) => {
    const achados = s.achados as Array<{ tipo: string; ocorrencias: number }>;
    const resposta = achados.length
      ? [
          'Encontrei o que parece dado sensível:',
          ...achados.map((a) => `- ${a.tipo}: ${a.ocorrencias}`),
          'Preparei uma cópia com esses trechos ocultados. A revisão reconhece formatos, não contexto — confira o resto antes de compartilhar.',
        ].join('\n')
      : 'Não encontrei e-mail, telefone, CPF, CNPJ, cartão nem credencial no texto. A revisão reconhece formatos, não contexto: ainda vale ler antes de compartilhar.';
    return { resposta, saida: { achados } };
  },
);

/** Liga os especialistas implementados num registro que já os tem catalogados. */
export function ativarEspecialistas(agentes: RegistroDeAgentes): RegistroDeAgentes {
  for (const [id, instrucoes] of Object.entries(ESPECIALISTAS_DE_MODELO))
    agentes.ativar(id, executorDeModelo(instrucoes, EXIGIDA[id]), instrucoes);
  agentes.ativar('capture_monitor', monitorDeCaptura, null);
  agentes.ativar('quality_review', revisaoDeDocumento('qualidade'), null);
  agentes.ativar('evidence_verifier', revisaoDeDocumento('fontes'), null);
  agentes.ativar('privacy_review', revisaoDePrivacidade, null);
  return agentes;
}
