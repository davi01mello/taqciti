/**
 * As ferramentas do orquestrador — todas sobre a persistência que já existe.
 *
 *   search_records   achar reuniões e documentos (texto + filtros)
 *   read_meeting     metadados e uma FATIA da transcrição
 *   read_document    um documento, sua versão e uma fatia do texto
 *   read_conversation uma FATIA de outra conversa, dizendo quem escreveu cada mensagem
 *   create_document  gravar um documento pedido pela pessoa (idempotente)
 *   update_document  editar com verificação de versão
 *   delegate_task    executar um especialista DISPONÍVEL
 *
 * Leitura é sempre em fatia e com teto: nenhuma ferramenta devolve uma
 * transcrição inteira nem a base inteira. Todo trecho devolvido entra no livro
 * de evidências e ganha um `ref` para ser citado.
 *
 * Não há ferramenta de sistema de arquivos, SQL, rede ou código. O que o
 * orquestrador precisa, ele tem por nome.
 */
import { z } from 'zod/v4';
import type { MeetingRecord } from '@/shared/types/domain';
import type { DocumentoGuardado } from '@/features/documents/store';
import { versaoDaReuniao } from './armazenamento';
import {
  CATALOGO_DE_DOCUMENTOS,
  IDS_DE_TIPO,
  tipoDeDocumento,
  type TipoDeDocumento,
} from '@/features/documents/catalogo';
import { buscarConversas, buscarRegistros, normalizar, termosDe } from './busca';
import { citacoesParaDocumento } from './evidencias';
import { transcriptToText } from '@/features/history/export';
import { gerarPersonalizado } from '@/features/documents/personalizado/cliente';
import { guardarGeracao } from '@/features/documents/personalizado/documento';
import { MOTIVOS_DE_PERGUNTA, type FichaDeAgente, type Pergunta, type Tarefa } from './contratos';
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

const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('Data no formato AAAA-MM-DD.');

