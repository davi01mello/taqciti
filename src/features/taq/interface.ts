/**
 * InterfaceAdapter — liga o Taq às telas que já existem (HOME e sidebar).
 *
 * As duas telas continuam donas do que já eram donas: gravar a mensagem da
 * pessoa (`acrescentarMensagem`), mostrar a conversa, o rascunho, o contexto
 * anexado. Este módulo acrescenta três coisas:
 *
 *   - `useDisponibilidadeDoTaq`: o servidor está pronto? Perguntado ANTES de a
 *     pessoa escrever, para "configuração pendente" aparecer antes da pergunta;
 *   - `perguntarAoTaq`: roda uma execução, anuncia as etapas na atividade do
 *     agente (`features/agent/atividade.ts`) e grava a resposta real;
 *   - `cancelarTaq`: o botão de parar.
 *
 * ── Onde a execução mora ────────────────────────────────────────────────────
 *
 * Na página que a iniciou. Fechar a HOME no meio de uma resposta cancela a
 * execução junto (a requisição ao servidor morre com a página); a pergunta já
 * estava gravada e continua na conversa, sem resposta — nada fica pela metade
 * no histórico.
 */
import { useCallback, useEffect, useState } from 'react';
import { publicarAtividade, publicarEtapa } from '@/features/agent/atividade';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange } from '@/shared/services/storage';
import { logger } from '@/shared/services/log';
import {
  acrescentarResposta,
  lembrarRegistros,
  lerConversas,
  type ContextoDaPergunta,
  type Conversation,
  type FonteDaResposta,
} from '@/home/conversations';
import { registrosUsados } from './memoria';
import type { RegistroSelecionado } from './contratos';
import { armazenamentoLocal } from './armazenamento';
import { restaurarDaLixeira } from './lixeira';
import { criarAdaptadorHttp, ErroDoModelo, type AdaptadorHttp } from './modelo';
import {
  criarOrquestrador,
  type ExecucaoDoTaq,
  type Orquestrador,
  type ResultadoDaConfirmacao,
} from './orquestrador';
import type { AcoesDaInterface, EventoDeExecucao } from './tipos';

// ------------------------------------------------------------ disponibilidade

export type DisponibilidadeDoTaq =
  | { fase: 'verificando' }
  | { fase: 'pronto'; provedor: string; modelo: string }
  | { fase: 'pendente'; motivos: string[] }
  | { fase: 'inalcancavel'; motivo: string };

let adaptador: AdaptadorHttp | null = null;
let orquestrador: Orquestrador | null = null;

function obterAdaptador(): AdaptadorHttp {
  adaptador ??= criarAdaptadorHttp();
  return adaptador;
}

function obterOrquestrador(): Orquestrador {
  orquestrador ??= criarOrquestrador({
    modelo: obterAdaptador(),
    armazenamento: armazenamentoLocal,
  });
  return orquestrador;
}

/** Só para testes: troca o adaptador e o orquestrador. */
export function _definirTaq(novo: {
  adaptador?: AdaptadorHttp | null;
  orquestrador?: Orquestrador | null;
}): void {
  if ('adaptador' in novo) adaptador = novo.adaptador ?? null;
  if ('orquestrador' in novo) orquestrador = novo.orquestrador ?? null;
}

