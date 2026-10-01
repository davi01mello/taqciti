/**
 * As ferramentas do `app_assistant` — operações que o aplicativo JÁ FAZ, pelos
 * mesmos caminhos que a interface usa:
 *
 *   open_meeting       a navegação da HOME (ou `ui/openHome`, na sidebar)
 *   open_document      idem
 *   rename_meeting     `ui/history/rename`, o mesmo do campo "Nome da reunião"
 *   delete_meeting     `ui/history/delete`, o mesmo de "Apagar reunião" — com a
 *                      mesma regra: leva nota, marcações e prints; documentos
 *                      ficam sem vínculo; recusado com a captura em andamento
 *   restore_meeting    a lixeira do Taq (`lixeira.ts`) + `ui/history/restore`
 *   delete_conversation `apagarConversas`, a mesma exclusão da tela (sem lixeira)
 *   export_transcript  `downloadTranscript`, o mesmo "Baixar .txt"
 *   get_app_capabilities  o mapa de `ajuda.ts` cruzado com o registro de ferramentas
 *   get_usage_guide       os passos verificados de `ajuda.ts`
 *
 * ── O alvo ───────────────────────────────────────────────────────────────────
 *
 * A pessoa diz "a reunião comercial", "essa reunião", "a última". Quem traduz
 * isso num id é `resolverReuniao`, em CÓDIGO: id exato, "atual"/"essa" (a
 * reunião da conversa), "última", ou o título. Mais de um título casando NÃO
 * para o fluxo: vence o mais recente, e os outros voltam em `tambem_casavam`
 * para o agente dizer qual usou.
 *
 * ── Apagar ───────────────────────────────────────────────────────────────────
 *
 * Sem pedir confirmação — e por isso com volta: antes do `ui/history/delete`,
 * o retrato da reunião vai para a lixeira do Taq (`lixeira.ts`), por 30 dias.
 * `restore_meeting` e o botão "Desfazer" devolvem tudo. Quem autoriza apagar é
 * o pedido da pessoa (a política só oferece a ferramenta quando ela pede); uma
 * frase numa transcrição não chega a esta ferramenta.
 */
import { z } from 'zod/v4';
import type { MeetingRecord } from '@/shared/types/domain';
import type { DocumentoGuardado } from '@/features/documents/store';
import { downloadTranscript } from '@/features/history/export';
import { ASSUNTOS, capacidadesDoApp, guiaDeUso } from './ajuda';
import { FERRAMENTAS_BASE } from './ferramentas';
import {
  DIAS_NA_LIXEIRA,
  descartarDaLixeira,
  guardarNaLixeira,
  lerLixeira,
  restaurarDaLixeira,
} from './lixeira';
import { normalizar, termosDe } from './busca';
import {
  exigirDocumento,
  exigirReuniao,
  podeLerConversa,
  podeLerDocumento,
  podeLerReuniao,
} from './politica';
import {
  ErroDeFerramenta,
  type ContextoDeFerramenta,
  type DefinicaoDeFerramenta,
} from './tipos';