export function instante(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${seg}` : `${m}:${seg}`;
}

/** Hash curto e estável (FNV-1a) — para chave de idempotência, não para segurança. */
export function hash(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * O índice do contexto mostra "reuniao <id>"; visto ao vivo, o modelo às vezes
 * passa o prefixo junto ("reuniao demo-produto"). Tira só esse prefixo.
 */
export function limparId(id: string): string {
  return id
    .trim()
    .replace(/^(reuniao|reunião|documento|conversa)[\s:=]+/i, '')
    .replace(/^id[\s:=]+/i, '');
}

export async function reuniaoNoEscopo(
  ctx: ContextoDeFerramenta,
  bruto: string,
): Promise<MeetingRecord> {
  const id = limparId(bruto);
  exigirReuniao(ctx.tarefa.escopo, id);
  const r = await ctx.armazenamento.obterReuniao(id);
  if (!r) {
    throw new ErroDeFerramenta(
      'nao_encontrado',
      `Não há reunião com o id ${id}. Use search_records para obter ids reais.`,
    );
  }
  return r;
}

export async function documentoNoEscopo(
  ctx: ContextoDeFerramenta,
  bruto: string,
): Promise<DocumentoGuardado> {
  const id = limparId(bruto);
  const d = await ctx.armazenamento.obterDocumento(id);
  if (!d) {
    throw new ErroDeFerramenta(
      'nao_encontrado',
      `Não há documento com o id ${id}. Use search_records para obter ids reais.`,
    );
  }
  exigirDocumento(ctx.tarefa.escopo, d);
  return d;
}

// ------------------------------------------------------------ search_records

const buscaSchema = z.object({
  consulta: z
    .string()
    .max(200)
    .default('')
    .describe('Palavras a procurar. Vazio lista os registros mais recentes.'),
  tipos: z
    .array(z.enum(['reuniao', 'documento', 'conversa']))
    .max(3)
    .optional()
    .describe('Sem tipos: reuniões e documentos. Conversas só entram quando pedidas.'),
  desde: dataIso.optional(),
  ate: dataIso.optional(),
  limite: z.number().int().min(1).max(10).default(6),
  pagina: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(1)
    .describe('Para ver mais resultados da mesma busca: a página seguinte à devolvida.'),
});

export const searchRecords: DefinicaoDeFerramenta<z.infer<typeof buscaSchema>> = {
  nome: 'search_records',
  descricao:
    'Procura reuniões e documentos do escopo desta conversa por palavras (ignora acento e ' +
    'caixa; não conhece sinônimos) e filtros de tipo e data. Devolve até 10 registros por ' +
    'página, cada um com até 3 trechos curtos e a referência (`ref`) de cada trecho para citar. ' +
    'Com `consulta` vazia, lista os mais recentes. Com tipo "conversa", procura também nas ' +
    'outras conversas guardadas: esses trechos dizem QUEM escreveu e NÃO têm `ref` — resposta ' +
    'antiga do Taq não é fonte; confirme na reunião ou no documento. Comece por aqui.',
  schemaDeEntrada: buscaSchema,
  efeito: 'leitura',
  requisitos: ['reunioes', 'documentos'],
  politica: { repeticao: 'leitura' },
  etapa: 'Buscando contexto',
  async executar(args, ctx) {
    const { escopo } = ctx.tarefa;
    const reunioes = (await ctx.armazenamento.listarReunioes()).filter((r) =>
      podeLerReuniao(escopo, r.id),
    );
    const documentos = (await ctx.armazenamento.listarDocumentos()).filter((d) =>
      podeLerDocumento(escopo, d),
    );
    const tiposDeRegistro = (args.tipos ?? []).filter(
      (t): t is 'reuniao' | 'documento' => t !== 'conversa',
    );
    const soConversas = !!args.tipos?.length && !tiposDeRegistro.length;
    const pular = (args.pagina - 1) * args.limite;
    const filtros = {
      consulta: args.consulta,
      desde: args.desde,
      ate: args.ate,
      // Um a mais, para saber se existe a página seguinte sem contar tudo.
      limite: args.limite + 1,
      pular,
    };
    const achados = soConversas
      ? []
      : buscarRegistros(
          { ...filtros, ...(tiposDeRegistro.length ? { tipos: tiposDeRegistro } : {}) },
          { reunioes, documentos },
        );
    const temMais = achados.length > args.limite;
    const acertos = achados.slice(0, args.limite);

    const conversasAchadas = args.tipos?.includes('conversa')
      ? buscarConversas(
          filtros,
          (await ctx.armazenamento.listarConversas()).filter(
            (c) => c.id !== ctx.tarefa.conversaId && podeLerConversa(escopo, c),
          ),
        )
      : [];
    const maisConversas = conversasAchadas.length > args.limite;

    const porId = new Map<string, MeetingRecord | DocumentoGuardado>([
      ...reunioes.map((r) => [`reuniao:${r.id}`, r] as const),
      ...documentos.map((d) => [`documento:${d.id}`, d] as const),
    ]);

    const conversas = conversasAchadas.slice(0, args.limite).map((c) => ({
      tipo: 'conversa' as const,
      id: c.id,
      titulo: c.titulo,
      data: c.data,
      trechos: c.trechos.map((t) => ({
        mensagem: t.mensagem,
        quem: t.papel === 'pessoa' ? 'a pessoa' : 'resposta anterior do Taq (não é fonte)',
        texto: t.texto,
      })),
    }));

    return {
      total: acertos.length + conversas.length,
      pagina: args.pagina,
      ...(temMais || maisConversas ? { proxima_pagina: args.pagina + 1 } : {}),
      ...(conversas.length ? { conversas } : {}),
      resultados: acertos.map((a) => {
        const registro = porId.get(`${a.tipo}:${a.id}`)!;
        const versao =
          a.tipo === 'reuniao'
            ? versaoDaReuniao(registro as MeetingRecord)
            : String((registro as DocumentoGuardado).updatedAt);
        return {
          tipo: a.tipo,
          id: a.id,
          titulo: a.titulo,
          data: a.data,
          trechos: a.trechos.map((t) => ({
            ref: ctx.livro.registrar({
              tipo: a.tipo,
              registroId: a.id,
              titulo: a.titulo,
              versao,
              trecho: t.texto,
              local: t.local,
            }),
            ...(t.local.segmento !== undefined ? { segmento: t.local.segmento } : {}),
            ...(t.local.offsetMs !== undefined
              ? { instante: instante(t.local.offsetMs) }
              : {}),
            ...(t.falante !== undefined
              ? { falante: t.falante ?? '(não identificado)' }
              : {}),
            texto: t.texto,
          })),
        };
      }),
      ...(acertos.length === 0 && conversas.length === 0
        ? {
            aviso:
              'Nada encontrado. Tente menos palavras ou outro termo — a busca não conhece sinônimos.',
          }
        : {}),
    };
  },
  resumir: (s) => `${s.total as number} resultado(s)`,
};

// -------------------------------------------------------------- read_meeting

const leituraDeReuniaoSchema = z.object({
  reuniao_id: z.string().min(1),
  a_partir_do_segmento: z.number().int().min(0).default(0),
  quantidade: z.number().int().min(1).max(40).default(25),
  consulta: z
    .string()
    .max(200)
    .optional()
    .describe('Quando presente, devolve só os segmentos que contêm estas palavras.'),
});

/** Teto de uma fala dentro da fatia — fala enorme não pode comer a fatia toda. */
const MAX_FALA = 1_200;

export const readMeeting: DefinicaoDeFerramenta<z.infer<typeof leituraDeReuniaoSchema>> =
  {
    nome: 'read_meeting',
    descricao:
      'Abre uma reunião pelo id: título, data, duração, participantes, quem falou, total de ' +
      'segmentos e a versão. Traz uma FATIA da transcrição (até 40 segmentos a partir de ' +
      '`a_partir_do_segmento`), cada segmento com `ref`, instante e falante. Com `consulta`, ' +
      'traz só os segmentos que contêm as palavras. Para continuar, use `proximo`.',
    schemaDeEntrada: leituraDeReuniaoSchema,
    efeito: 'leitura',
    requisitos: ['reunioes'],
    politica: { repeticao: 'leitura' },
    etapa: 'Consultando uma reunião',
    async executar(args, ctx) {
      const r = await reuniaoNoEscopo(ctx, args.reuniao_id);
      const versao = versaoDaReuniao(r);
      const termos = args.consulta ? termosDe(args.consulta) : [];
      const teto = ctx.tarefa.limites.maxCaracteresPorResultado * 0.75;

      const indices = r.segments
        .map((_, i) => i)
        .filter((i) => i >= args.a_partir_do_segmento)
        .filter((i) => {
          if (!termos.length) return true;
          const s = r.segments[i]!;
          const t = normalizar(`${s.speaker ?? ''} ${s.text}`);
          return termos.some((termo) => t.includes(termo));
        });

      const segmentos: Record<string, unknown>[] = [];
      let usados = 0;
      let ultimo = -1;
      for (const i of indices) {
        if (segmentos.length >= args.quantidade) break;
        const s = r.segments[i]!;
        const texto = s.text.length > MAX_FALA ? s.text.slice(0, MAX_FALA) : s.text;
        if (usados + texto.length > teto && segmentos.length > 0) break;
        usados += texto.length;
        ultimo = i;
        segmentos.push({
          ref: ctx.livro.registrar({
            tipo: 'reuniao',
            registroId: r.id,
            titulo: r.title,
            versao,
            trecho: texto,
            local: {
              segmento: i,
              offsetMs: Math.max(0, Math.round(s.startOffsetMs)),
              ...(s.captionId ? { captionId: s.captionId } : {}),
            },
          }),
          segmento: i,
          instante: instante(s.startOffsetMs),
          falante: s.speaker ?? '(não identificado)',
          texto,
          ...(texto.length < s.text.length ? { cortado: true } : {}),
        });
      }
      const restantes = indices.filter((i) => i > ultimo);
      const falaram = [...new Set(r.segments.map((s) => s.speaker).filter(Boolean))];

      return {
        reuniao: {
          id: r.id,
          titulo: r.title,
          inicio: new Date(r.startedAt).toISOString(),
          duracao_min: Math.round(r.durationSeconds / 60),
          participantes: r.participants.map((p) => p.name),
          falaram,
          total_segmentos: r.segments.length,
          versao,
          ...(r.status === 'recording'
            ? { aviso: 'Reunião em andamento: a transcrição ainda cresce.' }
            : {}),
        },
        segmentos,
        ...(restantes.length ? { proximo: restantes[0] } : {}),
      };
    },
    resumir: (s) => `${(s.segmentos as unknown[]).length} segmento(s)`,
  };

// ------------------------------------------------------------- read_document

const leituraDeDocumentoSchema = z.object({
  documento_id: z.string().min(1),
  a_partir_do_caractere: z.number().int().min(0).default(0),
  quantidade: z.number().int().min(200).max(6_000).default(4_000),
});

export const readDocument: DefinicaoDeFerramenta<
  z.infer<typeof leituraDeDocumentoSchema>
> = {
  nome: 'read_document',
  descricao:
    'Abre um documento pelo id: título, tipo, vínculos, datas, `versao` e uma FATIA do texto ' +
    '(até 6000 caracteres a partir de `a_partir_do_caractere`), com `ref` para citar. Para ' +
    'editar, guarde a `versao` e passe-a para update_document.',
  schemaDeEntrada: leituraDeDocumentoSchema,
  efeito: 'leitura',
  requisitos: ['documentos'],
  politica: { repeticao: 'leitura' },
  etapa: 'Lendo um documento',
  async executar(args, ctx) {
    const d = await documentoNoEscopo(ctx, args.documento_id);
    const inicio = Math.min(args.a_partir_do_caractere, d.content.length);
    const texto = d.content.slice(inicio, inicio + args.quantidade);
    const fim = inicio + texto.length;
    return {
      documento: {
        id: d.id,
        titulo: d.title,
        ...(d.tipo ? { tipo: d.tipo } : {}),
        versao: d.updatedAt,
        ...(d.meetingId ? { reuniao_id: d.meetingId } : {}),
        criado: new Date(d.createdAt).toISOString(),
        atualizado: new Date(d.updatedAt).toISOString(),
        total_caracteres: d.content.length,
      },
      trecho: {
        ref: ctx.livro.registrar({
          tipo: 'documento',
          registroId: d.id,
          titulo: d.title,
          versao: String(d.updatedAt),
          trecho: texto,
          local: { inicio, fim },
        }),
        inicio,
        fim,
        texto,
      },
      ...(fim < d.content.length ? { proximo: fim } : {}),
    };
  },
  resumir: (s) => `${((s.trecho as { texto: string }).texto ?? '').length} caractere(s)`,
};

// --------------------------------------------------------- read_conversation

const leituraDeConversaSchema = z.object({
  conversa_id: z.string().min(1).describe('O id de uma conversa (search_records, tipo "conversa").'),
  a_partir_da_mensagem: z.number().int().min(0).default(0),
  quantidade: z.number().int().min(1).max(20).default(12),
});

/** Teto de uma mensagem dentro da fatia. */
const MAX_MENSAGEM = 1_500;

export const readConversation: DefinicaoDeFerramenta<
  z.infer<typeof leituraDeConversaSchema>
> = {
  nome: 'read_conversation',
  descricao:
    'Abre OUTRA conversa guardada pelo id: título, datas, a reunião que ela acompanha, e uma ' +
    'FATIA das mensagens (até 20), cada uma dizendo QUEM escreveu. Serve para retomar o que a ' +
    'pessoa já pediu ou disse. Resposta anterior do Taq NÃO confirma fato: confirme na reunião ' +
    'ou no documento antes de afirmar. Não tem `ref` para citar.',
  schemaDeEntrada: leituraDeConversaSchema,
  efeito: 'leitura',
  requisitos: [],
  politica: { repeticao: 'leitura', maxPorExecucao: 3 },
  etapa: 'Consultando uma conversa',
  async executar(args, ctx) {
    const c = (await ctx.armazenamento.listarConversas()).find((x) => x.id === args.conversa_id);
    if (!c) {
      throw new ErroDeFerramenta(
        'nao_encontrado',
        `Não há conversa com o id ${args.conversa_id} (pode ter sido apagada). Use search_records.`,
      );
    }
    if (!podeLerConversa(ctx.tarefa.escopo, c)) {
      throw new ErroDeFerramenta(
        'fora_do_escopo',
        `A conversa ${c.id} está fora do escopo desta conversa.`,
      );
    }
    const mensagens = c.messages.filter((m) => !m.demo);
    const inicio = Math.min(args.a_partir_da_mensagem, mensagens.length);
    const fatia = mensagens.slice(inicio, inicio + args.quantidade);
    const fim = inicio + fatia.length;
    return {
      conversa: {
        id: c.id,
        titulo: c.title,
        criada: new Date(c.createdAt).toISOString(),
        atualizada: new Date(c.updatedAt).toISOString(),
        ...(c.meetingId ? { reuniao_id: c.meetingId } : {}),
        total_mensagens: mensagens.length,
        ...(c.id === ctx.tarefa.conversaId
          ? { aviso: 'É a conversa atual: o histórico dela já está no contexto.' }
          : {}),
      },
      mensagens: fatia.map((m, i) => ({
        mensagem: inicio + i,
        quem: m.role === 'user' ? 'a pessoa' : 'resposta anterior do Taq (não é fonte)',
        data: new Date(m.at).toISOString(),
        texto: m.text.length > MAX_MENSAGEM ? `${m.text.slice(0, MAX_MENSAGEM)}…` : m.text,
        ...(m.fontes?.length
          ? { fontes_citadas: m.fontes.map((f) => ({ tipo: f.tipo, id: f.registroId, titulo: f.titulo })) }
          : {}),
      })),
      ...(fim < mensagens.length ? { proximo: fim } : {}),
    };
  },
  resumir: (s) => `${(s.mensagens as unknown[]).length} mensagem(ns)`,
};

// ------------------------------------------------------- catálogo de documentos

/** Nomes de documento que o TaqCiti NÃO tem. Sem acento, minúsculas. */
const FORA_DO_CATALOGO =
  /\b(relatorio|proposta|contrato|apresentacao|slides?|e-?mail|memorando|briefing|planilha|orcamento|newsletter|comunicado|cronograma|roadmap|manual|artigo|post|press release|curriculo|pdi|okr|politica|procedimento|parecer|oficio|carta)\b/;

/**
 * O pedido nomeia um documento que o catálogo não tem, sem nomear um que ele
 * tem? Então não se cria nada — o Taq explica e oferece o texto para o Claude.
 * É o guarda contra "relatório" virar Ata em silêncio.
 */
export function pedidoForaDoCatalogo(texto: string): string | null {
  if (tipoNomeado(texto)) return null;
  return FORA_DO_CATALOGO.exec(normalizar(texto))?.[1] ?? null;
}

/** O tipo do catálogo que o texto nomeia, se nomeia algum. */
export function tipoNomeado(texto: string): TipoDeDocumento | undefined {
  const t = normalizar(texto);
  return CATALOGO_DE_DOCUMENTOS.find((tipo) => tipo.apelidos.some((a) => t.includes(a)));
}

const CRIAR_DOCUMENTO =
  /\b(cri[ae]r?|ger[ae]r?|gere|faca|fazer|faz|mont[ae]r?|escrev[ae]r?|redi(?:ja|gir|ge)|elabor[ae]r?|prepar[ae]r?|produz(?:a|ir)?)\b/;
/** "um documento", "o doc", "uma minuta" — o artigo separa criar de mexer no que existe ("no documento"). */
const DOCUMENTO_SEM_NOME =
  /\b(um|uma|o|a|novo|nova|outro|outra)\s+(?:novo\s+|nova\s+)?(documento|doc|arquivo|rascunho|minuta)\b/;

/**
 * "Gera um documento da reunião": pede um documento sem dizer qual. O Taq não
 * escolhe por ela — pergunta, com as opções do catálogo, antes de gastar uma
 * chamada ao modelo (ver o orquestrador).
 */
export function pedeDocumentoSemTipo(texto: string): boolean {
  const t = normalizar(texto);
  return (
    CRIAR_DOCUMENTO.test(t) &&
    DOCUMENTO_SEM_NOME.test(t) &&
    !tipoNomeado(texto) &&
    !pedidoForaDoCatalogo(texto)
  );
}

/** A pergunta de tipo. As opções saem do catálogo, nunca do modelo. */
export function perguntaDeTipo(): Pergunta {
  return {
    motivo: 'tipo_de_documento',
    texto: 'Qual documento você quer gerar?',
    opcoes: CATALOGO_DE_DOCUMENTOS.map((t) => ({
      rotulo: t.nome,
      descricao: t.finalidade,
      mensagem: `Criar ${t.nome}`,
    })),
  };
}

/**
 * O tipo, nunca adivinhado: o que a pessoa nomeou nesta mensagem; senão o que
 * o modelo escolheu, mas SÓ quando a mensagem responde a uma pergunta do Taq
 * dentro do pedido ("o segundo", "a de ontem") — aí o tipo veio da conversa.
 * Fora disso, `undefined`, e `create_document` pergunta em vez de criar.
 */
function tipoDoPedido(tarefa: Tarefa, escolhido: string | undefined): TipoDeDocumento | undefined {
  const nomeado = tipoNomeado(tarefa.pedidoOriginal);
  if (nomeado) return nomeado;
  if (escolhido && tarefa.continua) return tipoDeDocumento(escolhido);
  return undefined;
}

/** A reunião, sem perguntar: a dita; senão a da conversa; senão a mais recente. */
async function reuniaoDoPedido(ctx: ContextoDeFerramenta, id: string | undefined): Promise<MeetingRecord> {
  if (id) return reuniaoNoEscopo(ctx, id);
  const daConversa =
    ctx.tarefa.selecionados.find((s) => s.tipo === 'reuniao')?.id ??
    (ctx.tarefa.escopo.reunioes !== 'todas' ? ctx.tarefa.escopo.reunioes[0] : undefined);
  if (daConversa) return reuniaoNoEscopo(ctx, daConversa);
  // "Agora gere uma ata dessa reunião": a de que a conversa vinha falando. Se o
  // foco é um documento, a reunião de onde ele saiu.
  const { foco } = ctx.tarefa;
  if (foco?.tipo === 'reuniao') return reuniaoNoEscopo(ctx, foco.id);
  if (foco?.tipo === 'documento') {
    const doc = await ctx.armazenamento.obterDocumento(foco.id);
    if (doc?.meetingId && podeLerReuniao(ctx.tarefa.escopo, doc.meetingId))
      return reuniaoNoEscopo(ctx, doc.meetingId);
  }
  const todas = (await ctx.armazenamento.listarReunioes()).filter((r) => podeLerReuniao(ctx.tarefa.escopo, r.id));
  const recente = [...todas].sort((a, b) => b.startedAt - a.startedAt)[0];
  if (!recente) throw new ErroDeFerramenta('nao_encontrado', 'Não há reuniões para gerar o documento.');
  return recente;
}

export const listDocumentTypes: DefinicaoDeFerramenta<Record<string, never>> = {
  nome: 'list_document_types',
  descricao:
    'Devolve o catálogo de documentos do TaqCiti: id, nome, finalidade, a estrutura (seções) e ' +
    'os campos de cada tipo, dizendo quais são indispensáveis. São os ÚNICOS tipos que existem.',
  schemaDeEntrada: z.object({}),
  efeito: 'leitura',
  requisitos: [],
  politica: { repeticao: 'leitura', maxPorExecucao: 2 },
  etapa: 'Consultando os modelos de documento',
  async executar() {
    return {
      tipos: CATALOGO_DE_DOCUMENTOS.map((t) => ({
        id: t.id,
        nome: t.nome,
        finalidade: t.finalidade,
        secoes: t.estrutura.map((s) => ({
          id: s.id,
          titulo: s.titulo,
          obrigatoria: s.obrigatoria,
          precisa: s.precisa,
        })),
        campos: t.campos.map((c) => ({
          id: c.id,
          rotulo: c.rotulo,
          indispensavel: c.indispensavel,
        })),
      })),
    };
  },
  resumir: (s) => `${(s.tipos as unknown[]).length} tipo(s)`,
};

// ----------------------------------------------------------- create_document

const criacaoSchema = z.object({
  tipo: z
    .enum(IDS_DE_TIPO)
    .optional()
    .describe('Um tipo do catálogo. Ausente: o nomeado pela pessoa, ou o que a reunião parece ser.'),
  reuniao_id: z
    .string()
    .min(1)
    .optional()
    .describe('A reunião usada como fonte. Ausente: a da conversa, ou a mais recente.'),
  titulo: z.string().trim().min(1).max(200).optional(),
  secoes: z
    .array(
      z.object({
        id: z.string().min(1).describe('O id da seção no modelo do tipo.'),
        conteudo: z.string().max(20_000).describe('Markdown. Cite com [rN].'),
      }),
    )
    .min(1)
    .max(20),
  campos: z
    .record(z.string(), z.string().max(300))
    .optional()
    .describe(
      'Valores dos campos do tipo, por id. Só o que as fontes ou a pessoa disseram.',
    ),
  pendencias: z
    .array(z.string().min(1).max(300))
    .max(30)
    .optional()
    .describe('O que ficou por confirmar e as fontes não resolvem.'),
});

export function dataBr(ms: number): string {
  return new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export const createDocument: DefinicaoDeFerramenta<z.infer<typeof criacaoSchema>> = {
  nome: 'create_document',
  descricao:
    'Gera e salva um documento de um tipo DO CATÁLOGO, aplicando o modelo dele: você manda o ' +
    'conteúdo por seção e os campos; o documento é montado na ordem do modelo, com "A confirmar" ' +
    'nas seções obrigatórias sem conteúdo, "Não informado" nos campos ausentes, a lista de ' +
    'pendências e as fontes. Fica editável em Documentos, vinculado à reunião e a esta conversa. ' +
    'Se faltar campo indispensável, a ferramenta recusa e diz o que perguntar. Repetir a mesma ' +
    'chamada não duplica.',
  schemaDeEntrada: criacaoSchema,
  efeito: 'escrita_local',
  requisitos: ['documentos', 'reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 3 },
  etapa: 'Criando documento',
  async executar(args, ctx) {
    // O pedido DA PESSOA, e não o objetivo que o modelo escreveu ao delegar.
    const foraDoCatalogo = pedidoForaDoCatalogo(ctx.tarefa.pedidoOriginal);
    if (foraDoCatalogo) {
      throw new ErroDeFerramenta(
        'tipo_fora_do_catalogo',
        `A pessoa pediu "${foraDoCatalogo}", que não existe no catálogo. Não crie outro tipo no ` +
          'lugar: monte o documento pedido com create_custom_document (relatório, proposta, parecer…) ' +
          'ou, se for um formato que o TaqCiti não gera (apresentação, planilha, e-mail), explique e ' +
          'ofereça preparar um texto para o Claude com prepare_external_brief.',
      );
    }
    const tipo = tipoDoPedido(ctx.tarefa, args.tipo);
    if (!tipo) {
      ctx.registrarPergunta(perguntaDeTipo());
      return {
        criado: false,
        motivo: 'tipo_nao_informado',
        aviso: 'Nada foi criado: a pessoa não disse o tipo, e a pergunta já vai para ela. Não escolha por ela.',
      };
    }
    const reuniao = await reuniaoDoPedido(ctx, args.reuniao_id);

    const ids = new Set(tipo.estrutura.map((s) => s.id));
    const desconhecidas = args.secoes.filter((s) => !ids.has(s.id)).map((s) => s.id);
    if (desconhecidas.length) {
      throw new ErroDeFerramenta(
        'secao_desconhecida',
        `Seções que não existem em ${tipo.nome}: ${desconhecidas.join(', ')}. Válidas: ${[...ids].join(', ')}.`,
      );
    }
    const campos = args.campos ?? {};
    // Indispensável faltando NÃO impede o documento: ele sai com "A confirmar",
    // e a pergunta fica para o Taq fazer na conversa, depois de salvo.
    const faltando = tipo.campos.filter((c) => c.indispensavel && !campos[c.id]?.trim());

    const conteudoPor = new Map(args.secoes.map((s) => [s.id, s.conteudo.trim()]));
    const pendencias: string[] = [];
    const partes: string[] = [];
    for (const secao of tipo.estrutura) {
      const linhas: string[] = [];
      if (tipo.id === 'ata' && secao.id === 'identificacao') {
        linhas.push(`**Data:** ${dataBr(reuniao.startedAt)}`);
      }
      for (const campo of tipo.campos.filter((c) => c.secao === secao.id)) {
        const valor = campos[campo.id]?.trim();
        const ausente = campo.indispensavel ? 'A confirmar' : 'Não informado';
        linhas.push(`**${campo.rotulo}:** ${valor || ausente}`);
        if (!valor) pendencias.push(`${campo.rotulo}: ${ausente.toLowerCase()}`);
      }
      const corpo = conteudoPor.get(secao.id);
      if (corpo) linhas.push(corpo);
      if (!linhas.length) {
        if (!secao.obrigatoria) continue;
        linhas.push('_A confirmar._');
        pendencias.push(`${secao.titulo}: a confirmar`);
      }
      partes.push(`## ${secao.titulo}\n\n${linhas.join('\n\n')}`);
    }
    for (const p of args.pendencias ?? [])
      if (!pendencias.includes(p)) pendencias.push(p);

    const titulo = args.titulo ?? `${tipo.tituloDoDocumento} — ${reuniao.title}`;
    const { texto, fontes } = citacoesParaDocumento(partes.join('\n\n'), ctx.livro);
    const conteudo = [
      `# ${titulo}`,
      `_Rascunho gerado pelo Taq a partir da reunião “${reuniao.title}” (${dataBr(reuniao.startedAt)}), para revisão._`,
      texto,
      ...(pendencias.length
        ? [`## Pendências\n\n${pendencias.map((p) => `- ${p}`).join('\n')}`]
        : []),
      ...(fontes.length ? [`## Fontes\n\n${fontes.join('\n')}`] : []),
    ].join('\n\n');

    const chave = hash(
      [
        ctx.tarefa.execucaoId,
        tipo.id,
        reuniao.id,
        JSON.stringify(args.secoes),
        JSON.stringify(campos),
      ].join('\u0000'),
    );
    const { documento, jaExistia } = await ctx.armazenamento.criarDocumento(
      {
        title: titulo,
        content: `${conteudo}\n`,
        formato: 'markdown',
        origem: 'gerado',
        tipo: tipo.nome,
        meetingId: reuniao.id,
        conversationId: ctx.tarefa.conversaId,
      },
      { execucaoId: ctx.tarefa.execucaoId, chave: `${ctx.tarefa.execucaoId}:${chave}` },
    );

    ctx.registrarDocumento({
      id: documento.id,
      titulo: documento.title,
      acao: 'criado',
      versao: String(documento.updatedAt),
    });
    if (pendencias.length) ctx.registrarAusentes(pendencias);

    // Gerar de novo NUNCA sobrescreve: o documento anterior (e o que a pessoa
    // editou nele) fica como está, e o Taq diz que ele existe.
    const anteriores = (await ctx.armazenamento.listarDocumentos()).filter(
      (d) =>
        d.id !== documento.id &&
        d.meetingId === reuniao.id &&
        d.tipo === tipo.nome &&
        podeLerDocumento(ctx.tarefa.escopo, d),
    );

    /*
     * O documento já está salvo. Se sobrou o que só a pessoa sabe, quem pergunta
     * é o TAQ, na conversa — e a pergunta não segura nada: a resposta dela
     * continua o pedido (`informacao_indispensavel`) e vira `update_document`.
     * O texto é montado aqui, sem gastar outra chamada ao modelo.
     */
    if (faltando.length) {
      ctx.registrarPergunta({
        motivo: 'informacao_indispensavel',
        texto:
          `Criei “${documento.title}” (${tipo.nome}) para revisão. ` +
          `Para completar: ${faltando.map((c) => c.pergunta).join(' ')} ` +
          'Responda aqui que eu atualizo o documento.',
        opcoes: [],
      });
    }

    return {
      documento_id: documento.id,
      titulo: documento.title,
      tipo: tipo.nome,
      versao: documento.updatedAt,
      ja_existia: jaExistia,
      pendencias,
      vinculos: { reuniao: reuniao.id, conversa: ctx.tarefa.conversaId },
      ...(anteriores.length
        ? {
            ja_havia_do_mesmo_tipo: anteriores.map((d) => ({
              id: d.id,
              titulo: d.title,
              editado_pela_pessoa: d.updatedAt > d.createdAt,
            })),
            aviso_de_regeneracao:
              'Já havia documento deste tipo para esta reunião. Nada foi sobrescrito: o anterior ' +
              '(com as edições da pessoa) continua em Documentos. Diga isso, e que ela pode apagar o que não quiser.',
          }
        : {}),
      aviso:
        'Apresente como rascunho para revisão, destacando as pendências. Compartilhar é outra ação.',
    };
  },
  resumir: (s) =>
    s.criado === false
      ? 'tipo não informado: perguntando'
      : s.ja_existia
        ? 'documento já existia (repetição)'
        : `documento criado (${s.tipo as string})`,
};

