/**
 * Orchestrator — o Taq, o único assistente que a pessoa vê.
 *
 * Ele interpreta o pedido, usa as ferramentas autorizadas, delega a um
 * especialista DISPONÍVEL quando o pedido é dele (ver `especialistas.ts`) e
 * consolida a resposta. Buscar, ler e responder com fontes ele faz sozinho.
 *
 * Cada `executar` monta, do zero, tudo o que a execução usa:
 *
 *   escopo      a partir da conversa (política), nunca do modelo
 *   limites     os padrões + o que quem chamou apertou
 *   sinal       cancelamento de quem chamou + o prazo, com motivos distintos
 *   orçamento   um só, compartilhado com as delegações
 *   livro       as evidências, para conferir as citações no fim
 *   ferramentas o recorte do registro para este escopo
 *
 * E, no fim, grava o registro da execução — sem conteúdo (ver `execucoes.ts`).
 * Falhar ao gravar esse registro não derruba a resposta: vira uma limitação.
 */
import { z } from 'zod/v4';
import type { ConversationMessage } from '@/home/conversations';
import {
  LIMITES_PADRAO,
  limitesSchema,
  type Limites,
  type Pergunta,
  type RegistroSelecionado,
  type ResultadoDoAgente,
  type Tarefa,
} from './contratos';
import type { ArmazenamentoDoTaq } from './armazenamento';
import { ESPECIALISTAS } from './catalogo';
import { historicoDaConversa, montarContextoInicial } from './contexto';
import { LivroDeEvidencias } from './evidencias';
import { montarRegistro } from './execucoes';
import {
  FERRAMENTAS_BASE,
  criarDelegateTask,
  pedeDocumentoSemTipo,
  perguntaDeTipo,
} from './ferramentas';
import { FERRAMENTAS_DE_APP } from './ferramentasDeApp';
import { ferramentasDeIntegracaoDisponiveis } from './ferramentasDeIntegracao';
import { FERRAMENTAS_DE_TRABALHO } from './ferramentasDeTrabalho';
import { ativarEspecialistas } from './especialistas';
import {
  INSTRUCOES_ESPERADAS,
  type AdaptadorDeModelo,
  type MensagemDoTurno,
} from './modelo';
import { focoDaTarefa, revalidarMemoria } from './memoria';
import { Orcamento } from './orcamento';
import { escopoDaConversa } from './politica';
import { RegistroDeAgentes } from './registroDeAgentes';
import { especialistaIndicado } from './roteamento';
import { RegistroDeFerramentas } from './registroDeFerramentas';
import {
  MOTIVO_CANCELADO,
  MOTIVO_TEMPO,
  criarDelegador,
  executarCiclo,
  novoIdDeTarefa,
} from './runtime';
import type { AcoesDaInterface, DefinicaoDeAgente, EventoDeExecucao } from './tipos';

/** Quanto do histórico da conversa acompanha a pergunta. */
const MAX_HISTORICO = 16_000;

const entradaDoTaq = z.object({
  contexto: z.string(),
  historico: z.array(z.custom<MensagemDoTurno>((v) => !!v && typeof v === 'object')),
});

export const TAQ: DefinicaoDeAgente = {
  id: 'taq',
  nome: 'Taq',
  descricao: 'O assistente do TaqCiti — o orquestrador.',
  finalidade: 'Atender o pedido da pessoa com base nos registros, com fontes.',
  entradas: [
    'mensagem da pessoa',
    'histórico da conversa',
    'registros selecionados',
    'escopo',
  ],
  saidas: [
    'resposta com referências',
    'documentos criados ou editados',
    'o que ficou em aberto',
  ],
  capacidades: [
    'buscar e ler registros',
    'criar e editar documentos pedidos',
    'delegar a especialistas disponíveis',
  ],
  limites: ['só o escopo da conversa', 'escrita só quando pedida', 'sem ação externa'],
  fronteiras: [
    'Coordena; o trabalho especializado é dos especialistas, quando existirem.',
  ],
  estado: 'available',
  usaModelo: true,
  // As consultas à referência de ajuda: a rede para quando a delegação ao
  // `app_assistant` falha — o Taq não pode, nesse caso, explicar o app de memória.
  ferramentasPermitidas: [
    ...FERRAMENTAS_BASE.map((f) => f.nome),
    'delegate_task',
    'get_app_capabilities',
    'get_usage_guide',
  ],
  versaoDasInstrucoes: INSTRUCOES_ESPERADAS,
  schemaDeEntrada: entradaDoTaq,
  schemaDeSaida: z.never(),
  executor: (tarefa, ambiente) => {
    const { contexto, historico } = entradaDoTaq.parse(tarefa.entrada);
    return executarCiclo(tarefa, ambiente, {
      instrucoes: INSTRUCOES_ESPERADAS,
      contexto,
      historico,
    });
  },
};