export async function verificarTaq(sinal?: AbortSignal): Promise<DisponibilidadeDoTaq> {
  try {
    const estado = await obterAdaptador().estado(sinal);
    if (!estado.pronto || !estado.provedor || !estado.modelo) {
      // As pendências do servidor falam em variável de ambiente e chave de
      // provedor: são para quem opera o servidor, e vão para o log.
      logger.warn(`assistente sem configuração no servidor: ${estado.pendencias.join(' ') || 'sem provedor'}`);
      return {
        fase: 'pendente',
        motivos: ['O assistente ainda não está configurado no servidor. Se continuar, avise quem cuida do TaqCiti.'],
      };
    }
    // Mesma regra das rotas de geração: chave de treinamento não recebe
    // registro real. O servidor recusaria de qualquer jeito; dizer antes
    // poupa a pessoa de descobrir pela falha.
    if (estado.politicaDeDados === 'training') {
      return {
        fase: 'pendente',
        motivos: [
          'A chave de IA do servidor pode usar o conteúdo enviado para treinar o provedor. ' +
            'Enquanto for assim, o Taq não envia reuniões e documentos reais.',
        ],
      };
    }
    return { fase: 'pronto', provedor: estado.provedor, modelo: estado.modelo };
  } catch (e) {
    if (e instanceof ErroDoModelo && e.codigo === 'nao_autorizado') {
      return {
        fase: 'pendente',
        motivos: ['O servidor não reconheceu esta versão da extensão. Atualize o TaqCiti.'],
      };
    }
    return {
      fase: 'inalcancavel',
      motivo: e instanceof Error ? e.message : 'Servidor inalcançável.',
    };
  }
}

/** A disponibilidade, perguntada ao montar. `verificarDeNovo` repete a pergunta. */
export function useDisponibilidadeDoTaq(): [DisponibilidadeDoTaq, () => void] {
  const [estado, setEstado] = useState<DisponibilidadeDoTaq>({ fase: 'verificando' });
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    const controle = new AbortController();
    setEstado({ fase: 'verificando' });
    void verificarTaq(controle.signal).then((r) => {
      if (!controle.signal.aborted) setEstado(r);
    });
    return () => controle.abort();
  }, [tentativa]);
  const verificarDeNovo = useCallback(() => setTentativa((v) => v + 1), []);
  return [estado, verificarDeNovo];
}

// ------------------------------------------------------------------ execução

let emCurso: AbortController | null = null;

export function cancelarTaq(): void {
  emCurso?.abort();
}

/**
 * O botão "Desfazer" de uma exclusão feita pelo Taq. Direto na lixeira, sem
 * modelo no meio: desfazer não é pedido a interpretar, é o inverso exato do que
 * a ferramenta fez.
 */
export async function desfazerExclusao(meetingId: string, acoes: AcoesDaInterface): Promise<boolean> {
  const r = await restaurarDaLixeira(meetingId, acoes.enviar);
  return r.ok;
}

/**
 * O botão "Enviar" / "Marcar" / "Remarcar" / "Cancelar o evento" de um cartão:
 * a pessoa confirma o rascunho guardado. Sem modelo no meio — é um CLIQUE, e é
 * isso (e só isso) que o código aceita como confirmação. O desfecho vira uma
 * mensagem do Taq na conversa, com o cartão do resultado.
 *
 * Nunca lança: falha vira `ok: false` com o motivo, para o botão mostrar.
 */
export async function confirmarAcaoDoTaq(p: {
  conversaId: string;
  chave: string;
  repetir?: boolean;
  acoes?: AcoesDaInterface;
}): Promise<ResultadoDaConfirmacao> {
  let r: ResultadoDaConfirmacao;
  try {
    r = await obterOrquestrador().confirmarAcao(p);
  } catch (e) {
    return {
      execucaoId: '',
      ok: false,
      cartoes: [],
      erro: { codigo: 'erro_interno', mensagem: (e as Error)?.message ?? 'erro' },
      texto: 'Não foi feito: a confirmação falhou antes de chegar ao Google.',
    };
  }
  // Só o desfecho real vai para a conversa; recusa antes de agir fica no botão.
  if (r.cartoes.length)
    await acrescentarResposta(p.conversaId, {
      text: r.texto,
      desfecho: 'concluido',
      ...(r.execucaoId ? { execucaoId: r.execucaoId } : {}),
      cartoes: r.cartoes,
    }).catch(() => undefined);
  return r;
}

