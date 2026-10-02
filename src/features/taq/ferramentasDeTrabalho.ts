/**
 * As ferramentas dos especialistas de TRABALHO — sobre os registros de
 * `features/trabalho/store.ts` e os serviços determinísticos ao lado.
 *
 *   análise        read_analysis, save_analysis
 *   compromissos   list_commitments, suggest_commitments, register_commitments,
 *                  update_commitment, link_dependency
 *   decisões       list_decisions, record_decision
 *   achados        list_findings, save_finding, resolve_finding
 *   captura        get_capture_state                (determinística)
 *   documentos     check_document                   (determinística)
 *   comunicação    prepare_message                  (só rascunho; nada é enviado)
 *   agenda         prepare_event                    (só sugestão; nada é criado)
 *   privacidade    review_privacy                   (determinística)
 *
 * ── Três travas que valem para todas ────────────────────────────────────────
 *
 *   1. EVIDÊNCIA é `rN` do livro desta execução, nunca texto do modelo. A
 *      ferramenta copia registro, versão e trecho do livro; `rN` que o livro
 *      não conhece é recusado.
 *   2. RESPONSÁVEL e PRAZO só entram se aparecem no trecho citado ou no pedido
 *      da pessoa. Nome que não está lá é descartado e dito — "sem dono"
 *      continua sem dono, salvo atribuição explícita.
 *   3. ESCOPO: item cuja fonte está fora do escopo da conversa não aparece em
 *      lista, contagem nem cartão; id de fora é tratado como inexistente.
 *
 * Nenhuma ferramenta daqui envia, agenda ou publica nada. Mensagem e horário
 * saem como cartão para a pessoa copiar ou abrir — não há integração de e-mail
 * ou calendário nesta versão, e nenhuma descrição diz que há.
 */
import { z } from 'zod/v4';
import type { MeetingRecord } from '@/shared/types/domain';
import {
  SECOES_DA_ANALISE,
  analiseDesatualizada,
  situacaoDoPrazo,
  type Achado,
  type Compromisso,
  type Decisao,
  type EvidenciaGuardada,
  type ItemDaAnalise,
  type SecaoDaAnalise,
} from '@/features/trabalho/store';
import { versaoDaReuniao } from './armazenamento';
import { normalizar, termosDe } from './busca';
import { avaliarCaptura } from './captura';
import type { Escopo } from './contratos';
import { documentoNoEscopo, instante, reuniaoNoEscopo } from './ferramentas';
import { diaLocal, fusoValido, localParaInstante, rotuloDoHorario } from './agenda';
import { podeLerReuniao } from './politica';
import { acharSensiveis, avisosDeExposicao, NOME_DO_TIPO, ocultarSensiveis } from './privacidade';
import { revisarDocumento } from './revisao';
import { ErroDeFerramenta, type ContextoDeFerramenta, type DefinicaoDeFerramenta } from './tipos';

const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('Data no formato AAAA-MM-DD.');
const ref = z.string().regex(/^r\d+$/).describe('Uma referência `rN` devolvida por uma ferramenta nesta execução.');

function fusoDeQuemUsa(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Recife';
}

function hoje(): string {
  return diaLocal(Date.now(), fusoDeQuemUsa());
}

// ---------------------------------------------------------------- evidências

function evidenciaDe(ctx: ContextoDeFerramenta, id: string): EvidenciaGuardada {
  const r = ctx.livro.obter(id);
  if (!r) {
    throw new ErroDeFerramenta(
      'referencia_desconhecida',
      `A referência ${id} não foi devolvida por nenhuma ferramenta nesta execução. Leia a fonte e use o rN que ela devolver.`,
    );
  }
  return {
    tipo: r.tipo,
    registroId: r.registroId,
    titulo: r.titulo,
    versao: r.versao,
    trecho: r.trecho.length > 400 ? `${r.trecho.slice(0, 399)}…` : r.trecho,
    ...(r.local.segmento !== undefined ? { segmento: r.local.segmento } : {}),
    ...(r.local.offsetMs !== undefined ? { offsetMs: r.local.offsetMs } : {}),
  };
}

function evidenciasDe(ctx: ContextoDeFerramenta, refs: readonly string[] | undefined): EvidenciaGuardada[] {
  return [...new Set(refs ?? [])].map((r) => evidenciaDe(ctx, r));
}

/**
 * Devolve ao modelo uma evidência guardada: com `ref` nova quando a fonte ainda
 * existe, está no escopo e contém o trecho; senão, marcada indisponível.
 */
async function citavel(
  ctx: ContextoDeFerramenta,
  e: EvidenciaGuardada,
): Promise<{ ref?: string; titulo: string; trecho: string; origem_indisponivel?: true; fonte_mudou?: true }> {
  const base = { titulo: e.titulo, trecho: e.trecho };
  if (e.tipo === 'reuniao') {
    if (!podeLerReuniao(ctx.tarefa.escopo, e.registroId)) return { ...base, origem_indisponivel: true };
    const r = await ctx.armazenamento.obterReuniao(e.registroId);
    const seg = e.segmento !== undefined ? r?.segments[e.segmento] : undefined;
    if (!r || !seg) return { ...base, origem_indisponivel: true };
    const trecho = normalizar(e.trecho.replace(/…$/, ''));
    if (!normalizar(seg.text).includes(trecho)) return { ...base, fonte_mudou: true };
    return {
      ...base,
      titulo: r.title,
      ref: ctx.livro.registrar({
        tipo: 'reuniao',
        registroId: r.id,
        titulo: r.title,
        versao: versaoDaReuniao(r),
        trecho: seg.text,
        local: {
          segmento: e.segmento,
          offsetMs: Math.max(0, Math.round(seg.startOffsetMs)),
          ...(seg.captionId ? { captionId: seg.captionId } : {}),
        },
      }),
    };
  }
  const d = await ctx.armazenamento.obterDocumento(e.registroId);
  if (!d) return { ...base, origem_indisponivel: true };
  return base;
}

/** O item pertence ao escopo desta conversa? Fora dele, não existe. */
function noEscopo(escopo: Escopo, item: { reuniaoId?: string; evidencias: readonly EvidenciaGuardada[] }): boolean {
  if (escopo.reunioes === 'todas') return true;
  if (item.reuniaoId) return escopo.reunioes.includes(item.reuniaoId);
  return item.evidencias.some((e) => e.tipo === 'reuniao' && podeLerReuniao(escopo, e.registroId));
}

function exigirNoEscopo<T extends { id: string; reuniaoId?: string; evidencias: readonly EvidenciaGuardada[] }>(
  escopo: Escopo,
  lista: readonly T[],
  id: string,
  nome: string,
): T {
  const item = lista.find((x) => x.id === id);
  if (!item || !noEscopo(escopo, item))
    throw new ErroDeFerramenta('nao_encontrado', `Não há ${nome} com o id ${id} no escopo desta conversa.`);
  return item;
}

/** As palavras do nome aparecem no texto? (≥ 3 letras, sem acento.) */
function nomeAparece(nome: string, ...textos: string[]): boolean {
  const partes = normalizar(nome).split(/[^a-z0-9]+/).filter((p) => p.length >= 3);
  if (!partes.length) return false;
  const alvo = normalizar(textos.join(' '));
  return partes.some((p) => new RegExp(`\\b${p}\\b`).test(alvo));
}