/**
 * O registro de produção: o Taq, o catálogo inteiro, e os especialistas que JÁ
 * têm implementação ligados (`especialistas.ts`). Com
 * `{ especialistas: false }`, só o catálogo — todos `planned` —, e o Taq faz
 * sozinho o trabalho de documento com as próprias ferramentas.
 */
export function criarRegistroPadrao(opcoes: { especialistas?: boolean } = {}): RegistroDeAgentes {
  const registro = new RegistroDeAgentes().registrar(TAQ);
  for (const especialista of ESPECIALISTAS) registro.registrar(especialista);
  return opcoes.especialistas === false ? registro : ativarEspecialistas(registro);
}

/** Erros de quem não achou em que agir — o caminho direto devolve ao Taq. */
const SEM_ALVO = ['nao_encontrado', 'argumentos_invalidos', 'ferramenta_nao_disponivel', 'referencia_desconhecida'];

/** Ferramentas que o Taq entrega ao `documents` quando ele está disponível. */
const DO_DOCUMENTS = ['list_document_types', 'create_document', 'update_document', 'prepare_external_brief'];

export interface PedidoAoTaq {
  conversaId: string;
  /** A reunião que a conversa representa, quando nasceu de uma. Define o escopo. */
  meetingId?: string;
  texto: string;
  /** A mensagem responde a uma pergunta do Taq com este motivo. */
  continua?: Pergunta['motivo'];
  /** As mensagens ANTERIORES à pergunta. */
  anteriores: readonly ConversationMessage[];
  selecionados: readonly RegistroSelecionado[];
  /** O que a tela sabe fazer (abrir, falar com o background). Ausente = sem tela. */
  acoes?: AcoesDaInterface;
  sinal?: AbortSignal;
  aoEvento?: (evento: EventoDeExecucao) => void;
  limites?: Partial<Limites>;
}

export interface ExecucaoDoTaq extends ResultadoDoAgente {
  execucaoId: string;
}