// ------------------------------------------------------- create_custom_document

const personalizadoSchema = z.object({
  pedido: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe(
      'O documento que a pessoa quer, com as palavras dela: finalidade, para quem, o que precisa ' +
        'conter. Não resuma o conteúdo das reuniões aqui — o servidor lê as fontes.',
    ),
  reuniao_ids: z
    .array(z.string().min(1))
    .min(1)
    .max(5)
    .optional()
    .describe('As reuniões usadas como ÚNICAS fontes. Ausente: a da conversa, ou a mais recente.'),
  paginas: z.number().int().min(1).max(100).optional().describe('Extensão pedida, em páginas.'),
  limite_firme: z
    .boolean()
    .optional()
    .describe('true se a pessoa disse "no máximo/até N páginas"; false se foi uma preferência.'),
  variante: z
    .enum(['editorial', 'ata'])
    .optional()
    .describe('Aparência. `editorial` (padrão): capa gráfica, sumário e destaques. `ata`: a sóbria das atas.'),
});

const ERRO_DO_SERVIDOR: Record<string, string> = {
  chave: 'servidor_recusou',
  invalido: 'pedido_invalido',
  longo: 'fontes_longas',
  conflito: 'conflito',
  sem_conteudo: 'sem_conteudo',
  indisponivel: 'servidor_indisponivel',
  rede: 'servidor_indisponivel',
};