/** A etapa que a interface mostra para cada evento. */
function etapaDo(evento: EventoDeExecucao): string | null {
  switch (evento.tipo) {
    case 'modelo':
      return evento.passo === 1 ? 'Entendendo o pedido' : 'Analisando o que encontrou';
    case 'ferramenta_inicio':
      return evento.etapa;
    case 'delegacao':
      return evento.estado === 'iniciada' ? 'Consultando um especialista' : null;
    default:
      return null;
  }
}

const MOTIVO_EM_PALAVRAS: Record<string, string> = {
  cancelado: 'Interrompido: você cancelou.',
  tempo_esgotado:
    'Interrompido: a resposta passou do tempo máximo. Tente um pedido mais curto, ou de novo em instantes.',
  limite_atingido:
    'Interrompido: o pedido precisou de passos demais. Tente dividi-lo em partes menores.',
};

const AVISE = 'Se continuar, avise quem cuida do TaqCiti.';

/**
 * Uma frase para o desfecho que NÃO gerou resposta.
 *
 * Cada uma diz o que a pessoa pode fazer — esperar um minuto, esperar até
 * amanhã, encurtar o pedido, abrir outra conversa, ou avisar alguém —, porque
 * "a resposta não pôde ser produzida" não deixava escolher nenhuma dessas.
 */
export function mensagemDoDesfecho(r: ExecucaoDoTaq): string {
  if (MOTIVO_EM_PALAVRAS[r.estado]) return MOTIVO_EM_PALAVRAS[r.estado]!;
  const erro = r.erros[0];
  switch (erro?.codigo) {
    case 'configuracao_pendente':
      return `Não consegui responder: o assistente ainda não está configurado no servidor. ${AVISE}`;
    case 'politica_de_dados':
      return `Não consegui responder: o servidor está numa configuração de testes, que não aceita reuniões e documentos reais. ${AVISE}`;
    case 'servidor_inalcancavel':
      return 'Não consegui responder: o servidor do TaqCiti não respondeu. Confira a internet e tente de novo.';
    case 'limite_do_provedor':
      // O servidor marca a cota POR MINUTO como transitória; a do dia, não.
      return erro.transitorio
        ? 'Não consegui responder: o provedor de IA está com muitas chamadas agora. Tente de novo em um minuto.'
        : 'Não consegui responder: a cota do dia do provedor de IA acabou. Ela reabre amanhã.';
    case 'provedor_sobrecarregado':
      return 'Não consegui responder: o provedor de IA está sobrecarregado. Tente de novo em instantes.';
    case 'provedor_lento':
      return 'Não consegui responder: o provedor de IA demorou demais. Tente de novo.';
    case 'contexto_grande_demais':
      return 'Não consegui responder: esta conversa ficou longa demais. Comece uma conversa nova para continuar.';
    case 'nao_autorizado':
      return `Não consegui responder: o servidor não reconheceu esta versão da extensão. Atualize o TaqCiti. ${AVISE}`;
    case 'pedido_invalido':
      return `Não consegui responder: o servidor não aceitou o pedido — a extensão e o servidor podem estar em versões diferentes. ${AVISE}`;
    case 'ocupado':
      return 'O assistente ainda está respondendo a pergunta anterior. Sua mensagem ficou na conversa: envie de novo quando ele terminar.';
    case 'erro_interno':
      return 'Não consegui gravar a resposta. Sua mensagem ficou na conversa: envie de novo.';
    default:
      return 'Não consegui responder desta vez. Sua mensagem ficou na conversa: tente de novo.';
  }
}

const VERBO_DA_OPERACAO = {
  abrir: 'abriu',
  renomear: 'renomeou para',
  apagar: 'apagou',
  restaurar: 'restaurou',
  exportar: 'exportou a transcrição de',
  preparar_copia: 'preparou para copiar',
  baixar: 'baixou',
  contexto: 'mexeu no contexto com',
} as const;