let contador = 0;
function novoIdDeExecucao(): string {
  contador += 1;
  return `x${Date.now().toString(36)}${contador.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function criarOrquestrador(deps: {
  modelo: AdaptadorDeModelo;
  armazenamento: ArmazenamentoDoTaq;
  agentes?: RegistroDeAgentes;
  limites?: Partial<Limites>;
}) {
  const agentes = deps.agentes ?? criarRegistroPadrao();

  return {
    agentes,

    async executar(p: PedidoAoTaq): Promise<ExecucaoDoTaq> {
      const execucaoId = novoIdDeExecucao();
      const iniciadaEm = Date.now();
      const limites = limitesSchema.parse({
        ...LIMITES_PADRAO,
        ...deps.limites,
        ...p.limites,
      });
      const escopo = escopoDaConversa({
        conversaId: p.conversaId,
        ...(p.meetingId ? { meetingId: p.meetingId } : {}),
        texto: p.texto,
        ...(p.continua ? { continua: p.continua } : {}),
      });

      // Um sinal só para a execução, com o MOTIVO no abort: é o que separa
      // "a pessoa cancelou" de "passou do tempo" no resultado.
      const controle = new AbortController();
      const aoCancelar = () => controle.abort(MOTIVO_CANCELADO);
      if (p.sinal?.aborted) aoCancelar();
      p.sinal?.addEventListener('abort', aoCancelar, { once: true });
      const relogio = setTimeout(() => controle.abort(MOTIVO_TEMPO), limites.tempoMaxMs);

      const eventos: EventoDeExecucao[] = [];
      const emitir = (e: EventoDeExecucao) => {
        eventos.push(e);
        try {
          p.aoEvento?.(e);
        } catch {
          /* quem assiste não derruba quem executa */
        }
      };

      const orcamento = new Orcamento(limites, iniciadaEm);
      const livro = new LivroDeEvidencias();
      const taq = agentes.obter('taq');
      const especialistas = agentes.disponiveis('taq');
      const podeDelegar =
        limites.maxProfundidadeDeDelegacao > 0 && especialistas.length > 0;

      const ferramentas = new RegistroDeFerramentas();
      for (const f of [...FERRAMENTAS_BASE, ...FERRAMENTAS_DE_APP, ...FERRAMENTAS_DE_TRABALHO])
        ferramentas.registrar(f);
      // Diretório, e-mail e agenda só entram quando a capacidade está `available`
      // (conta do CITi conectada, escopos concedidos): o resto o modelo nem vê.
      for (const f of await ferramentasDeIntegracaoDisponiveis()) ferramentas.registrar(f);
      if (especialistas.length) ferramentas.registrar(criarDelegateTask(especialistas));

      // O foco da conversa, revalidado: registro apagado ou fora do escopo não entra.
      const foco = await deps.armazenamento
        .listarConversas()
        .then((cs) => cs.find((c) => c.id === p.conversaId))
        .then((c) => revalidarMemoria(c, escopo, deps.armazenamento))
        .then(focoDaTarefa)
        .catch(() => undefined);

      const tarefa: Tarefa = {
        execucaoId,
        tarefaId: novoIdDeTarefa(),
        conversaId: p.conversaId,
        agenteId: 'taq',
        objetivo: p.texto,
        pedidoOriginal: p.texto,
        entrada: {},
        selecionados: [...p.selecionados],
        ...(foco ? { foco } : {}),
        escopo,
        limites,
        profundidade: 0,
        ...(p.continua ? { continua: p.continua } : {}),
        sinal: controle.signal,
      };

      const base = {
        modelo: deps.modelo,
        armazenamento: deps.armazenamento,
        livro,
        orcamento,
        emitir,
        historico: historicoDaConversa(p.anteriores, MAX_HISTORICO),
        ...(p.acoes ? { acoes: p.acoes } : {}),
      };
      // Com o `documents` disponível, documento é com ele: o Taq delega em vez de
      // ter duas portas para a mesma coisa.
      const doTaq = especialistas.some((a) => a.id === 'documents')
        ? taq?.ferramentasPermitidas.filter((n) => !DO_DOCUMENTS.includes(n)) ?? []
        : (taq?.ferramentasPermitidas ?? []);
      let resultado: ResultadoDoAgente;
      try {
        if (!taq?.executor || taq.estado !== 'available')
          throw new Error('O Taq não está disponível.');
        if (!p.continua && pedeDocumentoSemTipo(p.texto)) {
          // Documento sem tipo não é gerado a esmo: pergunta, sem gastar chamada
          // ao modelo. O clique numa opção nomeia o tipo e continua o pedido.
          const pergunta = perguntaDeTipo();
          resultado = {
            estado: 'concluido',
            resposta: pergunta.texto,
            pergunta,
            evidencias: [],
            documentos: [],
            informacoesAusentes: [],
            limitacoes: [],
            erros: [],
            metricas: {
              duracaoMs: Date.now() - iniciadaEm,
              passos: 0,
              chamadasDeFerramenta: 0,
              uso: { entrada: 0, saida: 0 },
            },
          };
        } else {
          /*
           * O pedido diz, pelas palavras dele, de quem é ("registre os próximos
           * passos" → compromissos). Delegar direto poupa o turno do Taq — que
           * só serviria para delegar — e perto de metade dos tokens. O
           * especialista responde à pessoa como faria pela delegação do
           * modelo. Se ele não puder (indisponível, ou falhou sem resposta),
           * segue o ciclo normal do Taq.
           */
          const indicado =
            !p.continua && podeDelegar
              ? especialistaIndicado(p.texto, especialistas.map((a) => a.id))
              : null;
          const delegar = criarDelegador({ agentes, ferramentas, base });
          const direto = indicado
            ? await delegar(tarefa, { agenteId: indicado, objetivo: p.texto, entrada: {} })
            : null;
          // Não achou o registro, ou não pôde agir, e nada fez: o Taq, com a
          // conversa inteira, resolve melhor (ou pergunta).
          const naoServiu =
            !direto ||
            direto.estado === 'indisponivel' ||
            (direto.estado === 'falhou' && !direto.resposta) ||
            (!direto.escritas &&
              !direto.cartoes?.length &&
              direto.erros.some((e) => SEM_ALVO.includes(e.codigo)));
          if (direto && !naoServiu) {
            resultado = direto;
          } else {
            tarefa.entrada = {
              contexto: await montarContextoInicial(
                { ...tarefa, disponiveis: especialistas.map((a) => a.id) },
                deps.armazenamento,
              ),
              historico: base.historico,
            };
            resultado = await taq.executor(tarefa, {
              ...base,
              ferramentas: ferramentas.recortar(doTaq, escopo, {
                semDelegacao: !podeDelegar,
              }),
              delegar,
            });
          }
        }
      } catch (e) {
        resultado = {
          estado: 'falhou',
          evidencias: [],
          documentos: [],
          informacoesAusentes: [],
          limitacoes: [],
          erros: [{ codigo: 'erro_interno', mensagem: (e as Error)?.message ?? 'erro' }],
          metricas: {
            duracaoMs: Date.now() - iniciadaEm,
            passos: 0,
            chamadasDeFerramenta: 0,
            uso: { entrada: 0, saida: 0 },
          },
        };
      } finally {
        clearTimeout(relogio);
        p.sinal?.removeEventListener('abort', aoCancelar);
      }

      try {
        await deps.armazenamento.gravarExecucao(
          montarRegistro(
            tarefa,
            iniciadaEm,
            resultado,
            eventos,
            orcamento.uso,
            orcamento.passos,
          ),
        );
      } catch {
        resultado = {
          ...resultado,
          limitacoes: [
            ...resultado.limitacoes,
            'O registro desta execução não foi gravado.',
          ],
        };
      }
      return { ...resultado, execucaoId };
    },
  };
}

export type Orquestrador = ReturnType<typeof criarOrquestrador>;
