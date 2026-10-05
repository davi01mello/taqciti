/**
 * Os PRODUTORES de aviso — onde um evento real vira um aviso.
 *
 * Cada produtor olha o estado de verdade (os registros de trabalho, a sessão de
 * captura, o resultado de uma execução do Taq) e devolve o que deve estar
 * avisado AGORA. A diferença para o que já está gravado é feita pelo store:
 * o que continua valendo é atualizado sem repetir, o que deixou de valer é
 * resolvido, e o que a pessoa dispensou continua dispensado.
 *
 * Mensagens em linguagem simples; nome de agente, ferramenta e código de erro
 * vão em `tecnico`, que a interface recolhe.
 */
import type { MeetingPhase, MeetingSessionState } from '@/shared/types/domain';
import type { Trabalho } from '@/features/trabalho/store';
import {
  emitirAviso,
  lerAvisos,
  resolverAvisos,
  type NovoAviso,
} from './store';

const PREFIXOS_DO_ACOMPANHAMENTO = ['revisar:', 'semresp:', 'prazo:'] as const;

function curto(texto: string, max = 90): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

// ------------------------------------------------------------ acompanhamento

/**
 * O que o acompanhamento pede à pessoa, hoje:
 *
 *   - candidato extraído da legenda → "aguardando revisão";
 *   - tarefa aceita sem responsável → "sem responsável";
 *   - prazo escrito sem data → "prazo a esclarecer".
 *
 * Só compromissos abertos. Concluído ou cancelado não pede nada, e um item
 * sem reunião de origem (registrado à mão) não gera "prazo a esclarecer": ali
 * quem escreveu o prazo foi a pessoa.
 */
export function avisosDesejadosDoAcompanhamento(t: Pick<Trabalho, 'compromissos'>): NovoAviso[] {
  const saida: NovoAviso[] = [];
  for (const c of t.compromissos) {
    if (c.estado !== 'aberto') continue;
    const base = {
      origem: 'acompanhamento' as const,
      publico: 'organizador' as const,
      ...(c.reuniaoId ? { reuniaoId: c.reuniaoId } : {}),
      operacao: 'acompanhamento',
      acao: { tipo: 'abrir_acompanhamento' as const, alvoId: c.id, rotulo: 'Revisar' },
    };
    if (c.situacao === 'candidato') {
      saida.push({
        ...base,
        chave: `revisar:${c.id}`,
        status: 'aguardando',
        titulo: `Item aguardando revisão: “${curto(c.descricao)}”`,
        detalhe:
          'O Taq encontrou este combinado na transcrição. Confirme, corrija ou exclua; ' +
          'até lá ele não conta como registro aceito.',
      });
      continue;
    }
    if (!c.responsavel) {
      saida.push({
        ...base,
        chave: `semresp:${c.id}`,
        status: 'aguardando',
        titulo: `Tarefa sem responsável: “${curto(c.descricao)}”`,
        detalhe: 'Ninguém foi nomeado para esta tarefa na reunião. Defina o responsável.',
        acao: { ...base.acao, rotulo: 'Definir responsável' },
      });
    }
    if (c.reuniaoId && c.prazo && !c.prazo.data) {
      saida.push({
        ...base,
        chave: `prazo:${c.id}`,
        status: 'aguardando',
        titulo: `Prazo a esclarecer: “${curto(c.prazo.texto, 40)}”`,
        detalhe: `Na tarefa “${curto(c.descricao)}” o prazo foi dito, mas não é uma data. Informe o dia.`,
        acao: { ...base.acao, rotulo: 'Completar' },
      });
    }
  }
  return saida;
}

/**
 * Leva os avisos do acompanhamento ao estado atual: emite o que vale e
 * resolve o que deixou de valer (tarefa que ganhou responsável, item revisado,
 * compromisso excluído).
 */