function fontesDe(r: ExecucaoDoTaq): FonteDaResposta[] {
  return r.evidencias.map((e) => ({
    ref: e.id,
    tipo: e.tipo,
    registroId: e.registroId,
    titulo: e.titulo,
    trecho: e.trecho.length > 280 ? `${e.trecho.slice(0, 279)}…` : e.trecho,
    ...(e.local.segmento !== undefined ? { segmento: e.local.segmento } : {}),
    ...(e.local.offsetMs !== undefined ? { offsetMs: e.local.offsetMs } : {}),
    ...(e.sustenta ? { sustenta: e.sustenta } : {}),
  }));
}

export interface PerguntaAoTaq {
  /** A conversa em que a pergunta JÁ FOI gravada (por `acrescentarMensagem`). */
  conversaId: string;
  texto: string;
  contexto?: ContextoDaPergunta | null;
  /** O que esta tela sabe fazer — abrir registros, falar com o background. */
  acoes?: AcoesDaInterface;
}

/**
 * Roda o Taq sobre a última mensagem da conversa e grava a resposta.
 *
 * Devolve o resultado para a tela mostrar o desfecho. Nunca lança: falha vira
 * resultado `falhou`, e a atividade do agente diz isso.
 */
export async function perguntarAoTaq(p: PerguntaAoTaq): Promise<ExecucaoDoTaq | null> {
  // Ocupado: a mensagem JÁ está gravada na conversa e ficaria sem resposta e sem
  // aviso. Devolve um desfecho que a tela diz (e NÃO publica atividade: isso
  // atropelaria a execução que está em curso).
  if (emCurso) return execucaoSemResposta('ocupado', 'O assistente já está respondendo outra pergunta.');
  const controle = new AbortController();
  emCurso = controle;
  publicarAtividade('preparando');
  publicarEtapa('Preparando');
  /*
   * A conversa apagada no meio (por esta tela, por outra aba, pela sidebar ou
   * pelo próprio Taq): a execução para. O que já chegou não é gravado —
   * `acrescentarResposta` e `lembrarRegistros` não escrevem em conversa que não
   * existe —, e parar poupa o resto das chamadas ao modelo.
   */
  const pararDeObservar = onLocalChange<Conversation[]>(STORAGE_KEYS.conversations, (valor) => {
    if (Array.isArray(valor) && !valor.some((c) => c?.id === p.conversaId)) controle.abort();
  });

  try {
    const conversa = (await lerConversas()).find((c) => c.id === p.conversaId);
    const mensagens = conversa?.messages ?? [];
    // A última é a pergunta que acabou de ser gravada; o resto é histórico.
    const anteriores =
      mensagens.at(-1)?.role === 'user' ? mensagens.slice(0, -1) : mensagens;
    // A última resposta do Taq foi uma pergunta? Então esta mensagem a responde.
    const continua =
      anteriores.at(-1)?.role === 'assistant'
        ? anteriores.at(-1)?.pergunta?.motivo
        : undefined;

    const selecionados: RegistroSelecionado[] = [];
    if (p.contexto?.meetingId) {
      selecionados.push({
        tipo: 'reuniao',
        id: p.contexto.meetingId,
        ...(p.contexto.excerpt ? { trecho: p.contexto.excerpt } : {}),
        ...(p.contexto.captionId ? { captionId: p.contexto.captionId } : {}),
      });
    } else if (conversa?.meetingId) {
      selecionados.push({ tipo: 'reuniao', id: conversa.meetingId });
    }
    // O documento de que a última resposta falava: é ele que "atualize" quer dizer.
    const ultimaDoTaq = anteriores.at(-1)?.role === 'assistant' ? anteriores.at(-1) : undefined;
    for (const d of ultimaDoTaq?.documentos ?? []) selecionados.push({ tipo: 'documento', id: d.id });

    const r = await obterOrquestrador().executar({
      conversaId: p.conversaId,
      ...(conversa?.meetingId ? { meetingId: conversa.meetingId } : {}),
      texto: p.texto,
      ...(continua ? { continua } : {}),
      anteriores,
      selecionados,
      ...(p.acoes ? { acoes: p.acoes } : {}),
      sinal: controle.signal,
      aoEvento: (e) => {
        const etapa = etapaDo(e);
        if (etapa) publicarEtapa(etapa);
      },
    });

    const comum = {
      execucaoId: r.execucaoId,
      ...(r.documentos.length
        ? {
            documentos: r.documentos.map((d) => ({
              id: d.id,
              titulo: d.titulo,
              acao: d.acao,
            })),
          }
        : {}),
      ...(r.limitacoes.length ? { limitacoes: r.limitacoes } : {}),
      ...(r.informacoesAusentes.length ? { emAberto: r.informacoesAusentes } : {}),
      ...(r.operacoes?.length ? { operacoes: r.operacoes } : {}),
      // Os cartões ficam mesmo se a execução parou depois: o que a ferramenta
      // registrou aconteceu, e o cartão é como a pessoa chega até ele.
      ...(r.cartoes?.length ? { cartoes: r.cartoes } : {}),
    };

    if (r.resposta && (r.estado === 'concluido' || r.estado === 'parcial')) {
      await acrescentarResposta(p.conversaId, {
        ...comum,
        text: r.resposta,
        fontes: fontesDe(r),
        desfecho: r.estado,
        ...(r.pergunta
          ? { pergunta: { motivo: r.pergunta.motivo, opcoes: r.pergunta.opcoes } }
          : {}),
        ...(r.textoCopiavel ? { copiavel: r.textoCopiavel } : {}),
      });
    } else if (r.documentos.length || r.operacoes?.some((o) => o.ok) || r.cartoes?.length) {
      // Parou sem responder, mas uma ferramenta já tinha agido: o registro diz
      // o que as ferramentas CONFIRMARAM, e nada além disso.
      const feitos = [
        ...r.documentos.map(
          (d) => `${d.acao === 'criado' ? 'criou' : 'atualizou'} o documento “${d.titulo}”`,
        ),
        ...(r.operacoes ?? [])
          .filter((o) => o.ok)
          .map((o) => `${VERBO_DA_OPERACAO[o.acao]} “${o.titulo}”`),
      ];
      await acrescentarResposta(p.conversaId, {
        ...comum,
        text: feitos.length
          ? `${mensagemDoDesfecho(r)} Antes de parar, o Taq ${feitos.join(' e ')}.`
          : `${mensagemDoDesfecho(r)} O que já tinha sido preparado está abaixo.`,
        desfecho: 'interrompido',
      });
    }

    // A memória da conversa: o que esta resposta usou vira o foco da próxima.
    await lembrarRegistros(p.conversaId, registrosUsados(r)).catch(() => undefined);

    publicarAtividade(
      r.estado === 'concluido' || r.estado === 'parcial'
        ? 'concluido'
        : r.estado === 'cancelado'
          ? 'cancelado'
          : r.estado === 'tempo_esgotado' || r.estado === 'limite_atingido'
            ? 'interrompido'
            : 'falhou',
    );
    return r;
  } catch {
    publicarAtividade('falhou');
    return execucaoSemResposta('erro_interno', 'A execução falhou antes de gravar a resposta.');
  } finally {
    pararDeObservar();
    if (emCurso === controle) emCurso = null;
  }
}

/** Um desfecho "falhou" sem execução de verdade: a tela o diz pelo mesmo caminho dos demais. */
function execucaoSemResposta(codigo: string, mensagem: string): ExecucaoDoTaq {
  return {
    execucaoId: '',
    estado: 'falhou',
    evidencias: [],
    documentos: [],
    informacoesAusentes: [],
    limitacoes: [],
    erros: [{ codigo, mensagem }],
    metricas: { duracaoMs: 0, passos: 0, chamadasDeFerramenta: 0, uso: { entrada: 0, saida: 0 } },
  };
}