function dataBr(ms: number): string {
  return new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

const REFERENCIA =
  'O id, "atual" (a reunião desta conversa), "ultima" (a mais recente) ou o nome como a pessoa disse.';

/** Quem casa com um nome: todas as palavras dele aparecem no título. */
function casaNome<T extends { title: string }>(lista: readonly T[], nome: string): T[] {
  const termos = termosDe(nome);
  if (!termos.length) return [];
  const exatos = lista.filter((x) => normalizar(x.title) === normalizar(nome));
  if (exatos.length) return exatos;
  return lista.filter((x) => {
    const t = normalizar(x.title);
    return termos.every((termo) => t.includes(termo));
  });
}

/**
 * O alvo resolvido, e os outros que também casavam.
 *
 * Mais de um registro casando com o nome NÃO para o fluxo: vence o mais
 * recente, e os demais voltam em `outras` para o agente dizer qual usou e
 * oferecer a troca. Parar para perguntar era a intervenção que o fluxo não
 * quer — e errar aqui tem volta (renomear de novo; apagar vai para a lixeira).
 */
export interface Alvo<T> {
  registro: T;
  outras: Array<{ id: string; titulo: string; data: string }>;
}

function maisRecente<T extends { id: string; title: string }>(
  lista: T[],
  data: (x: T) => number,
): Alvo<T> {
  const ordenada = [...lista].sort((a, b) => data(b) - data(a));
  return {
    registro: ordenada[0]!,
    outras: ordenada
      .slice(1, 6)
      .map((x) => ({ id: x.id, titulo: x.title, data: dataBr(data(x)) })),
  };
}

export async function resolverReuniao(
  ref: string,
  ctx: ContextoDeFerramenta,
): Promise<Alvo<MeetingRecord>> {
  const { escopo } = ctx.tarefa;
  const todas = (await ctx.armazenamento.listarReunioes()).filter((r) =>
    podeLerReuniao(escopo, r.id),
  );
  const r = normalizar(ref);
  const unica = (registro: MeetingRecord): Alvo<MeetingRecord> => ({
    registro,
    outras: [],
  });

  const porId = todas.find((x) => x.id === ref.trim());
  if (porId) return unica(porId);

  if (['atual', 'essa', 'esta', 'essa reuniao', 'esta reuniao'].includes(r)) {
    const alvo =
      ctx.tarefa.selecionados.find((s) => s.tipo === 'reuniao')?.id ??
      (escopo.reunioes !== 'todas' ? escopo.reunioes[0] : undefined);
    const achada = alvo ? todas.find((x) => x.id === alvo) : undefined;
    if (achada) return unica(achada);
    // Depois da tela, o foco da conversa: a reunião de que ela vinha falando.
    const foco = ctx.tarefa.foco?.tipo === 'reuniao' ? todas.find((x) => x.id === ctx.tarefa.foco!.id) : undefined;
    // Sem nenhum dos dois, "essa" é a mais recente — dito no resultado.
    if (foco) return unica(foco);
  }

  if (!todas.length)
    throw new ErroDeFerramenta('nao_encontrado', 'Não há reuniões guardadas.');
  if (
    /^(a )?ultima( reuniao)?$|^(a )?mais recente$|^(atual|essa|esta)( reuniao)?$/.test(r)
  ) {
    return { ...maisRecente(todas, (x) => x.startedAt), outras: [] };
  }

  const casam = casaNome(todas, ref);
  if (casam.length) return maisRecente(casam, (x) => x.startedAt);
  throw new ErroDeFerramenta(
    'nao_encontrado',
    `Nenhuma reunião no escopo casa com "${ref}". Use search_records para procurar por conteúdo.`,
  );
}

async function resolverDocumento(
  ref: string,
  ctx: ContextoDeFerramenta,
): Promise<Alvo<DocumentoGuardado>> {
  const todos = (await ctx.armazenamento.listarDocumentos()).filter((d) =>
    podeLerDocumento(ctx.tarefa.escopo, d),
  );
  const porId = todos.find((d) => d.id === ref.trim());
  if (porId) return { registro: porId, outras: [] };
  if (!todos.length)
    throw new ErroDeFerramenta('nao_encontrado', 'Não há documentos guardados.');
  if (/^(o )?ultimo( documento)?$|^(o )?mais recente$/.test(normalizar(ref))) {
    return { ...maisRecente(todos, (d) => d.updatedAt), outras: [] };
  }
  const casam = casaNome(todos, ref);
  if (casam.length) return maisRecente(casam, (d) => d.updatedAt);
  throw new ErroDeFerramenta(
    'nao_encontrado',
    `Nenhum documento no escopo casa com "${ref}".`,
  );
}

/** O que acompanha o resultado quando o nome casava com mais de um registro. */
function alternativas(outras: Alvo<unknown>['outras']) {
  return outras.length
    ? {
        tambem_casavam: outras,
        aviso: 'Usei o mais recente. Diga à pessoa qual foi, e que ela pode pedir outro.',
      }
    : {};
}
function exigirTela(ctx: ContextoDeFerramenta) {
  if (!ctx.acoes) {
    throw new ErroDeFerramenta(
      'acao_indisponivel',
      'Esta execução não tem uma tela para abrir ou baixar coisas.',
    );
  }
  return ctx.acoes;
}

/** O background responde `{ ok: true }` ou `{ ok: false, error }`. */
function respostaOk(r: unknown): {
  ok: boolean;
  erro?: string;
  limpeza?: Record<string, unknown>;
} {
  if (r && typeof r === 'object' && 'ok' in r) {
    const x = r as { ok: unknown; error?: unknown; limpeza?: Record<string, unknown> };
    return {
      ok: x.ok === true,
      ...(typeof x.error === 'string' ? { erro: x.error } : {}),
      ...(x.limpeza ? { limpeza: x.limpeza } : {}),
    };
  }
  return { ok: false, erro: 'sem_resposta' };
}

// ----------------------------------------------------------------- abrir

const reuniaoSchema = z.object({ reuniao: z.string().min(1).describe(REFERENCIA) });

export const openMeeting: DefinicaoDeFerramenta<z.infer<typeof reuniaoSchema>> = {
  nome: 'open_meeting',
  descricao: 'Abre uma reunião na seção Reuniões da HOME.',
  schemaDeEntrada: reuniaoSchema,
  efeito: 'interface',
  requisitos: ['reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 2 },
  etapa: 'Abrindo a reunião',
  async executar(args, ctx) {
    const acoes = exigirTela(ctx);
    const { registro: r, outras } = await resolverReuniao(args.reuniao, ctx);
    acoes.abrirReuniao(r.id);
    ctx.registrarOperacao({
      acao: 'abrir',
      tipo: 'reuniao',
      id: r.id,
      titulo: r.title,
      ok: true,
    });
    return {
      aberta: true,
      reuniao: { id: r.id, titulo: r.title, data: dataBr(r.startedAt) },
      ...alternativas(outras),
    };
  },
  resumir: () => 'reunião aberta',
};

const documentoSchema = z.object({
  documento: z.string().min(1).describe('O id, "ultimo" ou o nome como a pessoa disse.'),
});

export const openDocument: DefinicaoDeFerramenta<z.infer<typeof documentoSchema>> = {
  nome: 'open_document',
  descricao: 'Abre um documento na seção Documentos da HOME, no editor.',
  schemaDeEntrada: documentoSchema,
  efeito: 'interface',
  requisitos: ['documentos'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 2 },
  etapa: 'Abrindo o documento',
  async executar(args, ctx) {
    const acoes = exigirTela(ctx);
    const { registro: d, outras } = await resolverDocumento(args.documento, ctx);
    exigirDocumento(ctx.tarefa.escopo, d);
    acoes.abrirDocumento(d.id);
    ctx.registrarOperacao({
      acao: 'abrir',
      tipo: 'documento',
      id: d.id,
      titulo: d.title,
      ok: true,
    });
    return {
      aberto: true,
      documento: { id: d.id, titulo: d.title },
      ...alternativas(outras),
    };
  },
  resumir: () => 'documento aberto',
};

// -------------------------------------------------------------- renomear

const renomearSchema = z.object({
  reuniao: z.string().min(1).describe(REFERENCIA),
  novo_nome: z.string().trim().min(1).max(200),
});

export const renameMeeting: DefinicaoDeFerramenta<z.infer<typeof renomearSchema>> = {
  nome: 'rename_meeting',
  descricao:
    'Renomeia uma reunião. Nota, marcações, prints e documentos continuam ligados a ela.',
  schemaDeEntrada: renomearSchema,
  efeito: 'escrita_local',
  requisitos: ['reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 2 },
  etapa: 'Renomeando a reunião',
  async executar(args, ctx) {
    const acoes = exigirTela(ctx);
    const { registro: r, outras } = await resolverReuniao(args.reuniao, ctx);
    exigirReuniao(ctx.tarefa.escopo, r.id);
    const resposta = respostaOk(
      await acoes
        .enviar({ type: 'ui/history/rename', id: r.id, title: args.novo_nome })
        .catch(() => null),
    );
    ctx.registrarOperacao({
      acao: 'renomear',
      tipo: 'reuniao',
      id: r.id,
      titulo: args.novo_nome,
      ok: resposta.ok,
    });
    if (!resposta.ok) {
      throw new ErroDeFerramenta(
        'operacao_falhou',
        `O aplicativo não confirmou a renomeação (${resposta.erro}). Nada foi alterado.`,
      );
    }
    return {
      renomeada: true,
      reuniao: { id: r.id, nome_anterior: r.title, nome_novo: args.novo_nome },
      ...alternativas(outras),
    };
  },
  resumir: (s) => (s.renomeada ? 'reunião renomeada' : 'renomeação falhou'),
};

// ----------------------------------------------------------------- apagar

export const deleteMeeting: DefinicaoDeFerramenta<z.infer<typeof reuniaoSchema>> = {
  nome: 'delete_meeting',
  descricao:
    'Apaga uma reunião, sem pedir confirmação: ela vai para a LIXEIRA do Taq por 30 dias, com ' +
    'nota, marcações e prints, e os documentos dela ficam sem o vínculo até uma restauração. ' +
    'Diga à pessoa o que foi apagado e que dá para desfazer (restore_meeting ou o botão Desfazer).',
  schemaDeEntrada: reuniaoSchema,
  efeito: 'escrita_local',
  requisitos: ['reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 2 },
  etapa: 'Apagando a reunião',
  async executar(args, ctx) {
    const acoes = exigirTela(ctx);
    const { registro: r, outras } = await resolverReuniao(args.reuniao, ctx);
    exigirReuniao(ctx.tarefa.escopo, r.id);
    if (r.status === 'recording') {
      throw new ErroDeFerramenta(
        'operacao_falhou',
        'A reunião ainda está sendo capturada. Encerre a captura e peça de novo. Nada foi apagado.',
      );
    }

    // O retrato ANTES da exclusão: é ele que faz "apagar sem perguntar" ter volta.
    const item = await guardarNaLixeira(r);
    const resposta = respostaOk(
      await acoes.enviar({ type: 'ui/history/delete', id: r.id }).catch(() => null),
    );
    if (!resposta.ok) {
      await descartarDaLixeira(r.id);
      ctx.registrarOperacao({
        acao: 'apagar',
        tipo: 'reuniao',
        id: r.id,
        titulo: r.title,
        ok: false,
      });
      throw new ErroDeFerramenta(
        'operacao_falhou',
        resposta.erro === 'meeting-active'
          ? 'A reunião ainda está sendo capturada. Encerre a captura e peça de novo. Nada foi apagado.'
          : `O aplicativo não confirmou a exclusão (${resposta.erro}). Nada foi apagado.`,
      );
    }
    ctx.registrarOperacao({
      acao: 'apagar',
      tipo: 'reuniao',
      id: r.id,
      titulo: r.title,
      ok: true,
      desfazivel: true,
    });
    return {
      apagada: true,
      reuniao: { id: r.id, titulo: r.title, data: dataBr(r.startedAt) },
      foi_junto: {
        nota: item.notas.length > 0,
        marcacoes: item.marcas.reduce(
          (n, [, v]) => n + (v && typeof v === 'object' ? Object.keys(v).length : 0),
          0,
        ),
        prints: item.prints.length,
      },
      documentos_sem_vinculo: item.documentos.length,
      lixeira: `Recuperável por ${DIAS_NA_LIXEIRA} dias (restore_meeting ou o botão Desfazer).`,
      ...alternativas(outras),
    };
  },
  resumir: (s) => (s.apagada ? 'reunião na lixeira' : 'exclusão falhou'),
};

const restaurarSchema = z.object({
  reuniao: z
    .string()
    .min(1)
    .describe('O id, o nome, ou "ultima" (a apagada mais recentemente).'),
});

export const restoreMeeting: DefinicaoDeFerramenta<z.infer<typeof restaurarSchema>> = {
  nome: 'restore_meeting',
  descricao:
    'Desfaz uma exclusão: devolve da lixeira do Taq a reunião, a nota, as marcações, os prints ' +
    'e os vínculos dos documentos.',
  schemaDeEntrada: restaurarSchema,
  efeito: 'escrita_local',
  requisitos: ['reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 2 },
  etapa: 'Restaurando a reunião',
  async executar(args, ctx) {
    const acoes = exigirTela(ctx);
    const itens = await lerLixeira();
    if (!itens.length)
      throw new ErroDeFerramenta('nao_encontrado', 'A lixeira está vazia.');
    const ref = normalizar(args.reuniao);
    const item =
      itens.find((i) => i.id === args.reuniao.trim()) ??
      (/^(a )?ultima|mais recente/.test(ref)
        ? itens[0]
        : itens.find((i) =>
            termosDe(args.reuniao).every((t) => normalizar(i.titulo).includes(t)),
          ));
    if (!item) {
      throw new ErroDeFerramenta(
        'nao_encontrado',
        `Nada na lixeira casa com "${args.reuniao}". Na lixeira: ${itens.map((i) => i.titulo).join('; ')}.`,
      );
    }
    const r = await restaurarDaLixeira(item.id, acoes.enviar);
    ctx.registrarOperacao({
      acao: 'restaurar',
      tipo: 'reuniao',
      id: item.id,
      titulo: item.titulo,
      ok: r.ok,
    });
    if (!r.ok) throw new ErroDeFerramenta('operacao_falhou', r.erro);
    return { restaurada: true, reuniao: { id: item.id, titulo: item.titulo } };
  },
  resumir: (s) => (s.restaurada ? 'reunião restaurada' : 'restauração falhou'),
};

// ------------------------------------------------------- apagar conversa

const REFERENCIAS_A_ESTA = ['atual', 'esta', 'essa', 'esta conversa', 'essa conversa', 'a atual'];
/** "As que selecionei": a interface NÃO tem seleção de conversas. */
const REFERENCIAS_A_SELECAO = /selecion|marquei|marcadas|escolhi/;

const apagarConversaSchema = z.object({
  conversas: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(5)
    .describe(
      'Uma entrada por conversa: o id, "atual" (esta conversa) ou o nome como a pessoa disse. ' +
        'Não invente ids.',
    ),
});

export const deleteConversation: DefinicaoDeFerramenta<z.infer<typeof apagarConversaSchema>> = {
  nome: 'delete_conversation',
  descricao:
    'Apaga conversas pelo mesmo caminho da tela ("Apagar esta conversa"): somem as mensagens e a ' +
    'memória delas; reuniões e documentos FICAM (o documento só perde o vínculo com a conversa). ' +
    'É definitivo, sem lixeira. Resolve cada nome para um id real: se um nome casar com mais de ' +
    'uma conversa, NÃO apaga nada e pergunta à pessoa qual. Diga só o que a ferramenta confirmar.',
  schemaDeEntrada: apagarConversaSchema,
  efeito: 'escrita_local',
  requisitos: [],
  politica: { repeticao: 'idempotente', maxPorExecucao: 1 },
  etapa: 'Apagando a conversa',
  async executar(args, ctx) {
    const { escopo, conversaId } = ctx.tarefa;
    const todas = (await ctx.armazenamento.listarConversas()).filter((c) =>
      podeLerConversa(escopo, c),
    );
    const alvos = new Map<string, { id: string; titulo: string }>();
    const ambiguas: Array<{ pedido: string; candidatas: typeof todas }> = [];
    const naoAchadas: string[] = [];

    for (const ref of args.conversas) {
      const r = normalizar(ref);
      const porId = todas.find((c) => c.id === ref.trim());
      if (porId) {
        alvos.set(porId.id, { id: porId.id, titulo: porId.title });
        continue;
      }
      if (REFERENCIAS_A_ESTA.includes(r)) {
        const atual = todas.find((c) => c.id === conversaId);
        if (atual) alvos.set(atual.id, { id: atual.id, titulo: atual.title });
        else naoAchadas.push(ref);
        continue;
      }
      if (REFERENCIAS_A_SELECAO.test(r)) {
        throw new ErroDeFerramenta(
          'alvo_nao_identificado',
          'A tela não tem seleção de conversas, então "as que selecionei" não aponta para nenhuma. ' +
            'Nada foi apagado. Peça à pessoa os nomes das conversas.',
        );
      }
      const casam = casaNome(todas, ref);
      if (casam.length === 1) alvos.set(casam[0]!.id, { id: casam[0]!.id, titulo: casam[0]!.title });
      else if (casam.length > 1) ambiguas.push({ pedido: ref, candidatas: casam });
      else naoAchadas.push(ref);
    }

    // Apagar conversa não tem volta: na dúvida, pergunta — e não apaga NENHUMA,
    // nem as que estavam claras, para a pessoa não ver metade do pedido feito.
    if (ambiguas.length) {
      const candidatas = ambiguas.flatMap((a) => a.candidatas).slice(0, 5);
      ctx.registrarPergunta({
        motivo: 'escolha_de_registro',
        texto: `Mais de uma conversa se chama assim (${ambiguas
          .map((a) => `“${a.pedido}”`)
          .join(', ')}). Qual delas eu apago?`,
        opcoes: candidatas.map((c) => ({
          rotulo: `${c.title} · ${dataBr(c.updatedAt)}`,
          mensagem: `Apague a conversa “${c.title}” (id ${c.id}).`,
        })),
      });
      return {
        apagada: false,
        motivo: 'alvo_ambiguo',
        candidatas: candidatas.map((c) => ({ id: c.id, titulo: c.title, data: dataBr(c.updatedAt) })),
        aviso: 'Nada foi apagado. A pergunta já vai para a pessoa.',
      };
    }
    if (naoAchadas.length) {
      throw new ErroDeFerramenta(
        'nao_encontrado',
        `Nenhuma conversa no escopo casa com ${naoAchadas.map((n) => `"${n}"`).join(', ')}. ` +
          'Nada foi apagado.',
      );
    }

    const pedidas = [...alvos.values()];
    let resultado;
    try {
      resultado = await ctx.armazenamento.apagarConversas(pedidas.map((a) => a.id));
    } catch (e) {
      for (const a of pedidas)
        ctx.registrarOperacao({ acao: 'apagar', tipo: 'conversa', id: a.id, titulo: a.titulo, ok: false });
      throw new ErroDeFerramenta(
        'operacao_falhou',
        `O aplicativo não conseguiu apagar (${(e as Error)?.message ?? 'erro'}). Nada foi confirmado como apagado.`,
      );
    }
    const apagadas = new Set(resultado.apagadas);
    for (const a of pedidas) {
      ctx.registrarOperacao({
        acao: 'apagar',
        tipo: 'conversa',
        id: a.id,
        titulo: a.titulo,
        ok: apagadas.has(a.id),
      });
    }
    const falharam = pedidas.filter((a) => !apagadas.has(a.id));
    if (!apagadas.size) {
      throw new ErroDeFerramenta('operacao_falhou', 'Nenhuma conversa foi apagada: elas já não existiam.');
    }
    return {
      apagada: true,
      conversas: pedidas.filter((a) => apagadas.has(a.id)),
      ...(falharam.length ? { nao_apagadas: falharam } : {}),
      era_a_conversa_atual: apagadas.has(conversaId),
      documentos_mantidos_sem_vinculo: resultado.documentosDesvinculados,
      preservado: 'Reuniões e documentos não foram apagados.',
      aviso: 'É definitivo: conversa apagada não volta.',
    };
  },
  resumir: (s) =>
    s.apagada ? `${(s.conversas as unknown[]).length} conversa(s) apagada(s)` : 'nada apagado',
};

// --------------------------------------------------------------- exportar

export const exportTranscript: DefinicaoDeFerramenta<z.infer<typeof reuniaoSchema>> = {
  nome: 'export_transcript',
  descricao:
    'Baixa a transcrição de uma reunião como .txt (o mesmo "Baixar .txt" da tela).',
  schemaDeEntrada: reuniaoSchema,
  efeito: 'interface',
  requisitos: ['reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 2 },
  etapa: 'Exportando a transcrição',
  async executar(args, ctx) {
    exigirTela(ctx);
    const { registro: r, outras } = await resolverReuniao(args.reuniao, ctx);
    if (!r.segments.length) {
      throw new ErroDeFerramenta(
        'sem_conteudo',
        `A reunião “${r.title}” não tem transcrição para exportar.`,
      );
    }
    try {
      downloadTranscript(r);
    } catch (e) {
      ctx.registrarOperacao({
        acao: 'exportar',
        tipo: 'reuniao',
        id: r.id,
        titulo: r.title,
        ok: false,
      });
      throw new ErroDeFerramenta(
        'operacao_falhou',
        `O download não começou: ${(e as Error)?.message ?? 'erro'}.`,
      );
    }
    ctx.registrarOperacao({
      acao: 'exportar',
      tipo: 'reuniao',
      id: r.id,
      titulo: r.title,
      ok: true,
    });
    return {
      exportada: true,
      reuniao: { id: r.id, titulo: r.title },
      formato: 'txt',
      ...alternativas(outras),
    };
  },
  resumir: () => 'transcrição exportada',
};

// ------------------------------------------------------------------ ajuda
//
// As duas consultam a REFERÊNCIA (`ajuda.ts`), que é dado versionado junto ao
// código — nenhuma pede a um modelo para explicar o aplicativo. O que o agente
// consegue executar não está escrito na referência à mão: sai do registro de
// ferramentas de verdade (`FERRAMENTAS_BASE` + as desta lista), então uma
// ferramenta removida some da resposta sem ninguém lembrar de atualizar texto.

/** As ferramentas registradas — o mesmo conjunto que o orquestrador registra. */
function ferramentasRegistradas(): ReadonlySet<string> {
  return new Set([...FERRAMENTAS_BASE, ...FERRAMENTAS_DE_APP].map((f) => f.nome));
}

const capacidadesSchema = z.object({
  assunto: z
    .enum(ASSUNTOS)
    .optional()
    .describe('Restringe a um assunto. Sem ele, vem o mapa inteiro, resumido.'),
});

export const getAppCapabilities: DefinicaoDeFerramenta<
  z.infer<typeof capacidadesSchema>
> = {
  nome: 'get_app_capabilities',
  descricao:
    'O que existe NESTA versão do TaqCiti: as funcionalidades da tela, quais delas você consegue ' +
    'executar (e com qual ferramenta) e o que é só manual, planejado ou inexistente. Consulte antes ' +
    'de dizer se o TaqCiti faz algo, e antes de atender um comando.',
  schemaDeEntrada: capacidadesSchema,
  efeito: 'leitura',
  requisitos: [],
  politica: { repeticao: 'leitura', maxPorExecucao: 2 },
  etapa: 'Consultando o que o TaqCiti faz',
  async executar(args) {
    return capacidadesDoApp(ferramentasRegistradas(), args.assunto);
  },
  resumir: (s) => `${(s.funcionalidades as unknown[]).length} funcionalidade(s)`,
};

const guiaSchema = z.object({
  pergunta: z
    .string()
    .min(1)
    .max(400)
    .describe('A dúvida ou o comando, com as palavras da pessoa.'),
  assunto: z.enum(ASSUNTOS).optional(),
});

export const getUsageGuide: DefinicaoDeFerramenta<z.infer<typeof guiaSchema>> = {
  nome: 'get_usage_guide',
  descricao:
    'Os passos VERIFICADOS de uma funcionalidade do TaqCiti, com os nomes exatos da tela, os ' +
    'pré-requisitos, as limitações e se você consegue executá-la. Responda só com o que ela trouxer; ' +
    'se `encontrou` for falso, diga que isso não está documentado — não complete com suposições.',
  schemaDeEntrada: guiaSchema,
  efeito: 'leitura',
  requisitos: [],
  politica: { repeticao: 'leitura', maxPorExecucao: 3 },
  etapa: 'Consultando a ajuda',
  async executar(args) {
    return guiaDeUso(args.pergunta, ferramentasRegistradas(), args.assunto);
  },
  resumir: (s) => `${(s.guias as unknown[]).length} guia(s) de uso`,
};

export const FERRAMENTAS_DE_APP: readonly DefinicaoDeFerramenta[] = [
  openMeeting,
  openDocument,
  renameMeeting,
  deleteMeeting,
  restoreMeeting,
  deleteConversation,
  exportTranscript,
  getAppCapabilities,
  getUsageGuide,
] as unknown as readonly DefinicaoDeFerramenta[];