export async function sincronizarAvisosDoAcompanhamento(
  t: Pick<Trabalho, 'compromissos'>,
): Promise<{ emitidos: number; resolvidos: number }> {
  const desejados = avisosDesejadosDoAcompanhamento(t);
  let emitidos = 0;
  for (const d of desejados) {
    const r = await emitirAviso(d);
    if (r.novo) emitidos += 1;
  }
  const vivas = new Set(desejados.map((d) => d.chave));
  const obsoletas = (await lerAvisos())
    .filter(
      (a) =>
        a.origem === 'acompanhamento' &&
        !a.resolvido &&
        PREFIXOS_DO_ACOMPANHAMENTO.some((p) => a.chave.startsWith(p)) &&
        !vivas.has(a.chave),
    )
    .map((a) => a.chave);
  const resolvidos = obsoletas.length ? await resolverAvisos(obsoletas) : 0;
  return { emitidos, resolvidos };
}

// ------------------------------------------------------------------- captura

type SessaoParaAviso = Pick<MeetingSessionState, 'meetingId' | 'title' | 'captureHealthy'>;

/**
 * "A captura parou de ler as legendas" — enquanto for verdade. Voltou a ler, ou
 * a reunião acabou: o aviso é resolvido (o que já tinha sido transcrito
 * continua guardado, e o aviso diz isso).
 */
export async function sincronizarAvisoDeCaptura(
  sessao: SessaoParaAviso | null,
  fase: MeetingPhase,
): Promise<void> {
  if (!sessao) return;
  const chave = `captura:${sessao.meetingId}:interrompida`;
  if (fase === 'recording' && sessao.captureHealthy === false) {
    await emitirAviso({
      chave,
      origem: 'captura',
      publico: 'todos',
      status: 'falhou',
      reuniaoId: sessao.meetingId,
      operacao: 'captura',
      titulo: 'A captura parou de ler as legendas do Meet',
      detalhe:
        'O TaqCiti está tentando religar sozinho. O que já foi transcrito continua guardado; ' +
        'o trecho que passou nesse intervalo pode ficar como lacuna.',
      acao: { tipo: 'abrir_reuniao', alvoId: sessao.meetingId, rotulo: 'Abrir reunião' },
    });
  } else {
    await resolverAvisos([chave]);
  }
}

// --------------------------------------------------------- documento e captura

export interface DocumentoPronto {
  id: string;
  titulo: string;
  reuniaoId?: string;
  acao: 'criado' | 'atualizado';
  /** O evento: dois documentos salvos em execuções diferentes são dois avisos. */
  execucaoId: string;
}

export function avisoDeDocumentoPronto(d: DocumentoPronto): NovoAviso {
  return {
    chave: `documento:${d.id}:${d.execucaoId}`,
    origem: 'documento',
    publico: 'todos',
    status: 'concluido',
    ...(d.reuniaoId ? { reuniaoId: d.reuniaoId } : {}),
    operacao: d.acao === 'criado' ? 'create_document' : 'update_document',
    titulo: `${d.acao === 'criado' ? 'O documento foi salvo' : 'O documento foi atualizado'}: “${curto(d.titulo, 60)}”`,
    acao: { tipo: 'abrir_documento', alvoId: d.id, rotulo: 'Abrir' },
  };
}

/** Uma captura de tela guardada com a reunião. */
export function avisoDeCapturaPronta(p: {
  id: string;
  reuniaoId: string;
  titulo?: string;
}): NovoAviso {
  return {
    chave: `captura-de-tela:${p.id}`,
    origem: 'captura',
    publico: 'todos',
    status: 'concluido',
    reuniaoId: p.reuniaoId,
    operacao: 'capture_screen',
    titulo: 'A captura está pronta',
    ...(p.titulo ? { detalhe: p.titulo } : {}),
    acao: { tipo: 'abrir_reuniao', alvoId: p.reuniaoId, rotulo: 'Ver' },
  };
}