function textoAparece(texto: string, ...textos: string[]): boolean {
  const t = normalizar(texto);
  return !!t && normalizar(textos.join(' ')).includes(t);
}

// ------------------------------------------------------------------ análise

const itemDeAnalise = z.object({
  texto: z.string().trim().min(1).max(600),
  refs: z.array(ref).max(4).default([]),
});

const analiseSchema = z.object({
  reuniao_id: z.string().min(1),
  visao_geral: z.array(itemDeAnalise).max(6).default([]),
  decisoes: z.array(itemDeAnalise).max(20).default([]).describe('Só decisões confirmadas na fala; proposta não é decisão.'),
  questoes: z.array(itemDeAnalise).max(20).default([]),
  riscos: z.array(itemDeAnalise).max(20).default([]),
  proximos_passos: z.array(itemDeAnalise).max(20).default([]),
  lacunas: z.array(z.string().min(1).max(300)).max(10).optional(),
});

const SECAO_DO_ARGUMENTO: Record<SecaoDaAnalise, keyof z.infer<typeof analiseSchema>> = {
  visaoGeral: 'visao_geral',
  decisoes: 'decisoes',
  questoes: 'questoes',
  riscos: 'riscos',
  proximosPassos: 'proximos_passos',
};

export const saveAnalysis: DefinicaoDeFerramenta<z.infer<typeof analiseSchema>> = {
  nome: 'save_analysis',
  descricao:
    'Salva a análise estruturada de UMA reunião: visão geral, decisões, questões abertas, riscos e ' +
    'próximos passos. Cada item de decisões/questões/riscos/próximos passos precisa de pelo menos um ' +
    '`rN` da própria reunião. A COBERTURA é calculada pelo que você leu nesta execução (não diga ' +
    'que leu tudo se não leu). Uma análise nova da mesma reunião substitui a anterior.',
  schemaDeEntrada: analiseSchema,
  efeito: 'escrita_local',
  requisitos: ['reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 2 },
  etapa: 'Salvando a análise',
  async executar(args, ctx) {
    const r = await reuniaoNoEscopo(ctx, args.reuniao_id);
    const secoes = {} as Record<SecaoDaAnalise, ItemDaAnalise[]>;
    const semFonte: string[] = [];
    for (const s of SECOES_DA_ANALISE) {
      const itens = args[SECAO_DO_ARGUMENTO[s]] as Array<z.infer<typeof itemDeAnalise>>;
      secoes[s] = itens.map((i) => {
        const evidencias = evidenciasDe(ctx, i.refs);
        if (evidencias.some((e) => e.registroId !== r.id))
          throw new ErroDeFerramenta('referencia_de_outra_fonte', `“${i.texto}” cita trecho de outro registro.`);
        if (s !== 'visaoGeral' && !evidencias.length) semFonte.push(i.texto);
        return { texto: i.texto, evidencias };
      });
    }
    if (semFonte.length) {
      throw new ErroDeFerramenta(
        'item_sem_fonte',
        `Itens sem trecho que os sustente: ${semFonte.map((t) => `“${t}”`).join('; ')}. Cite o rN ou tire o item.`,
      );
    }
    const lidos = ctx.livro.segmentosLidos(r.id).size;
    const total = r.segments.length;
    const lacunas = [...(args.lacunas ?? [])];
    if (lidos < total) lacunas.unshift(`Cobertura parcial: ${lidos} de ${total} segmentos lidos nesta análise.`);
    const captura = avaliarCaptura(r, await ctx.armazenamento.lerEstadoAoVivo());
    if (captura.avaliacao !== 'sem_problemas_detectados') lacunas.push(...captura.sinais);
    if (r.status === 'recording') lacunas.unshift('Reunião em andamento: a análise cobre só o que já foi capturado.');

    const analise = await ctx.armazenamento.trabalho.guardarAnalise(
      {
        reuniaoId: r.id,
        versaoDaReuniao: versaoDaReuniao(r),
        instrucoes: ctx.tarefa.agenteId,
        cobertura: { lidos, total },
        secoes,
        lacunas,
      },
      { origem: 'taq', execucaoId: ctx.tarefa.execucaoId },
    );
    ctx.registrarCartao({ tipo: 'analise', id: analise.id });
    if (lacunas.length) ctx.registrarAusentes(lacunas.slice(0, 3));
    return {
      analise_id: analise.id,
      revisao: analise.revisao,
      cobertura: analise.cobertura,
      lacunas,
      aviso: 'A análise aparece como cartão. Diga a cobertura e as lacunas; não repita os itens todos.',
    };
  },
  resumir: (s) => `análise salva (${(s.cobertura as { lidos: number }).lidos} segmentos lidos)`,
};

export const readAnalysis: DefinicaoDeFerramenta<{ reuniao_id: string }> = {
  nome: 'read_analysis',
  descricao:
    'Abre a análise já salva de uma reunião (se houver), com os itens, as referências ainda válidas ' +
    'para citar, a cobertura e se está DESATUALIZADA (a transcrição mudou depois).',
  schemaDeEntrada: z.object({ reuniao_id: z.string().min(1) }),
  efeito: 'leitura',
  requisitos: ['reunioes'],
  politica: { repeticao: 'leitura' },
  etapa: 'Consultando a análise',
  async executar(args, ctx) {
    const r = await reuniaoNoEscopo(ctx, args.reuniao_id);
    const a = (await ctx.armazenamento.trabalho.ler()).analises.find((x) => x.reuniaoId === r.id);
    if (!a) return { existe: false, aviso: 'Esta reunião ainda não tem análise salva.' };
    const secoes: Record<string, unknown[]> = {};
    for (const s of SECOES_DA_ANALISE) {
      secoes[SECAO_DO_ARGUMENTO[s]] = await Promise.all(
        a.secoes[s].map(async (i) => ({
          texto: i.texto,
          ...(i.corrigido ? { corrigido_pela_pessoa: true } : {}),
          fontes: await Promise.all(i.evidencias.map((e) => citavel(ctx, e))),
        })),
      );
    }
    ctx.registrarCartao({ tipo: 'analise', id: a.id });
    return {
      existe: true,
      analise_id: a.id,
      revisao: a.revisao,
      desatualizada: analiseDesatualizada(a, versaoDaReuniao(r)),
      cobertura: a.cobertura,
      lacunas: a.lacunas,
      secoes,
    };
  },
  resumir: (s) => (s.existe ? 'análise encontrada' : 'sem análise'),
};

// ------------------------------------------------------------- compromissos

const itemDeCompromisso = z.object({
  descricao: z.string().trim().min(3).max(300),
  responsavel: z
    .string()
    .trim()
    .max(80)
    .nullable()
    .default(null)
    .describe('Só quem a fonte diz que ficou com a tarefa. Mencionado não é responsável. Sem dono: null.'),
  responsavel_confirmado: z.boolean().default(false).describe('A fala atribui explicitamente?'),
  prazo: z.string().trim().max(80).nullable().default(null).describe('O prazo como foi dito ("até sexta"). Sem prazo: null.'),
  prazo_data: dataIso.optional().describe('A data do prazo, quando dá para resolver com certeza.'),
  refs: z.array(ref).min(1).max(4),
});

const compromissosSchema = z.object({
  reuniao_id: z.string().min(1).optional(),
  itens: z.array(itemDeCompromisso).min(1).max(20),
});

interface CompromissoConferido {
  descricao: string;
  responsavel: { nome: string; confirmado: boolean } | null;
  prazo: { texto: string; data?: string } | null;
  evidencias: EvidenciaGuardada[];
}

/** Quem falou cada trecho de reunião citado: "eu fico com isso" tem dono. */
async function falantesDe(ctx: ContextoDeFerramenta, evidencias: readonly EvidenciaGuardada[]): Promise<string[]> {
  const nomes: string[] = [];
  for (const e of evidencias) {
    if (e.tipo !== 'reuniao' || e.segmento === undefined) continue;
    const falante = (await ctx.armazenamento.obterReuniao(e.registroId))?.segments[e.segmento]?.speaker;
    if (falante) nomes.push(falante);
  }
  return nomes;
}

/**
 * Trava 2 do cabeçalho: dono e prazo só com sustentação no trecho citado, em
 * quem o falou ("eu fico com o relatório") ou no pedido da pessoa.
 */
async function conferirCompromissos(
  ctx: ContextoDeFerramenta,
  itens: ReadonlyArray<z.infer<typeof itemDeCompromisso>>,
): Promise<{ conferidos: CompromissoConferido[]; descartes: string[] }> {
  const descartes: string[] = [];
  const conferidos: CompromissoConferido[] = [];
  for (const i of itens) {
    const evidencias = evidenciasDe(ctx, i.refs);
    const trechos = [...evidencias.map((e) => e.trecho), ...(await falantesDe(ctx, evidencias))];
    let responsavel: CompromissoConferido['responsavel'] = null;
    if (i.responsavel) {
      if (nomeAparece(i.responsavel, ...trechos, ctx.tarefa.pedidoOriginal))
        responsavel = { nome: i.responsavel, confirmado: i.responsavel_confirmado };
      else descartes.push(`responsável “${i.responsavel}” de “${i.descricao}”: não aparece no trecho citado`);
    }
    let prazo: CompromissoConferido['prazo'] = null;
    if (i.prazo) {
      if (textoAparece(i.prazo, ...trechos, ctx.tarefa.pedidoOriginal))
        prazo = { texto: i.prazo, ...(i.prazo_data ? { data: i.prazo_data } : {}) };
      else descartes.push(`prazo “${i.prazo}” de “${i.descricao}”: não aparece no trecho citado`);
    }
    conferidos.push({ descricao: i.descricao, responsavel, prazo, evidencias });
  }
  return { conferidos, descartes };
}

function reuniaoDosItens(args: { reuniao_id?: string }, itens: readonly CompromissoConferido[]): string | undefined {
  return args.reuniao_id ?? itens.flatMap((i) => i.evidencias).find((e) => e.tipo === 'reuniao')?.registroId;
}

export const suggestCommitments: DefinicaoDeFerramenta<z.infer<typeof compromissosSchema>> = {
  nome: 'suggest_commitments',
  descricao:
    'Mostra à pessoa, num cartão revisável, os compromissos que você extraiu (o que foi combinado, por ' +
    'quem, até quando), cada um com `rN`. NÃO grava nada: a pessoa escolhe no cartão o que registrar. ' +
    'Responsável e prazo que não aparecem no trecho citado são descartados.',
  schemaDeEntrada: compromissosSchema,
  efeito: 'leitura',
  requisitos: ['reunioes'],
  politica: { repeticao: 'leitura', maxPorExecucao: 2 },
  etapa: 'Separando os compromissos',
  async executar(args, ctx) {
    if (args.reuniao_id) await reuniaoNoEscopo(ctx, args.reuniao_id);
    const { conferidos, descartes } = await conferirCompromissos(ctx, args.itens);
    const reuniaoId = reuniaoDosItens(args, conferidos);
    ctx.registrarCartao({
      tipo: 'sugestoes_de_compromisso',
      ...(reuniaoId ? { reuniaoId } : {}),
      itens: conferidos.map((c) => ({
        descricao: c.descricao,
        responsavel: c.responsavel?.nome ?? null,
        prazo: c.prazo?.texto ?? null,
        ...(c.prazo?.data ? { prazoData: c.prazo.data } : {}),
        evidencias: c.evidencias,
      })),
    });
    return {
      sugeridos: conferidos.length,
      descartados: descartes,
      aviso: 'Nada foi registrado. O cartão deixa a pessoa revisar e registrar os que quiser.',
    };
  },
  resumir: (s) => `${s.sugeridos as number} compromisso(s) sugerido(s)`,
};

export const registerCommitments: DefinicaoDeFerramenta<z.infer<typeof compromissosSchema>> = {
  nome: 'register_commitments',
  descricao:
    'REGISTRA compromissos, quando a pessoa pediu para registrar. Cada item com `rN`. Não duplica: o ' +
    'que já estava registrado (mesma tarefa, mesma reunião) volta em `ja_existiam`, intocado. ' +
    'Responsável e prazo sem sustentação no trecho são descartados — "sem dono" fica sem dono.',
  schemaDeEntrada: compromissosSchema,
  efeito: 'escrita_local',
  requisitos: ['reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 2 },
  etapa: 'Registrando compromissos',
  async executar(args, ctx) {
    if (args.reuniao_id) await reuniaoNoEscopo(ctx, args.reuniao_id);
    const { conferidos, descartes } = await conferirCompromissos(ctx, args.itens);
    const reuniaoId = reuniaoDosItens(args, conferidos);
    const { criados, jaExistiam } = await ctx.armazenamento.trabalho.registrarCompromissos(
      conferidos.map((c) => ({ ...c, ...(reuniaoId ? { reuniaoId } : {}) })),
      { origem: 'taq', execucaoId: ctx.tarefa.execucaoId },
    );
    const ids = [...criados, ...jaExistiam].map((c) => c.id);
    if (ids.length) ctx.registrarCartao({ tipo: 'compromissos', ids });
    return {
      registrados: criados.map((c) => ({ id: c.id, descricao: c.descricao })),
      ja_existiam: jaExistiam.map((c) => ({ id: c.id, descricao: c.descricao, estado: c.estado })),
      descartados: descartes,
    };
  },
  resumir: (s) =>
    `${(s.registrados as unknown[]).length} registrado(s), ${(s.ja_existiam as unknown[]).length} já existia(m)`,
};

async function compromissoParaModelo(ctx: ContextoDeFerramenta, c: Compromisso, todos: readonly Compromisso[]) {
  return {
    id: c.id,
    revisao: c.revisao,
    descricao: c.descricao,
    responsavel: c.responsavel ? `${c.responsavel.nome}${c.responsavel.confirmado ? '' : ' (sugerido)'}` : 'sem responsável definido',
    prazo: c.prazo?.texto ?? 'sem prazo acordado',
    situacao: situacaoDoPrazo(c, hoje()),
    estado: c.estado,
    depende_de: c.dependeDe.map((id) => todos.find((x) => x.id === id)?.descricao ?? '(removido)'),
    fontes: await Promise.all(c.evidencias.slice(0, 2).map((e) => citavel(ctx, e))),
    ultima_mudanca: c.historico.at(-1)?.acao,
  };
}

const listaDeCompromissosSchema = z.object({
  reuniao_id: z.string().min(1).optional(),
  responsavel: z.string().max(80).optional(),
  estado: z.enum(['aberto', 'concluido', 'cancelado', 'todos']).default('aberto'),
  limite: z.number().int().min(1).max(30).default(15),
});

export const listCommitments: DefinicaoDeFerramenta<z.infer<typeof listaDeCompromissosSchema>> = {
  nome: 'list_commitments',
  descricao:
    'Lista os compromissos REGISTRADOS do escopo, com id, revisão, responsável, prazo, situação do prazo ' +
    '("prazo_passou_a_confirmar" não é atraso: ninguém disse se terminou), dependências e fontes.',
  schemaDeEntrada: listaDeCompromissosSchema,
  efeito: 'leitura',
  requisitos: ['reunioes'],
  politica: { repeticao: 'leitura' },
  etapa: 'Consultando compromissos',
  async executar(args, ctx) {
    const { compromissos } = await ctx.armazenamento.trabalho.ler();
    const visiveis = compromissos.filter((c) => noEscopo(ctx.tarefa.escopo, c));
    const filtrados = visiveis
      .filter((c) => args.estado === 'todos' || c.estado === args.estado)
      .filter((c) => !args.reuniao_id || c.reuniaoId === args.reuniao_id)
      .filter((c) => !args.responsavel || (c.responsavel && nomeAparece(args.responsavel, c.responsavel.nome)));
    const pagina = filtrados.slice(0, args.limite);
    if (pagina.length) ctx.registrarCartao({ tipo: 'compromissos', ids: pagina.map((c) => c.id) });
    return {
      total: filtrados.length,
      hoje: hoje(),
      compromissos: await Promise.all(pagina.map((c) => compromissoParaModelo(ctx, c, compromissos))),
      ...(filtrados.length === 0
        ? { aviso: 'Nenhum compromisso registrado com esses filtros. Isso não quer dizer que não houve combinados.' }
        : {}),
    };
  },
  resumir: (s) => `${s.total as number} compromisso(s)`,
};

const atualizacaoDeCompromissoSchema = z.object({
  compromisso_id: z.string().min(1),
  revisao: z.number().int().min(1).describe('A `revisao` que list_commitments devolveu.'),
  estado: z.enum(['aberto', 'concluido', 'cancelado']).optional(),
  responsavel: z.string().trim().max(80).nullable().optional(),
  prazo: z.string().trim().max(80).nullable().optional(),
  prazo_data: dataIso.optional(),
  origem: z
    .enum(['pedido_da_pessoa', 'evidencia'])
    .describe('`pedido_da_pessoa`: ela disse nesta conversa. `evidencia`: um trecho diz (passe `ref`).'),
  ref: ref.optional(),
});

export const updateCommitment: DefinicaoDeFerramenta<z.infer<typeof atualizacaoDeCompromissoSchema>> = {
  nome: 'update_commitment',
  descricao:
    'Atualiza um compromisso registrado (estado, responsável, prazo) SÓ na `revisao` lida, com a origem ' +
    'da informação. Prazo vencido sozinho não muda estado. Novo responsável precisa aparecer no pedido da ' +
    'pessoa ou no trecho citado. Conflito de revisão não grava.',
  schemaDeEntrada: atualizacaoDeCompromissoSchema,
  efeito: 'escrita_local',
  requisitos: ['reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 6 },
  etapa: 'Atualizando compromisso',
  async executar(args, ctx) {
    const { compromissos } = await ctx.armazenamento.trabalho.ler();
    exigirNoEscopo(ctx.tarefa.escopo, compromissos, args.compromisso_id, 'compromisso');
    if (args.origem === 'evidencia' && !args.ref)
      throw new ErroDeFerramenta('evidencia_ausente', 'Mudança por evidência precisa do `ref` do trecho.');
    const evidencia = args.ref ? evidenciaDe(ctx, args.ref) : undefined;
    const base = args.origem === 'evidencia' ? [evidencia!.trecho] : [ctx.tarefa.pedidoOriginal];
    if (args.responsavel && !nomeAparece(args.responsavel, ...base))
      throw new ErroDeFerramenta(
        'responsavel_sem_sustentacao',
        `“${args.responsavel}” não aparece ${args.origem === 'evidencia' ? 'no trecho citado' : 'no pedido da pessoa'}. Nada foi alterado.`,
      );
    if (args.prazo && !textoAparece(args.prazo, ...base))
      throw new ErroDeFerramenta('prazo_sem_sustentacao', `O prazo “${args.prazo}” não aparece na origem informada.`);
    const r = await ctx.armazenamento.trabalho.atualizarCompromisso(
      args.compromisso_id,
      args.revisao,
      {
        ...(args.estado ? { estado: args.estado } : {}),
        ...(args.responsavel !== undefined
          ? { responsavel: args.responsavel ? { nome: args.responsavel, confirmado: true } : null }
          : {}),
        ...(args.prazo !== undefined
          ? { prazo: args.prazo ? { texto: args.prazo, ...(args.prazo_data ? { data: args.prazo_data } : {}) } : null }
          : {}),
      },
      {
        origem: args.origem === 'evidencia' ? 'evidencia' : 'pessoa',
        execucaoId: ctx.tarefa.execucaoId,
        ...(evidencia ? { evidencia } : {}),
      },
    );
    if (r.tipo === 'inexistente') throw new ErroDeFerramenta('nao_encontrado', 'O compromisso foi apagado.');
    if (r.tipo === 'invalido') throw new ErroDeFerramenta('mudanca_invalida', r.motivo);
    if (r.tipo === 'conflito')
      throw new ErroDeFerramenta(
        'conflito_de_versao',
        `O compromisso mudou depois da leitura (revisão ${args.revisao} → ${r.atual.revisao}). Nada foi gravado.`,
        { revisao_atual: r.atual.revisao },
      );
    ctx.registrarCartao({ tipo: 'compromissos', ids: [r.item.id] });
    return { compromisso_id: r.item.id, revisao: r.item.revisao, estado: r.item.estado };
  },
  resumir: (s) => `compromisso atualizado (${s.estado as string})`,
};

export const linkDependency: DefinicaoDeFerramenta<{ compromisso_id: string; depende_de_id: string }> = {
  nome: 'link_dependency',
  descricao:
    'Registra que um compromisso depende de outro (ids de list_commitments). Recusa ligação que fecharia ciclo.',
  schemaDeEntrada: z.object({ compromisso_id: z.string().min(1), depende_de_id: z.string().min(1) }),
  efeito: 'escrita_local',
  requisitos: ['reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 6 },
  etapa: 'Ligando dependência',
  async executar(args, ctx) {
    const { compromissos } = await ctx.armazenamento.trabalho.ler();
    exigirNoEscopo(ctx.tarefa.escopo, compromissos, args.compromisso_id, 'compromisso');
    exigirNoEscopo(ctx.tarefa.escopo, compromissos, args.depende_de_id, 'compromisso');
    const r = await ctx.armazenamento.trabalho.vincularDependencia(args.compromisso_id, args.depende_de_id, {
      origem: 'pessoa',
      execucaoId: ctx.tarefa.execucaoId,
    });
    if (r.tipo === 'invalido') throw new ErroDeFerramenta('dependencia_invalida', r.motivo);
    if (r.tipo !== 'ok') throw new ErroDeFerramenta('nao_encontrado', 'Um dos compromissos não existe mais.');
    ctx.registrarCartao({ tipo: 'compromissos', ids: [args.compromisso_id, args.depende_de_id] });
    return { ligado: true, revisao: r.item.revisao };
  },
  resumir: () => 'dependência registrada',
};

// ----------------------------------------------------------------- decisões

const decisaoSchema = z.object({
  assunto: z.string().trim().min(2).max(120),
  texto: z.string().trim().min(3).max(500),
  estado: z.enum(['proposta', 'confirmada']).describe('Alguém sugerir não é decisão confirmada.'),
  origem: z
    .enum(['fonte', 'pedido_da_pessoa'])
    .describe('`fonte`: um trecho registra (passe `refs`). `pedido_da_pessoa`: ela informou nesta conversa.'),
  refs: z.array(ref).max(4).default([]),
  substitui_id: z.string().min(1).optional().describe('O id (list_decisions) da decisão que esta substitui.'),
  motivo: z.string().trim().max(300).optional().describe('Por que mudou, como a fonte ou a pessoa disse.'),
});

export const recordDecision: DefinicaoDeFerramenta<z.infer<typeof decisaoSchema>> = {
  nome: 'record_decision',
  descricao:
    'Registra uma decisão (ou proposta). Para uma decisão revista, passe `substitui_id`: a anterior fica ' +
    'no histórico como substituída, ligada à nova e ao motivo. Decisão vinda de fonte precisa de `refs`.',
  schemaDeEntrada: decisaoSchema,
  efeito: 'escrita_local',
  requisitos: ['reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 4 },
  etapa: 'Registrando decisão',
  async executar(args, ctx) {
    if (args.origem === 'fonte' && !args.refs.length)
      throw new ErroDeFerramenta('evidencia_ausente', 'Decisão vinda de fonte precisa do rN do trecho.');
    if (args.origem === 'pedido_da_pessoa' && !termosDe(args.texto).some((t) => normalizar(ctx.tarefa.pedidoOriginal).includes(t)))
      throw new ErroDeFerramenta(
        'decisao_sem_sustentacao',
        'O pedido da pessoa nesta mensagem não traz essa decisão. Pergunte a ela ou cite a fonte.',
      );
    const evidencias = evidenciasDe(ctx, args.refs);
    if (args.substitui_id) {
      const { decisoes } = await ctx.armazenamento.trabalho.ler();
      exigirNoEscopo(ctx.tarefa.escopo, decisoes, args.substitui_id, 'decisão');
    }
    const r = await ctx.armazenamento.trabalho.registrarDecisao(
      {
        assunto: args.assunto,
        texto: args.texto,
        estado: args.estado,
        evidencias,
        ...(evidencias.find((e) => e.tipo === 'reuniao')
          ? { reuniaoId: evidencias.find((e) => e.tipo === 'reuniao')!.registroId }
          : {}),
        ...(args.substitui_id ? { substitui: args.substitui_id } : {}),
        ...(args.motivo ? { motivo: args.motivo } : {}),
      },
      { origem: args.origem === 'fonte' ? 'evidencia' : 'pessoa', execucaoId: ctx.tarefa.execucaoId },
    );
    if (r.tipo === 'invalido') throw new ErroDeFerramenta('decisao_invalida', r.motivo);
    ctx.registrarCartao({
      tipo: 'decisoes',
      ids: [r.decisao.id, ...(r.substituida ? [r.substituida.id] : [])],
    });
    return {
      decisao_id: r.decisao.id,
      ja_existia: r.jaExistia,
      ...(r.substituida ? { substituiu: { id: r.substituida.id, texto: r.substituida.texto } } : {}),
    };
  },
  resumir: (s) => (s.ja_existia ? 'decisão já registrada' : s.substituiu ? 'decisão registrada (substitui outra)' : 'decisão registrada'),
};

async function decisaoParaModelo(ctx: ContextoDeFerramenta, d: Decisao, todas: readonly Decisao[]) {
  return {
    id: d.id,
    assunto: d.assunto,
    texto: d.texto,
    estado: d.estado,
    registrada_em: new Date(d.criadoEm).toISOString().slice(0, 10),
    ...(d.substitui ? { substitui: todas.find((x) => x.id === d.substitui)?.texto ?? '(removida)' } : {}),
    ...(d.substituidaPor ? { substituida_por: todas.find((x) => x.id === d.substituidaPor)?.texto ?? '(removida)' } : {}),
    ...(d.motivo ? { motivo: d.motivo } : {}),
    origem: d.evidencias.length ? 'fonte' : 'informada pela pessoa',
    fontes: await Promise.all(d.evidencias.slice(0, 2).map((e) => citavel(ctx, e))),
  };
}

export const listDecisions: DefinicaoDeFerramenta<{ assunto?: string; reuniao_id?: string; limite: number }> = {
  nome: 'list_decisions',
  descricao:
    'Lista as decisões REGISTRADAS do escopo (confirmadas, propostas e substituídas, com a ligação entre ' +
    'elas e o motivo). Use para saber o que vale hoje e o que mudou.',
  schemaDeEntrada: z.object({
    assunto: z.string().max(120).optional(),
    reuniao_id: z.string().min(1).optional(),
    limite: z.number().int().min(1).max(30).default(15),
  }),
  efeito: 'leitura',
  requisitos: ['reunioes'],
  politica: { repeticao: 'leitura' },
  etapa: 'Consultando decisões',
  async executar(args, ctx) {
    const { decisoes } = await ctx.armazenamento.trabalho.ler();
    const termos = args.assunto ? termosDe(args.assunto) : [];
    const filtradas = decisoes
      .filter((d) => noEscopo(ctx.tarefa.escopo, d))
      .filter((d) => !args.reuniao_id || d.reuniaoId === args.reuniao_id)
      .filter((d) => !termos.length || termos.some((t) => normalizar(`${d.assunto} ${d.texto}`).includes(t)));
    const pagina = filtradas.slice(0, args.limite);
    if (pagina.length) ctx.registrarCartao({ tipo: 'decisoes', ids: pagina.map((d) => d.id) });
    return {
      total: filtradas.length,
      decisoes: await Promise.all(pagina.map((d) => decisaoParaModelo(ctx, d, decisoes))),
      ...(filtradas.length === 0 ? { aviso: 'Nenhuma decisão registrada com esses filtros. Procure nas reuniões.' } : {}),
    };
  },
  resumir: (s) => `${s.total as number} decisão(ões)`,
};

// ------------------------------------------------------------------ achados

const achadoSchema = z.object({
  tipo: z.enum(['desalinhamento', 'risco', 'lacuna']),
  assunto: z.string().trim().min(2).max(160),
  entendimentos: z
    .array(
      z.object({
        area: z.string().trim().max(60).optional().describe('A área ou o lado, só se a fonte disser.'),
        texto: z.string().trim().min(3).max(400).describe('O que ESTA fonte diz, sem julgamento.'),
        ref,
      }),
    )
    .min(1)
    .max(6),
  impacto: z.string().trim().max(300).optional().describe('Hipótese de impacto — dita como hipótese.'),
  pergunta: z.string().trim().max(300).optional().describe('A pergunta que resolveria a divergência.'),
  classificacao: z.enum(['possivel', 'sustentado']).default('possivel'),
});

export const saveFinding: DefinicaoDeFerramenta<z.infer<typeof achadoSchema>> = {
  nome: 'save_finding',
  descricao:
    'Registra um achado (possível desalinhamento entre fontes, risco ou lacuna) com o entendimento de ' +
    'CADA fonte e seu `ref`. Desalinhamento precisa de duas fontes diferentes. Fica "possível" até haver ' +
    'sustentação; não julga pessoas nem áreas. Não duplica o mesmo achado.',
  schemaDeEntrada: achadoSchema,
  efeito: 'escrita_local',
  requisitos: ['reunioes', 'documentos'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 5 },
  etapa: 'Registrando achado',
  async executar(args, ctx) {
    const entendimentos = args.entendimentos.map((e) => ({
      ...(e.area ? { area: e.area } : {}),
      texto: e.texto,
      evidencia: evidenciaDe(ctx, e.ref),
    }));
    const fontes = new Set(entendimentos.map((e) => e.evidencia.registroId));
    if (args.tipo === 'desalinhamento' && fontes.size < 2)
      throw new ErroDeFerramenta(
        'fontes_insuficientes',
        'Desalinhamento compara pelo menos duas fontes diferentes. Com uma só, registre como risco ou lacuna.',
      );
    const { achado, jaExistia } = await ctx.armazenamento.trabalho.guardarAchado(
      {
        tipo: args.tipo,
        assunto: args.assunto,
        entendimentos,
        classificacao: args.classificacao,
        ...(args.impacto ? { impacto: args.impacto } : {}),
        ...(args.pergunta ? { pergunta: args.pergunta } : {}),
      },
      { origem: 'taq', execucaoId: ctx.tarefa.execucaoId },
    );
    ctx.registrarCartao({ tipo: 'achados', ids: [achado.id] });
    return { achado_id: achado.id, revisao: achado.revisao, estado: achado.estado, ja_existia: jaExistia };
  },
  resumir: (s) => (s.ja_existia ? 'achado já registrado' : 'achado registrado'),
};

async function achadoParaModelo(ctx: ContextoDeFerramenta, a: Achado) {
  return {
    id: a.id,
    revisao: a.revisao,
    tipo: a.tipo,
    assunto: a.assunto,
    classificacao: a.classificacao,
    estado: a.estado,
    entendimentos: await Promise.all(
      a.entendimentos.map(async (e) => ({ ...(e.area ? { area: e.area } : {}), texto: e.texto, fonte: await citavel(ctx, e.evidencia) })),
    ),
    ...(a.impacto ? { impacto: a.impacto } : {}),
    ...(a.pergunta ? { pergunta: a.pergunta } : {}),
    ...(a.resolucao ? { resolucao: a.resolucao.texto } : {}),
  };
}

export const listFindings: DefinicaoDeFerramenta<{ estado: 'aberto' | 'resolvido' | 'descartado' | 'todos'; limite: number }> = {
  nome: 'list_findings',
  descricao: 'Lista os achados registrados do escopo (abertos, por padrão), com os entendimentos de cada fonte.',
  schemaDeEntrada: z.object({
    estado: z.enum(['aberto', 'resolvido', 'descartado', 'todos']).default('aberto'),
    limite: z.number().int().min(1).max(20).default(10),
  }),
  efeito: 'leitura',
  requisitos: ['reunioes'],
  politica: { repeticao: 'leitura' },
  etapa: 'Consultando achados',
  async executar(args, ctx) {
    const { achados } = await ctx.armazenamento.trabalho.ler();
    const filtrados = achados
      .filter((a) => noEscopo(ctx.tarefa.escopo, a))
      .filter((a) => args.estado === 'todos' || a.estado === args.estado);
    const pagina = filtrados.slice(0, args.limite);
    if (pagina.length) ctx.registrarCartao({ tipo: 'achados', ids: pagina.map((a) => a.id) });
    return { total: filtrados.length, achados: await Promise.all(pagina.map((a) => achadoParaModelo(ctx, a))) };
  },
  resumir: (s) => `${s.total as number} achado(s)`,
};

const resolucaoSchema = z.object({
  achado_id: z.string().min(1),
  revisao: z.number().int().min(1),
  estado: z.enum(['resolvido', 'descartado', 'aberto']),
  texto: z.string().trim().min(3).max(400).describe('O que resolveu, o motivo do descarte ou da reabertura.'),
  origem: z.enum(['pedido_da_pessoa', 'evidencia']),
  ref: ref.optional().describe('Com origem `evidencia`: o trecho (ex.: a decisão posterior explícita).'),
});

export const resolveFinding: DefinicaoDeFerramenta<z.infer<typeof resolucaoSchema>> = {
  nome: 'resolve_finding',
  descricao:
    'Resolve, descarta ou reabre um achado, na `revisao` lida. Resolver por evidência exige o `ref` do ' +
    'trecho que resolve (uma decisão explícita posterior, por exemplo). O histórico guarda cada passagem.',
  schemaDeEntrada: resolucaoSchema,
  efeito: 'escrita_local',
  requisitos: ['reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 5 },
  etapa: 'Atualizando achado',
  async executar(args, ctx) {
    const { achados } = await ctx.armazenamento.trabalho.ler();
    exigirNoEscopo(ctx.tarefa.escopo, achados, args.achado_id, 'achado');
    if (args.origem === 'evidencia' && !args.ref)
      throw new ErroDeFerramenta('evidencia_ausente', 'Resolver por evidência pede o `ref` do trecho.');
    const evidencia = args.ref ? evidenciaDe(ctx, args.ref) : undefined;
    const r = await ctx.armazenamento.trabalho.mudarEstadoDoAchado(
      args.achado_id,
      args.revisao,
      { estado: args.estado, texto: args.texto, ...(evidencia ? { evidencia } : {}) },
      { origem: args.origem === 'evidencia' ? 'evidencia' : 'pessoa', execucaoId: ctx.tarefa.execucaoId },
    );
    if (r.tipo === 'inexistente') throw new ErroDeFerramenta('nao_encontrado', 'O achado não existe mais.');
    if (r.tipo === 'invalido') throw new ErroDeFerramenta('mudanca_invalida', r.motivo);
    if (r.tipo === 'conflito')
      throw new ErroDeFerramenta('conflito_de_versao', `O achado mudou depois da leitura (revisão ${r.atual.revisao}).`, {
        revisao_atual: r.atual.revisao,
      });
    ctx.registrarCartao({ tipo: 'achados', ids: [r.item.id] });
    return { achado_id: r.item.id, estado: r.item.estado, revisao: r.item.revisao };
  },
  resumir: (s) => `achado ${s.estado as string}`,
};

// ----------------------------------------------------------------- captura

/** A reunião da captura: a pedida; senão a da conversa; senão a que está em curso. */
async function reuniaoDaCaptura(ctx: ContextoDeFerramenta, id: string | undefined): Promise<MeetingRecord> {
  if (id) return reuniaoNoEscopo(ctx, id);
  const daConversa =
    ctx.tarefa.selecionados.find((s) => s.tipo === 'reuniao')?.id ??
    (ctx.tarefa.escopo.reunioes !== 'todas' ? ctx.tarefa.escopo.reunioes[0] : undefined);
  if (daConversa) return reuniaoNoEscopo(ctx, daConversa);
  const noEscopo = (await ctx.armazenamento.listarReunioes()).filter((r) =>
    podeLerReuniao(ctx.tarefa.escopo, r.id),
  );
  const pelaFala = peloTitulo(noEscopo, ctx.tarefa.pedidoOriginal, (r) => r.title);
  if (pelaFala) return pelaFala;
  const emCurso = noEscopo
    .filter((r) => r.status === 'recording')
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  if (!emCurso)
    throw new ErroDeFerramenta('nao_encontrado', 'Não há reunião em andamento. Diga de qual reunião quer o estado.');
  return emCurso;
}

/**
 * O registro que o pedido nomeia pelo título ("a captura do planejamento do
 * painel"): o de maior número de palavras do pedido no título, se for o único
 * com essa contagem e casar pelo menos duas palavras. Na dúvida, nenhum —
 * quem chama pergunta ou devolve `nao_encontrado`, nunca escolhe a esmo.
 */
export function peloTitulo<T>(registros: readonly T[], pedido: string, titulo: (r: T) => string): T | undefined {
  const termos = termosDe(pedido);
  const pontos = registros.map((r) => {
    const t = ` ${termosDe(titulo(r)).join(' ')} `;
    return { r, n: termos.filter((x) => t.includes(` ${x} `)).length };
  });
  const melhor = Math.max(0, ...pontos.map((p) => p.n));
  const empatados = pontos.filter((p) => p.n === melhor);
  return melhor >= 2 && empatados.length === 1 ? empatados[0]!.r : undefined;
}

export const getCaptureState: DefinicaoDeFerramenta<{ reuniao_id?: string }> = {
  nome: 'get_capture_state',
  descricao:
    'Diz o estado e a confiabilidade da captura de uma reunião por sinais verificáveis (trechos ' +
    'descartados, reconexões, modo degradado, legenda ilegível, intervalos sem fala). Determinística. ' +
    'Intervalo sem fala pode ser silêncio: não é perda.',
  schemaDeEntrada: z.object({ reuniao_id: z.string().min(1).optional() }),
  efeito: 'leitura',
  requisitos: ['reunioes'],
  politica: { repeticao: 'leitura' },
  etapa: 'Conferindo a captura',
  async executar(args, ctx) {
    const r = await reuniaoDaCaptura(ctx, args.reuniao_id);
    const a = avaliarCaptura(r, await ctx.armazenamento.lerEstadoAoVivo());
    ctx.registrarCartao({
      tipo: 'estado_da_captura',
      reuniaoId: r.id,
      titulo: r.title,
      situacao: a.situacao,
      avaliacao: a.avaliacao,
      sinais: a.sinais,
      intervalos: a.intervalos,
      segmentos: a.segmentos,
      ...(a.ultimaAtualizacao ? { ultimaAtualizacao: a.ultimaAtualizacao } : {}),
    });
    return {
      reuniao: { id: r.id, titulo: r.title },
      situacao: a.situacao,
      avaliacao: a.avaliacao,
      sinais: a.sinais,
      intervalos_sem_fala: a.intervalos.map((i) => `${instante(i.deMs)}–${instante(i.ateMs)}`),
      segmentos: a.segmentos,
    };
  },
  resumir: (s) => `captura: ${s.situacao as string}`,
};

// ----------------------------------------------------------------- revisão

export const checkDocument: DefinicaoDeFerramenta<{ documento_id: string }> = {
  nome: 'check_document',
  descricao:
    'Revisa um documento sem opinião: seções obrigatórias do modelo ausentes ou vazias, "A confirmar" ' +
    'restantes, repetições, notas sem fonte, e se cada fonte ainda existe e contém o trecho. Não julga ' +
    'se a interpretação está certa.',
  schemaDeEntrada: z.object({ documento_id: z.string().min(1) }),
  efeito: 'leitura',
  requisitos: ['documentos', 'reunioes'],
  politica: { repeticao: 'leitura' },
  etapa: 'Revisando o documento',
  async executar(args, ctx) {
    const d = await documentoNoEscopo(ctx, args.documento_id);
    const reunioes = (await ctx.armazenamento.listarReunioes()).filter((r) =>
      podeLerReuniao(ctx.tarefa.escopo, r.id),
    );
    const rev = revisarDocumento(d, reunioes);
    ctx.registrarCartao({
      tipo: 'revisao_de_documento',
      documentoId: d.id,
      titulo: d.title,
      versao: String(d.updatedAt),
      problemas: rev.problemas,
      fontes: rev.fontes,
    });
    return {
      documento: { id: d.id, titulo: d.title, tipo: rev.tipo?.nome ?? d.tipo ?? 'sem tipo do catálogo', versao: d.updatedAt },
      problemas: rev.problemas,
      fontes: rev.fontes.map((f) => ({ numero: f.numero, situacao: f.situacao })),
      aviso: '"conferida" quer dizer que o trecho está na fonte, não que a frase o interprete bem.',
    };
  },
  resumir: (s) => `${(s.problemas as unknown[]).length} problema(s)`,
};

// -------------------------------------------------------------- comunicação

const EMAIL = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;

const mensagemSchema = z.object({
  canal: z.enum(['email', 'chat', 'outro']),
  publico: z.enum(['interno', 'externo']).describe('Externo: gente de fora do CITi.'),
  destinatarios: z
    .array(
      z.object({
        nome: z.string().trim().min(1).max(80),
        endereco: z.string().trim().max(120).optional().describe('Só se a PESSOA escreveu o endereço.'),
      }),
    )
    .max(10)
    .default([]),
  assunto: z.string().trim().max(160).optional(),
  corpo: z.string().trim().min(1).max(6_000),
  reuniao_id: z.string().min(1).optional().describe('A reunião cujos participantes servem para conferir os nomes.'),
});

/** Os nomes conhecidos das reuniões do escopo: participantes e quem falou. */
function nomesConhecidos(reunioes: readonly MeetingRecord[]): string[] {
  const nomes = new Set<string>();
  for (const r of reunioes) {
    for (const p of r.participants) if (p.name?.trim()) nomes.add(p.name.trim());
    for (const s of r.speakersObserved ?? []) if (s.name?.trim()) nomes.add(s.name.trim());
    for (const s of r.segments) if (s.speaker?.trim()) nomes.add(s.speaker.trim());
  }
  return [...nomes];
}

export const prepareMessage: DefinicaoDeFerramenta<z.infer<typeof mensagemSchema>> = {
  nome: 'prepare_message',
  descricao:
    'Prepara um RASCUNHO de mensagem num cartão editável, com destinatários conferidos contra os ' +
    'participantes das reuniões (nome parecido com mais de uma pessoa vira "ambíguo") e alertas de ' +
    'conteúdo sensível. NADA É ENVIADO: não há integração de e-mail ou chat nesta versão; a pessoa copia ' +
    'ou abre no programa de e-mail dela.',
  schemaDeEntrada: mensagemSchema,
  efeito: 'leitura',
  requisitos: ['reunioes'],
  politica: { repeticao: 'leitura', maxPorExecucao: 2 },
  etapa: 'Preparando o rascunho',
  async executar(args, ctx) {
    const reunioes = args.reuniao_id
      ? [await reuniaoNoEscopo(ctx, args.reuniao_id)]
      : (await ctx.armazenamento.listarReunioes()).filter((r) => podeLerReuniao(ctx.tarefa.escopo, r.id));
    const conhecidos = nomesConhecidos(reunioes);
    const pedido = normalizar(ctx.tarefa.pedidoOriginal);
    const alertas: string[] = [];
    const destinatarios = args.destinatarios.map((d) => {
      const endereco = d.endereco && EMAIL.test(d.endereco) && pedido.includes(d.endereco.toLowerCase()) ? d.endereco : undefined;
      if (d.endereco && !endereco)
        alertas.push(`O endereço de ${d.nome} foi retirado: só entra endereço que você mesmo escreveu.`);
      if (endereco) return { nome: d.nome, endereco, situacao: 'informado' as const };
      const exatos = conhecidos.filter((n) => normalizar(n) === normalizar(d.nome));
      const parecidos = exatos.length ? exatos : conhecidos.filter((n) => nomeAparece(d.nome, n));
      if (parecidos.length === 1) return { nome: parecidos[0]!, situacao: 'verificado' as const };
      if (parecidos.length > 1)
        return { nome: d.nome, situacao: 'ambiguo' as const, candidatos: parecidos.slice(0, 5) };
      return { nome: d.nome, situacao: 'nao_encontrado' as const };
    });
    const sensiveis = acharSensiveis(`${args.assunto ?? ''}\n${args.corpo}`);
    alertas.push(...avisosDeExposicao(sensiveis));
    if (args.publico === 'externo' && /\[(?:r\d+|\d+)\]/.test(args.corpo))
      alertas.push('O texto tem marcas de citação internas; tire-as antes de enviar para fora.');
    ctx.registrarCartao({
      tipo: 'rascunho_de_mensagem',
      canal: args.canal,
      publico: args.publico,
      destinatarios,
      ...(args.assunto ? { assunto: args.assunto } : {}),
      corpo: args.corpo,
      alertas,
    });
    return {
      rascunho_preparado: true,
      enviado: false,
      destinatarios: destinatarios.map((d) => ({ nome: d.nome, situacao: d.situacao, ...('candidatos' in d ? { candidatos: d.candidatos } : {}) })),
      alertas,
      aviso:
        'Nada foi enviado e não há como enviar daqui. Diga que o rascunho está no cartão para revisar, copiar ou abrir no e-mail. Se um destinatário ficou ambíguo, pergunte qual.',
    };
  },
  resumir: (s) => `rascunho preparado (${(s.destinatarios as unknown[]).length} destinatário(s))`,
};

// ------------------------------------------------------------------- agenda

const eventoSchema = z.object({
  titulo: z.string().trim().min(2).max(160),
  duracao_min: z.number().int().min(5).max(480).default(30),
  participantes: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  opcoes: z
    .array(
      z.object({
        data: dataIso,
        hora: z.string().regex(/^\d{2}:\d{2}$/).describe('Hora LOCAL de quem usa, HH:MM.'),
      }),
    )
    .min(1)
    .max(5),
  descricao: z.string().trim().max(1_000).optional(),
});

export const prepareEvent: DefinicaoDeFerramenta<z.infer<typeof eventoSchema>> = {
  nome: 'prepare_event',
  descricao:
    'Monta SUGESTÕES de horário para um encontro, no fuso de quem usa (o do contexto), convertidas em ' +
    'código. A disponibilidade NÃO é verificada: não há integração de calendário nesta versão. O cartão ' +
    'abre o formulário do Google Agenda preenchido, sem convidados — quem cria e convida é a pessoa.',
  schemaDeEntrada: eventoSchema,
  efeito: 'leitura',
  requisitos: [],
  politica: { repeticao: 'leitura', maxPorExecucao: 2 },
  etapa: 'Montando sugestões de horário',
  async executar(args, ctx) {
    void ctx;
    const fuso = fusoDeQuemUsa();
    if (!fusoValido(fuso)) throw new ErroDeFerramenta('fuso_invalido', `Fuso desconhecido: ${fuso}.`);
    const agora = Date.now();
    const recusadas: string[] = [];
    const opcoes = args.opcoes.flatMap((o) => {
      let inicio: number;
      try {
        inicio = localParaInstante(o.data, o.hora, fuso);
      } catch (e) {
        recusadas.push(`${o.data} ${o.hora}: ${(e as Error).message}`);
        return [];
      }
      if (inicio <= agora) {
        recusadas.push(`${o.data} ${o.hora}: já passou`);
        return [];
      }
      const fim = inicio + args.duracao_min * 60_000;
      return [{ inicio: new Date(inicio).toISOString(), fim: new Date(fim).toISOString(), rotulo: rotuloDoHorario(inicio, fuso) }];
    });
    if (!opcoes.length)
      throw new ErroDeFerramenta('sem_horario_valido', `Nenhum horário válido: ${recusadas.join('; ')}.`);
    ctx.registrarCartao({
      tipo: 'sugestao_de_evento',
      titulo: args.titulo,
      duracaoMin: args.duracao_min,
      fuso,
      participantes: args.participantes,
      opcoes,
      ...(args.descricao ? { descricao: args.descricao } : {}),
    });
    return {
      fuso,
      opcoes: opcoes.map((o) => o.rotulo),
      recusadas,
      disponibilidade_verificada: false,
      evento_criado: false,
      aviso: 'Diga que são sugestões, com disponibilidade não verificada, e que nada foi criado nem enviado.',
    };
  },
  resumir: (s) => `${(s.opcoes as unknown[]).length} sugestão(ões) de horário`,
};

// -------------------------------------------------------------- privacidade

export const reviewPrivacy: DefinicaoDeFerramenta<{ texto: string }> = {
  nome: 'review_privacy',
  descricao:
    'Aponta o que, num texto a ser compartilhado, PARECE dado pessoal ou segredo (e-mail, telefone, CPF, ' +
    'CNPJ, cartão, senha/token, chave longa) e prepara uma cópia com esses trechos ocultados. Reconhece ' +
    'formatos, não contexto: não é garantia de que o texto está limpo. O original não muda.',
  schemaDeEntrada: z.object({ texto: z.string().min(1).max(20_000) }),
  efeito: 'leitura',
  requisitos: [],
  politica: { repeticao: 'leitura', maxPorExecucao: 2 },
  etapa: 'Revisando o que vai ser exposto',
  async executar(args, ctx) {
    const trechos = acharSensiveis(args.texto);
    if (trechos.length) ctx.registrarCopiavel(ocultarSensiveis(args.texto, trechos));
    const porTipo = new Map<string, number>();
    for (const t of trechos) porTipo.set(NOME_DO_TIPO[t.tipo], (porTipo.get(NOME_DO_TIPO[t.tipo]) ?? 0) + 1);
    return {
      achados: [...porTipo].map(([tipo, ocorrencias]) => ({ tipo, ocorrencias })),
      copia_ocultada_preparada: trechos.length > 0,
      aviso: 'Reconhece formatos, não contexto. Diga que é uma revisão de apoio, não uma garantia.',
    };
  },
  resumir: (s) => `${(s.achados as unknown[]).length} tipo(s) sensível(is)`,
};

export const FERRAMENTAS_DE_TRABALHO: readonly DefinicaoDeFerramenta[] = [
  saveAnalysis,
  readAnalysis,
  suggestCommitments,
  registerCommitments,
  listCommitments,
  updateCommitment,
  linkDependency,
  recordDecision,
  listDecisions,
  saveFinding,
  listFindings,
  resolveFinding,
  getCaptureState,
  checkDocument,
  prepareMessage,
  prepareEvent,
  reviewPrivacy,
] as unknown as readonly DefinicaoDeFerramenta[];