export const createCustomDocument: DefinicaoDeFerramenta<z.infer<typeof personalizadoSchema>> = {
  nome: 'create_custom_document',
  descricao:
    'Cria um documento PERSONALIZADO a partir de um pedido em linguagem natural (relatório, proposta, ' +
    'plano de ação, parecer…), com estrutura montada para o pedido e o padrão visual do CITi, em PDF. ' +
    'Só entra o que as reuniões escolhidas sustentam: afirmação sem trecho literal na fonte é removida, ' +
    'e o que falta vira pendência. Salva em Documentos, com histórico de versões e prévia do PDF. ' +
    'Use para pedidos que NÃO são um tipo do catálogo (create_document). Repetir a mesma chamada não duplica.',
  schemaDeEntrada: personalizadoSchema,
  efeito: 'escrita_local',
  requisitos: ['documentos', 'reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 2 },
  etapa: 'Montando o documento',
  async executar(args, ctx) {
    const ids = args.reuniao_ids ? [...new Set(args.reuniao_ids)] : undefined;
    const reunioes: MeetingRecord[] = ids
      ? await Promise.all(ids.map((id) => reuniaoNoEscopo(ctx, id)))
      : [await reuniaoDoPedido(ctx, undefined)];

    const fontes = reunioes
      .map((r) => ({ id: r.id, titulo: r.title, texto: transcriptToText(r.segments) }))
      .filter((f) => f.texto.trim());
    if (fontes.length === 0) {
      throw new ErroDeFerramenta('sem_fontes', 'As reuniões escolhidas não têm transcrição para servir de fonte.');
    }

    const variante = args.variante ?? 'editorial';
    const chave = `${ctx.tarefa.execucaoId}:${hash(
      [args.pedido, fontes.map((f) => f.id).sort().join(','), args.paginas ?? '', variante].join('\u0000'),
    )}`;

    // Repetição da mesma chamada: devolve o que já existe, sem gastar o servidor.
    const jaCriado = (await ctx.armazenamento.listarDocumentos()).find((d) => d.criadoPor?.chave === chave);
    if (jaCriado) {
      ctx.registrarDocumento({ id: jaCriado.id, titulo: jaCriado.title, acao: 'criado', versao: String(jaCriado.updatedAt) });
      return { documento_id: jaCriado.id, titulo: jaCriado.title, ja_existia: true, pendencias: [] };
    }

    // O pedido DA PESSOA vai junto com o detalhamento do modelo: o que ela escreveu
    // não pode ser trocado pelo que o modelo entendeu.
    const original = ctx.tarefa.pedidoOriginal.trim();
    const pedido =
      original && normalizar(original) !== normalizar(args.pedido)
        ? `Pedido da pessoa: ${original}\n\nDetalhamento: ${args.pedido}`
        : args.pedido;

    const pedidoDeGeracao = {
      pedido,
      fontes,
      capa: { data: new Date().toLocaleDateString('pt-BR') },
      ...(args.paginas
        ? { extensao: { paginas: args.paginas, tipo: args.limite_firme ? ('firme' as const) : ('aproximada' as const) } }
        : {}),
      variante,
    };
    const resposta = await gerarPersonalizado(pedidoDeGeracao);
    if (resposta.status !== 'ok') {
      throw new ErroDeFerramenta(ERRO_DO_SERVIDOR[resposta.codigo] ?? 'servidor_indisponivel', resposta.message);
    }

    const r = resposta.dados;
    const { documento } = await guardarGeracao(
      r,
      pedidoDeGeracao,
      { meetingId: fontes[0]!.id, conversationId: ctx.tarefa.conversaId },
      { execucaoId: ctx.tarefa.execucaoId, chave },
    );
    ctx.registrarDocumento({ id: documento.id, titulo: documento.title, acao: 'criado', versao: String(documento.updatedAt) });
    const pendencias = r.lacunas.map((l) => l.pergunta);
    if (pendencias.length) ctx.registrarAusentes(pendencias);

    const removidas = r.relatorio.problemas.filter((p) => p.tipo === 'sustentacao').length;
    return {
      documento_id: documento.id,
      titulo: documento.title,
      ja_existia: false,
      paginas: r.manifesto.paginas ?? null,
      variante,
      fontes: fontes.map((f) => ({ id: f.id, titulo: f.titulo })),
      afirmacoes_removidas_sem_sustentacao: removidas,
      pendencias,
      avisos: [
        ...r.avisos,
        ...r.relatorio.problemas.filter((p) => p.tipo === 'visual').map((p) => p.descricao),
        ...(r.manifesto.perfilEstado === 'provisorio'
          ? ['O padrão visual do CITi ainda é provisório (não validado por um responsável).']
          : []),
      ],
      aviso:
        'Apresente como rascunho para revisão: diga o que o documento é, quais reuniões serviram de ' +
        'fonte, as pendências, e que o PDF e as versões estão em Documentos. Se houve afirmações ' +
        'removidas, diga que foram retiradas por não estarem sustentadas nas reuniões. Compartilhar é outra ação.',
    };
  },
  resumir: (s) => (s.ja_existia ? 'documento personalizado já existia (repetição)' : 'documento personalizado criado'),
};

// ------------------------------------------------------------------ ask_user

const perguntaSchemaDaFerramenta = z.object({
  motivo: z.enum(MOTIVOS_DE_PERGUNTA),
  pergunta: z.string().min(1).max(600),
  reunioes: z
    .array(z.string().min(1))
    .max(6)
    .optional()
    .describe('Em "registro_de_origem" e "escolha_de_registro": ids de reuniões candidatas.'),
  documentos: z
    .array(z.string().min(1))
    .max(6)
    .optional()
    .describe('Em "escolha_de_registro": ids de documentos candidatos.'),
  opcoes: z
    .array(
      z.object({
        rotulo: z.string().min(1).max(80),
        mensagem: z.string().min(1).max(300),
      }),
    )
    .max(3)
    .optional()
    .describe('Só em "confirmacao": as respostas possíveis.'),
});

export const askUser: DefinicaoDeFerramenta<z.infer<typeof perguntaSchemaDaFerramenta>> =
  {
    nome: 'ask_user',
    descricao:
      'Faz UMA pergunta à pessoa e encerra este turno; a resposta dela chega na próxima mensagem. ' +
      'Use para: "tipo_de_documento" (o tipo não foi dito — as opções saem do catálogo sozinhas), ' +
      '"registro_de_origem" (não há reunião definida — passe ids candidatos em `reunioes`), ' +
      '"escolha_de_registro" (mais de um registro casa — passe os ids em `reunioes` ou `documentos`), ' +
      '"informacao_indispensavel" (create_document recusou por falta de campo) e "confirmacao" ' +
      '(sim/não). Não pergunte o que dá para ler nos registros.',
    schemaDeEntrada: perguntaSchemaDaFerramenta,
    efeito: 'leitura',
    requisitos: [],
    politica: { repeticao: 'leitura', maxPorExecucao: 1, encerraTurno: true },
    etapa: 'Preparando uma pergunta',
    async executar(args, ctx) {
      let opcoes: Array<{ rotulo: string; mensagem: string; descricao?: string }> = [];
      if (args.motivo === 'tipo_de_documento') {
        // Do catálogo, sempre — o modelo não inventa opção de tipo.
        opcoes = perguntaDeTipo().opcoes;
      } else if (args.motivo === 'registro_de_origem') {
        const noEscopo = (await ctx.armazenamento.listarReunioes()).filter((r) =>
          podeLerReuniao(ctx.tarefa.escopo, r.id),
        );
        const pedidas = (args.reunioes ?? [])
          .map((id) => noEscopo.find((r) => r.id === id))
          .filter((r): r is MeetingRecord => !!r);
        const candidatas = pedidas.length
          ? pedidas
          : [...noEscopo].sort((a, b) => b.startedAt - a.startedAt).slice(0, 5);
        opcoes = candidatas.map((r) => ({
          rotulo: `${r.title} · ${dataBr(r.startedAt)}`,
          mensagem: `Use a reunião “${r.title}” (${dataBr(r.startedAt)}, id ${r.id}).`,
        }));
      } else if (args.motivo === 'escolha_de_registro') {
        // Só candidatos que EXISTEM no escopo; o rótulo sai do registro, não do modelo.
        const reunioes = (await ctx.armazenamento.listarReunioes()).filter((r) =>
          (args.reunioes ?? []).includes(r.id) && podeLerReuniao(ctx.tarefa.escopo, r.id),
        );
        const documentos = (await ctx.armazenamento.listarDocumentos()).filter((d) =>
          (args.documentos ?? []).includes(d.id) && podeLerDocumento(ctx.tarefa.escopo, d),
        );
        opcoes = [
          ...reunioes.map((r) => ({
            rotulo: `${r.title} · ${dataBr(r.startedAt)}`,
            mensagem: `A reunião “${r.title}” (${dataBr(r.startedAt)}, id ${r.id}).`,
          })),
          ...documentos.map((d) => ({
            rotulo: d.title,
            mensagem: `O documento “${d.title}” (id ${d.id}).`,
          })),
        ];
      } else if (args.motivo === 'confirmacao') {
        opcoes = args.opcoes ?? [];
      }
      ctx.registrarPergunta({ motivo: args.motivo, texto: args.pergunta, opcoes });
      return { pergunta_registrada: true, opcoes: opcoes.map((o) => o.rotulo) };
    },
    resumir: (s) => `pergunta com ${(s.opcoes as unknown[]).length} opção(ões)`,
  };

// ---------------------------------------------------- prepare_external_brief

const resumoExternoSchema = z.object({
  objetivo: z.string().min(1).max(600),
  formato: z
    .string()
    .min(1)
    .max(300)
    .describe('O formato que a pessoa quer (ex.: relatório executivo).'),
  contexto: z
    .string()
    .min(1)
    .max(8_000)
    .describe('Só o contexto relevante, tirado dos registros consultados.'),
  pendencias: z.array(z.string().min(1).max(300)).max(20).optional(),
});

export const prepareExternalBrief: DefinicaoDeFerramenta<
  z.infer<typeof resumoExternoSchema>
> = {
  nome: 'prepare_external_brief',
  descricao:
    'Monta um texto para a pessoa COPIAR e levar ao Claude, quando ela pediu um documento que o ' +
    'catálogo não tem e aceitou a sugestão. Nada é enviado a lugar nenhum: é só texto na tela. ' +
    'Não é uma integração — não diga que é.',
  schemaDeEntrada: resumoExternoSchema,
  efeito: 'leitura',
  requisitos: [],
  politica: { repeticao: 'leitura', maxPorExecucao: 1 },
  etapa: 'Preparando o texto para copiar',
  async executar(args, ctx) {
    const { texto: contexto } = citacoesParaDocumento(args.contexto, ctx.livro);
    const texto = [
      `Objetivo: ${args.objetivo}`,
      `Formato desejado: ${args.formato}`,
      '',
      'Contexto (extraído dos meus registros no TaqCiti — confira antes de usar):',
      contexto.replace(/\s*\[\d+(?:, \d+)*\]/g, ''),
      ...(args.pendencias?.length
        ? ['', 'Informações ainda pendentes:', ...args.pendencias.map((p) => `- ${p}`)]
        : []),
      '',
      'Não invente o que não está no contexto; marque como pendente.',
    ].join('\n');
    ctx.registrarCopiavel(texto);
    return { texto_preparado: true, caracteres: texto.length };
  },
  resumir: () => 'texto para copiar preparado',
};
// ----------------------------------------------------------- update_document

const edicaoSchema = z
  .object({
    documento_id: z.string().min(1),
    versao: z.number().int().describe('A `versao` que read_document devolveu.'),
    titulo: z.string().trim().min(1).max(200).optional(),
    conteudo: z.string().min(1).max(60_000).optional().describe('O texto COMPLETO novo.'),
  })
  .refine((a) => a.titulo !== undefined || a.conteudo !== undefined, {
    message: 'Informe `titulo` ou `conteudo`.',
  });

export const updateDocument: DefinicaoDeFerramenta<z.infer<typeof edicaoSchema>> = {
  nome: 'update_document',
  descricao:
    'Substitui o título e/ou o texto de um documento existente, SÓ se ele ainda estiver na ' +
    '`versao` informada. Se alguém editou depois da sua leitura, devolve `conflito_de_versao` ' +
    'e não grava — nesse caso, avise a pessoa em vez de insistir.',
  schemaDeEntrada: edicaoSchema,
  efeito: 'escrita_local',
  requisitos: ['documentos'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 3 },
  etapa: 'Editando documento',
  async executar(args, ctx) {
    const atual = await documentoNoEscopo(ctx, args.documento_id);
    const patch = {
      ...(args.titulo !== undefined ? { title: args.titulo } : {}),
      ...(args.conteudo !== undefined ? { content: args.conteudo } : {}),
    };
    const r = await ctx.armazenamento.editarDocumento(atual.id, args.versao, patch);

    if (r.tipo === 'inexistente') {
      throw new ErroDeFerramenta(
        'nao_encontrado',
        `O documento ${atual.id} foi apagado.`,
      );
    }
    if (r.tipo === 'conflito') {
      // A repetição da MESMA edição encontra a versão que ela própria gravou:
      // isso não é conflito, é a edição já aplicada.
      const jaAplicada =
        (patch.title === undefined || r.atual.title === patch.title) &&
        (patch.content === undefined || r.atual.content === patch.content);
      if (!jaAplicada) {
        throw new ErroDeFerramenta(
          'conflito_de_versao',
          `O documento mudou depois da leitura (versão ${args.versao} → ${r.atual.updatedAt}). ` +
            'Nada foi gravado.',
          { versao_atual: r.atual.updatedAt },
        );
      }
      return { documento_id: r.atual.id, versao: r.atual.updatedAt, ja_aplicada: true };
    }

    ctx.registrarDocumento({
      id: r.documento.id,
      titulo: r.documento.title,
      acao: 'atualizado',
      versao: String(r.documento.updatedAt),
    });
    return {
      documento_id: r.documento.id,
      versao: r.documento.updatedAt,
      ja_aplicada: false,
    };
  },
  resumir: (s) =>
    s.ja_aplicada ? 'edição já aplicada (repetição)' : 'documento atualizado',
};

// ------------------------------------------------------------- delegate_task

const delegacaoSchema = z.object({
  agente: z.string().min(1).describe('O id de um especialista disponível.'),
  objetivo: z.string().min(1).max(2_000),
  entrada: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Montada por execução, porque a DESCRIÇÃO diz quais especialistas existem
 * agora. Só é oferecida quando há pelo menos um disponível.
 */
export function criarDelegateTask(
  disponiveis: readonly FichaDeAgente[],
): DefinicaoDeFerramenta<z.infer<typeof delegacaoSchema>> {
  return {
    nome: 'delegate_task',
    descricao:
      'Entrega uma parte do trabalho a um especialista e devolve o resultado dele (com as ' +
      'referências que ele usou). Especialistas disponíveis: ' +
      disponiveis.map((a) => `${a.id} — ${a.descricao}`).join('; ') +
      '.',
    schemaDeEntrada: delegacaoSchema,
    efeito: 'leitura',
    requisitos: ['agentes'],
    politica: { repeticao: 'leitura', maxPorExecucao: 4 },
    etapa: 'Consultando um especialista',
    async executar(args, ctx) {
      if (!ctx.delegar) {
        throw new ErroDeFerramenta(
          'delegacao_nao_permitida',
          'Esta tarefa não pode delegar.',
        );
      }
      const r = await ctx.delegar({
        agenteId: args.agente,
        objetivo: args.objetivo,
        entrada: args.entrada ?? {},
      });
      // O que o especialista FEZ vale para a execução inteira, mesmo que ele
      // tenha falhado depois: um documento criado ou uma reunião apagada não
      // deixam de ter acontecido.
      for (const d of r.documentos) ctx.registrarDocumento(d);
      if (r.informacoesAusentes.length) ctx.registrarAusentes(r.informacoesAusentes);
      for (const op of r.operacoes ?? []) ctx.registrarOperacao(op);
      for (const c of r.cartoes ?? []) ctx.registrarCartao(c);
      if (r.escritas) ctx.registrarEscritas(r.escritas);
      if (r.textoCopiavel) ctx.registrarCopiavel(r.textoCopiavel);
      if (r.pergunta) ctx.registrarPergunta(r.pergunta);
      else if (r.resposta && (r.estado === 'concluido' || r.estado === 'parcial')) {
        ctx.registrarRespostaFinal(r.resposta, r.estado === 'parcial');
      }
      if (
        r.estado === 'indisponivel' ||
        (r.estado === 'falhou' && !r.resposta && r.saida === undefined)
      ) {
        const e = r.erros[0];
        throw new ErroDeFerramenta(
          e?.codigo ?? 'delegacao_falhou',
          e?.mensagem ?? 'O especialista falhou.',
        );
      }
      return {
        agente: args.agente,
        estado: r.estado,
        ...(r.resposta ? { resposta: r.resposta } : {}),
        ...(r.saida !== undefined ? { saida: r.saida } : {}),
        referencias: r.evidencias.map((e) => ({
          ref: e.id,
          titulo: e.titulo,
          trecho: e.trecho,
        })),
        em_aberto: r.informacoesAusentes,
        limitacoes: r.limitacoes,
      };
    },
    resumir: (s) => `especialista ${s.agente as string}: ${s.estado as string}`,
  };
}

export const FERRAMENTAS_BASE: readonly DefinicaoDeFerramenta[] = [
  searchRecords,
  readMeeting,
  readDocument,
  readConversation,
  listDocumentTypes,
  createDocument,
  createCustomDocument,
  updateDocument,
  askUser,
  prepareExternalBrief,
  // Cada definição é tipada pelo próprio schema; a lista só as enumera.
] as unknown as readonly DefinicaoDeFerramenta[];