// ------------------------------------------------------- execução do Taq

/** O que interessa do resultado de uma execução (compatível com `ExecucaoDoTaq`). */
export interface ExecucaoParaAviso {
  execucaoId: string;
  estado: string;
  documentos: { id: string; titulo: string; acao: 'criado' | 'atualizado' }[];
  pergunta?: { motivo: string } | null;
  informacoesAusentes: string[];
  erros: { codigo: string }[];
  cartoes?: unknown[];
  operacoes?: { ok: boolean }[];
}

/**
 * Os avisos que a execução produziu — só do que ela de fato fez ou deixou de
 * fazer. `cancelado` não gera nenhum: foi a pessoa quem parou.
 */
export function avisosDaExecucao(
  r: ExecucaoParaAviso,
  contexto: { conversaId: string; reuniaoId?: string; desfecho: string },
): NovoAviso[] {
  const saida: NovoAviso[] = [];
  const reuniao = contexto.reuniaoId ? { reuniaoId: contexto.reuniaoId } : {};
  const abrirConversa = {
    tipo: 'abrir_conversa' as const,
    alvoId: contexto.conversaId,
    rotulo: 'Abrir conversa',
  };

  for (const d of r.documentos) {
    saida.push(
      avisoDeDocumentoPronto({
        id: d.id,
        titulo: d.titulo,
        acao: d.acao,
        execucaoId: r.execucaoId,
        ...(contexto.reuniaoId ? { reuniaoId: contexto.reuniaoId } : {}),
      }),
    );
  }

  if (r.pergunta) {
    saida.push({
      chave: `pergunta:${contexto.conversaId}`,
      origem: 'operacao',
      publico: 'todos',
      status: 'aguardando',
      ...reuniao,
      titulo: 'O Taq precisa de uma informação para continuar',
      detalhe: r.pergunta.motivo,
      tecnico: 'ask_user',
      acao: abrirConversa,
    });
  } else if (r.informacoesAusentes.length && r.estado !== 'cancelado') {
    saida.push({
      chave: `bloqueada:${r.execucaoId}`,
      origem: 'operacao',
      publico: 'todos',
      status: 'aguardando',
      ...reuniao,
      titulo: 'Uma operação ficou esperando informação',
      detalhe: r.informacoesAusentes.join(' '),
      acao: abrirConversa,
    });
  }

  const falhou = ['falhou', 'tempo_esgotado', 'limite_atingido'].includes(r.estado);
  if (falhou) {
    const preservou = r.documentos.length > 0 || (r.cartoes?.length ?? 0) > 0;
    saida.push({
      chave: `execucao:${r.execucaoId}`,
      origem: 'operacao',
      publico: 'todos',
      status: preservou ? 'parcial' : 'falhou',
      ...reuniao,
      titulo: preservou
        ? 'A operação parou no meio. O que já foi feito foi preservado'
        : 'O pedido não pôde ser concluído',
      detalhe: contexto.desfecho,
      tecnico: r.erros.map((e) => e.codigo).join(', ') || r.estado,
      acao: abrirConversa,
    });
  }
  return saida;
}

/** Emite os avisos de uma execução. Nunca lança: aviso não pode quebrar a resposta. */
export async function emitirAvisosDaExecucao(
  r: ExecucaoParaAviso,
  contexto: { conversaId: string; reuniaoId?: string; desfecho: string },
): Promise<void> {
  try {
    if (r.estado === 'cancelado') return;
    for (const a of avisosDaExecucao(r, contexto)) await emitirAviso(a);
  } catch {
    // Sem aviso, a resposta continua gravada na conversa.
  }
}

/** A pessoa respondeu: a pergunta pendente da conversa deixou de estar pendente. */
export async function resolverPerguntaDaConversa(conversaId: string): Promise<void> {
  try {
    await resolverAvisos([`pergunta:${conversaId}`]);
  } catch {
    // idem
  }
}
