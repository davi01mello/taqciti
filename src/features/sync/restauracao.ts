/**
 * A volta da sincronização: trazer do servidor o que outra máquina da mesma
 * conta mandou.
 *
 * ── O problema ───────────────────────────────────────────────────────────
 *
 * O storage local é a fonte da verdade de cada máquina, e `sincronizacao.ts`
 * espelha tudo no servidor. Sem a volta, a conta não vale nada fora da máquina
 * onde os dados nasceram: instalar a extensão num segundo computador começava
 * vazio. Aqui a máquina nova (ou a que ficou para trás) pergunta ao servidor
 * "o que mudou desde o cursor N?" e funde a resposta no storage local.
 *
 * ── A regra de fusão: só toma o remoto quem NÃO mexeu ────────────────────
 *
 * Não há relógio comparável entre máquinas, e nem toda coleção tem um
 * `updatedAt` (a reunião não tem; as marcações também não). O que existe é a
 * assinatura que `sincronizacao.ts` já guarda por item: "isto é o que o
 * servidor aceitou da última vez". Então:
 *
 *   - não existe aqui                       → traz.
 *   - existe, e NÃO mudou desde o último sync → o remoto, se diferir, é de
 *     outra máquina: substitui.
 *   - existe, e MUDOU desde o último sync    → é trabalho que ainda não subiu.
 *     O local vence (a próxima passada o envia); nada do que se escreveu aqui
 *     é atropelado.
 *
 * A VOLTA roda ANTES da subida na mesma passada: assim dá para perceber que o
 * servidor mudou por outra máquina enquanto este item também mudou aqui.
 *
 * ── Conflito: nada que alguém escreveu se perde calado ───────────────────
 *
 * Os dois lados mudaram o mesmo item desde o último sync. Para saber que o
 * remoto mudou POR OUTRA MÁQUINA (e não é só o eco do que esta enviou), cada
 * item guarda a sua BASE: o resumo do conteúdo no instante em que os dois
 * lados concordaram pela última vez. Remoto igual à base = só este lado mexeu.
 * Remoto diferente da base = os dois mexeram.
 *
 * O local continua vencendo (a próxima subida o envia), mas a versão que ia
 * ser sobrescrita no servidor vira uma CÓPIA RECUPERÁVEL aqui: um documento ou
 * uma conversa "(versão de outra máquina)", ou o texto da outra versão ao fim
 * da nota. A pessoa decide qual fica. Reunião, histórico de versões e prints
 * não entram: a reunião só muda de título depois de pronta, e print é imutável.
 *
 * Cada conflito gera UMA cópia: `tratados` guarda a versão remota para a qual
 * já se fez a cópia, e uma subida que falha e é tentada de novo não duplica.
 *
 * ── Apagar também viaja ──────────────────────────────────────────────────
 *
 * O servidor guarda uma lápide para o que foi apagado. Ela só remove o item
 * local se ele não mudou desde o último sync; senão o item volta no próximo
 * envio e a lápide é desfeita. E um item que NÃO está mais aqui mas ainda tem
 * assinatura guardada foi apagado por esta máquina e a lápide está a caminho:
 * nunca o ressuscitamos.
 *
 * ── O que não é restaurado ───────────────────────────────────────────────
 *
 * Preferências e o estado interno do Taq. Só o conteúdo que `sincronizacao.ts`
 * espelha: reuniões, documentos (e o histórico de versões), conversas, notas,
 * marcações e prints.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { SERVER_BASE_URL } from '@/shared/config/serverConfig';
import { readLocal, writeLocal } from '@/shared/services/storage';
import { comTravaLocal } from '@/shared/services/storageLock';
import { logger } from '@/shared/services/log';
import { MAX_CONVERSAS } from '@/home/conversations';
import { MAX_VERSOES } from '@/features/documents/personalizado/versoes';
import { TIPOS_DE_MARCA } from '@/features/annotations/marks';
import { MAX_TOTAL as MAX_PRINTS } from '@/features/annotations/shots';
import type { MeetingRecord } from '@/shared/types/domain';
import type { DocumentoGuardado } from '@/features/documents/store';
import type { Conversation } from '@/home/conversations';
import type { Nota } from '@/features/annotations/notes';
import type { MarcasDaReuniao } from '@/features/annotations/marks';
import type { Print } from '@/features/annotations/shots';
import type { HistoricoDoDocumento } from '@/features/documents/personalizado/versoes';
import type { ColecaoDaCopia, ItemParaOAcervo, NotaCopiada } from './paraOAcervo';

/** `tipo:id` → assinatura do que já foi aceito pelo servidor. */
export type Assinaturas = Record<string, string>;

type Colecao = ColecaoDaCopia | 'historico' | 'print';

const COLECOES: readonly Colecao[] = ['reuniao', 'documento', 'conversa', 'nota', 'historico', 'print'];

/** Trava contra um servidor que não para de devolver páginas: 400 × 25 itens. */
const MAX_PAGINAS = 400;

export interface ItemRemoto {
  colecao: Colecao;
  id: string;
  /** `null` quando `apagado`. */
  corpo: unknown;
  apagado: boolean;
  seq: number;
}

interface PaginaRemota {
  itens: ItemRemoto[];
  proximo: number;
  fim: boolean;
}

/** A recusa do servidor ao token: quem chama descarta a credencial em cache. */
export class CredencialRecusada extends Error {
  constructor() {
    super('credencial recusada');
  }
}

// ------------------------------------------------------------------ rede

function ehItemRemoto(v: unknown): v is ItemRemoto {
  if (!v || typeof v !== 'object') return false;
  const i = v as Partial<ItemRemoto>;
  return (
    typeof i.id === 'string' &&
    typeof i.apagado === 'boolean' &&
    typeof i.seq === 'number' &&
    (COLECOES as readonly unknown[]).includes(i.colecao)
  );
}

function ehPagina(v: unknown): v is PaginaRemota {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<PaginaRemota>;
  return Array.isArray(p.itens) && typeof p.proximo === 'number' && typeof p.fim === 'boolean';
}

/**
 * Uma página do servidor, ou `null` quando a resposta não tem a forma esperada
 * (um servidor mais velho, sem o GET) — que é "nada a restaurar", e não erro:
 * a extensão não pode quebrar a subida por causa de uma volta que não existe.
 */
async function buscarPagina(token: string, desde: number): Promise<PaginaRemota | null> {
  const resposta = await fetch(`${SERVER_BASE_URL}/api/sync?desde=${desde}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resposta.status === 401) throw new CredencialRecusada();
  if (!resposta.ok) throw new Error(`servidor ${resposta.status}`);
  const corpo: unknown = await resposta.json().catch(() => null);
  if (!ehPagina(corpo)) return null;
  return { ...corpo, itens: corpo.itens.filter(ehItemRemoto) };
}

// ------------------------------------------------------------- comparação

/**
 * JSON com as chaves em ordem. O servidor guarda em `jsonb`, que NÃO preserva a
 * ordem das chaves: comparar com `JSON.stringify` cru acharia diferença em todo
 * item, e cada "diferença" viraria uma escrita local, um evento de storage e
 * uma nova subida — um laço.
 */
export function canonico(v: unknown): string {
  return JSON.stringify(v, (_chave, valor: unknown) =>
    valor && typeof valor === 'object' && !Array.isArray(valor)
      ? Object.fromEntries(
          Object.entries(valor as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : valor,
  );
}

/**
 * Um resumo curto e estável do conteúdo de um item — a sua BASE. Canônico: a
 * mesma coisa com as chaves em outra ordem dá o mesmo resumo (o `jsonb` do
 * servidor as reordena).
 *
 * Tamanho MAIS hash, como em `assinar`: só o hash colide com frequência
 * desconfortável num acervo grande, e aqui uma colisão esconderia um conflito.
 */
export function baseDe(conteudo: unknown): string {
  const json = canonico(conteudo) ?? '';
  let h = 0;
  for (let i = 0; i < json.length; i++) h = (Math.imul(h, 31) + json.charCodeAt(i)) | 0;
  return `${json.length}.${(h >>> 0).toString(36)}`;
}

/**
 * O que se compara com o remoto: a cópia fiel, quando o item tem uma, e o
 * próprio item quando não tem (histórico de versões e prints, que viajam inteiros).
 */
function conteudoLocal(local: ItemParaOAcervo): unknown {
  return local.copia ? local.copia.corpo : local.item;
}

export type Decisao = 'por' | 'tirar' | 'nada' | 'conflito';

/** As coleções em que um conflito vira cópia recuperável. */
const COM_COPIA_DE_CONFLITO: readonly Colecao[] = ['documento', 'conversa', 'nota'];

/** O que a decisão sabe do passado deste item. */
export interface HistoricoDoItem {
  /** A assinatura da última vez que o servidor aceitou o item daqui. */
  guardada: string | undefined;
  /** A assinatura do item local neste instante. */
  atual: string | undefined;
  /** O resumo do conteúdo no último acordo entre os dois lados. */
  base?: string | undefined;
  /** O resumo da versão remota para a qual JÁ se fez uma cópia de conflito. */
  tratado?: string | undefined;
}

/**
 * O que fazer com UM item remoto. Pura, e é onde mora a regra do cabeçalho.
 *
 * @param local o item como está aqui agora, se está
 */
export function decidir(
  remoto: Pick<ItemRemoto, 'colecao' | 'apagado' | 'corpo'>,
  local: ItemParaOAcervo | undefined,
  { guardada, atual, base, tratado }: HistoricoDoItem,
): Decisao {
  const naoMexido = local !== undefined && guardada !== undefined && guardada === atual;

  if (remoto.apagado) return naoMexido ? 'tirar' : 'nada';

  if (!local) {
    // Sumiu daqui mas ainda consta como enviado: foi apagado AQUI, e a lápide
    // está a caminho. Trazer de volta seria ressuscitar o que se apagou.
    return guardada !== undefined ? 'nada' : 'por';
  }

  const aqui = conteudoLocal(local);
  const igual = canonico(aqui) === canonico(remoto.corpo);
  if (naoMexido) return igual ? 'nada' : 'por';

  // Mexido aqui desde o último envio. O local vence — a não ser que o remoto
  // também tenha mudado por outra máquina, e aí a versão dele é guardada.
  if (igual || base === undefined) return 'nada';
  const doRemoto = baseDe(remoto.corpo);
  if (doRemoto === base || doRemoto === tratado) return 'nada';
  return COM_COPIA_DE_CONFLITO.includes(remoto.colecao) ? 'conflito' : 'nada';
}
// -------------------------------------------------------------- validação

const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function ehReuniao(v: unknown): v is MeetingRecord {
  return (
    obj(v) &&
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.startedAt === 'number' &&
    Array.isArray(v.segments) &&
    Array.isArray(v.participants)
  );
}

function ehDocumento(v: unknown): v is DocumentoGuardado {
  return (
    obj(v) &&
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.content === 'string' &&
    typeof v.updatedAt === 'number'
  );
}

function ehConversa(v: unknown): v is Conversation {
  return obj(v) && typeof v.id === 'string' && Array.isArray(v.messages);
}

function ehHistoricoLocal(v: unknown): v is HistoricoDoDocumento {
  return (
    obj(v) && typeof v.documentoId === 'string' && Array.isArray(v.versoes) && v.versoes.length > 0
  );
}

const MARCAS_VALIDAS = new Set<string>(TIPOS_DE_MARCA.map((m) => m.id));

function ehNotaCopiada(v: unknown): v is NotaCopiada {
  if (!obj(v) || !obj(v.nota) || !obj(v.marcas)) return false;
  const n = v.nota;
  return (
    typeof n.meetingId === 'string' &&
    typeof n.texto === 'string' &&
    typeof n.updatedAt === 'number' &&
    Object.values(v.marcas).every((t) => typeof t === 'string' && MARCAS_VALIDAS.has(t))
  );
}

/** O histórico remoto (`HistoricoDoAcervo`) → o formato que a extensão guarda. */
function historicoDoRemoto(id: string, corpo: unknown): HistoricoDoDocumento | null {
  if (!obj(corpo) || !Array.isArray(corpo.fontesIds) || !Array.isArray(corpo.versoes)) return null;
  const versoes = corpo.versoes.filter(
    (v) => obj(v) && typeof v.revisao === 'number' && obj(v.arvore),
  ) as HistoricoDoDocumento['versoes'];
  if (versoes.length === 0 || versoes.length !== corpo.versoes.length) return null;
  return {
    documentoId: id,
    ...(typeof corpo.variante === 'string' ? { variante: corpo.variante } : {}),
    fontesIds: corpo.fontesIds as string[],
    versoes: versoes.length > MAX_VERSOES ? versoes.slice(versoes.length - MAX_VERSOES) : versoes,
  };
}

function ehPrintLocal(v: unknown): v is Print {
  return (
    obj(v) &&
    typeof v.id === 'string' &&
    typeof v.meetingId === 'string' &&
    typeof v.dataUrl === 'string' &&
    v.dataUrl.startsWith('data:image/') &&
    typeof v.at === 'number'
  );
}
// ---------------------------------------------------------------- aplicar

interface OpcoesDeLista<T> {
  idDe: (x: T) => string;
  valido: (v: unknown) => v is T;
  /** Itens que não se tocam de jeito nenhum (a reunião gravando agora). */
  protegido?: (x: T) => boolean;
  ordenar?: (a: T, b: T) => number;
  limite?: number;
}

/**
 * Funde numa coleção guardada como lista. Lê DENTRO da trava, no instante da
 * escrita — a captura e a HOME escrevem nestas mesmas chaves —, e preserva o
 * que não entende: um registro de uma versão futura não some por passar aqui.
 */
async function aplicarLista<T>(
  chave: string,
  opcoes: OpcoesDeLista<T>,
  por: readonly T[],
  tirar: ReadonlySet<string>,
): Promise<void> {
  if (por.length === 0 && tirar.size === 0) return;
  await comTravaLocal(chave, async () => {
    const bruto = await readLocal<unknown>(chave);
    if (bruto !== null && !Array.isArray(bruto)) return;
    const lista: unknown[] = Array.isArray(bruto) ? bruto : [];
    const entendidos = lista.filter(opcoes.valido);
    const desconhecidos = lista.filter((x) => !opcoes.valido(x));

    const novos = new Map(por.map((x) => [opcoes.idDe(x), x]));
    const proximos: T[] = [];
    for (const x of entendidos) {
      const id = opcoes.idDe(x);
      if (opcoes.protegido?.(x)) {
        proximos.push(x);
        novos.delete(id);
        continue;
      }
      if (tirar.has(id)) continue;
      const novo = novos.get(id);
      if (novo !== undefined) {
        proximos.push(novo);
        novos.delete(id);
        continue;
      }
      proximos.push(x);
    }
    for (const novo of novos.values()) proximos.push(novo);

    if (opcoes.ordenar) proximos.sort(opcoes.ordenar);
    const limitados = opcoes.limite ? proximos.slice(0, opcoes.limite) : proximos;
    await writeLocal(chave, [...limitados, ...desconhecidos]);
  });
}

const temNotaDe = (v: unknown, meetingId: string): boolean =>
  obj(v) && v.meetingId === meetingId;

/** O texto da nota daqui, em qualquer das formas em que o storage a guardou. */
function notaDaqui(bruto: Record<string, unknown>, meetingId: string): Nota | null {
  for (const v of Object.values(bruto)) {
    for (const n of Array.isArray(v) ? v : [v]) {
      if (temNotaDe(n, meetingId) && typeof (n as Nota).texto === 'string') return n as Nota;
    }
  }
  return null;
}

const SEPARADOR_DA_NOTA = '--- versão de outra máquina ---';

async function aplicarNotas(
  por: readonly NotaCopiada[],
  tirar: ReadonlySet<string>,
  emConflito: readonly NotaCopiada[],
): Promise<void> {
  if (por.length === 0 && tirar.size === 0 && emConflito.length === 0) return;

  await comTravaLocal(STORAGE_KEYS.notes, async () => {
    const bruto = (await readLocal<unknown>(STORAGE_KEYS.notes)) ?? {};
    if (!obj(bruto)) return;
    const proximo: Record<string, unknown> = { ...bruto };
    // Notas antigas podem estar em lista, sob chaves que não são o meetingId
    // (ver `agregarNotas`): limpa por conteúdo, como `gravarNota` faz.
    const limpar = (meetingId: string) => {
      for (const [k, v] of Object.entries(proximo)) {
        if (temNotaDe(v, meetingId)) delete proximo[k];
        else if (Array.isArray(v)) {
          const resto = v.filter((n) => !temNotaDe(n, meetingId));
          if (resto.length) proximo[k] = resto;
          else delete proximo[k];
        }
      }
    };
    for (const id of tirar) limpar(id);
    for (const { nota } of por) {
      limpar(nota.meetingId);
      // Uma reunião só com marcações tem "nota" vazia na cópia: não vira nota
      // em branco aqui.
      if (nota.texto.trim()) proximo[nota.meetingId] = nota as Nota;
    }
    // Conflito: o texto daqui fica, e o da outra máquina vem junto no fim —
    // nada que alguém escreveu se perde, e quem lê decide o que manter.
    for (const { nota: remota } of emConflito) {
      const daqui = notaDaqui(proximo, remota.meetingId);
      const texto = remota.texto.trim();
      if (!texto || (daqui && daqui.texto.includes(texto))) continue;
      limpar(remota.meetingId);
      proximo[remota.meetingId] = {
        meetingId: remota.meetingId,
        texto: daqui?.texto.trim()
          ? `${daqui.texto.trimEnd()}\n\n${SEPARADOR_DA_NOTA}\n${texto}`
          : texto,
        updatedAt: Date.now(),
        ...(daqui?.anteriores ? { anteriores: daqui.anteriores } : {}),
      };
    }
    await writeLocal(STORAGE_KEYS.notes, proximo);
  });

  if (por.length === 0 && tirar.size === 0 && emConflito.every((c) => Object.keys(c.marcas).length === 0)) return;
  await comTravaLocal(STORAGE_KEYS.marks, async () => {
    const bruto = (await readLocal<unknown>(STORAGE_KEYS.marks)) ?? {};
    if (!obj(bruto)) return;
    const proximo: Record<string, unknown> = { ...bruto };
    for (const id of tirar) delete proximo[id];
    for (const { nota, marcas } of por) {
      if (Object.keys(marcas).length > 0) proximo[nota.meetingId] = marcas as MarcasDaReuniao;
      else delete proximo[nota.meetingId];
    }
    // Em conflito as marcações se SOMAM: as daqui prevalecem onde as duas
    // marcaram a mesma fala, e as da outra máquina completam o resto.
    for (const { nota, marcas } of emConflito) {
      const daqui = obj(proximo[nota.meetingId]) ? (proximo[nota.meetingId] as Record<string, unknown>) : {};
      const soma = { ...marcas, ...daqui };
      if (Object.keys(soma).length > 0) proximo[nota.meetingId] = soma as MarcasDaReuniao;
    }
    await writeLocal(STORAGE_KEYS.marks, proximo);
  });
}

function novoId(prefixo: string): string {
  return `${prefixo}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** O documento remoto, como CÓPIA nova daqui: outro id, e sem a chave de idempotência do assistente. */
function copiaDeConflitoDoDocumento(remoto: DocumentoGuardado): DocumentoGuardado {
  const copia: DocumentoGuardado = {
    ...remoto,
    id: novoId('d'),
    title: `${remoto.title} (versão de outra máquina)`,
    updatedAt: Date.now(),
  };
  // A chave de criação do assistente tornaria a cópia "o mesmo" documento.
  delete copia.criadoPor;
  return copia;
}

function copiaDeConflitoDaConversa(remota: Conversation): Conversation {
  return { ...remota, id: novoId('c'), title: `${remota.title} (outra máquina)`, updatedAt: Date.now() };
}

export interface ContextoDaPagina {
  assinaturas: Assinaturas;
  /** O resumo do conteúdo no último acordo, por item. */
  bases?: Assinaturas;
  /** A versão remota (resumo) para a qual cada item já teve a sua cópia de conflito. */
  tratados?: Assinaturas;
  lerDesejado: () => Promise<Map<string, ItemParaOAcervo>>;
  assinaturaDe: (e: ItemParaOAcervo) => string;
}

export interface ResultadoDaPagina {
  /** Chaves (`colecao:id`) que entraram ou foram substituídas aqui. */
  postas: string[];
  /** Chaves que saíram daqui. */
  tiradas: string[];
  /** Chaves em que os dois lados mudaram e a versão remota virou cópia. */
  conflitos: string[];
  /** A nova base de cada item que ficou em acordo com o servidor. */
  bases: Assinaturas;
  /** O que foi tratado como conflito, para não repetir a cópia. */
  tratados: Assinaturas;
}

/** Aplica uma página no storage local. É o único lugar que o escreve. */
export async function aplicarPagina(
  itens: readonly ItemRemoto[],
  ctx: ContextoDaPagina,
): Promise<ResultadoDaPagina> {
  const desejado = await ctx.lerDesejado();
  const resultado: ResultadoDaPagina = { postas: [], tiradas: [], conflitos: [], bases: {}, tratados: {} };

  const reunioes: MeetingRecord[] = [];
  const documentos: DocumentoGuardado[] = [];
  const conversas: Conversation[] = [];
  const historicos: HistoricoDoDocumento[] = [];
  const prints: Print[] = [];
  const notas: NotaCopiada[] = [];
  const notasEmConflito: NotaCopiada[] = [];
  const tirar: Record<Colecao, Set<string>> = {
    reuniao: new Set(),
    documento: new Set(),
    conversa: new Set(),
    nota: new Set(),
    historico: new Set(),
    print: new Set(),
  };

  for (const item of itens) {
    const chave = `${item.colecao}:${item.id}`;
    const local = desejado.get(chave);
    const decisao = decidir(item, local, {
      guardada: ctx.assinaturas[chave],
      atual: local ? ctx.assinaturaDe(local) : undefined,
      base: ctx.bases?.[chave],
      tratado: ctx.tratados?.[chave],
    });

    if (decisao === 'nada') {
      // Remoto igual ao local: os dois lados concordam, e a base acompanha.
      if (!item.apagado && local) {
        const aqui = conteudoLocal(local);
        if (canonico(aqui) === canonico(item.corpo)) resultado.bases[chave] = baseDe(item.corpo);
      }
      continue;
    }

    if (decisao === 'tirar') {
      tirar[item.colecao].add(item.id);
      // Sem o documento, o histórico de versões dele não tem a quem servir.
      if (item.colecao === 'documento') tirar.historico.add(item.id);
      resultado.tiradas.push(chave);
      continue;
    }

    if (decisao === 'conflito') {
      // O local fica; a versão remota vira cópia recuperável. Não é "posta":
      // o item daqui não mudou, então a sua assinatura continua valendo.
      let feito = false;
      if (item.colecao === 'documento' && ehDocumento(item.corpo)) {
        documentos.push(copiaDeConflitoDoDocumento(item.corpo));
        feito = true;
      } else if (item.colecao === 'conversa' && ehConversa(item.corpo)) {
        conversas.push(copiaDeConflitoDaConversa(item.corpo));
        feito = true;
      } else if (item.colecao === 'nota' && ehNotaCopiada(item.corpo)) {
        notasEmConflito.push(item.corpo);
        feito = true;
      }
      if (feito) {
        resultado.conflitos.push(chave);
        resultado.tratados[chave] = baseDe(item.corpo);
        logger.warn('conflito de sincronização: a versão da outra máquina foi guardada como cópia', { chave });
      }
      continue;
    }

    // Valida na volta: o servidor guarda o que a extensão mandou, mas outra
    // versão da extensão pode ter mandado outra forma, e um registro torto não
    // pode derrubar a passada nem entrar no storage.
    let aceito = false;
    switch (item.colecao) {
      case 'reuniao':
        if (ehReuniao(item.corpo)) {
          // Uma reunião gravando em OUTRA máquina não está gravando nesta.
          reunioes.push({ ...item.corpo, status: 'ready' });
          aceito = true;
        }
        break;
      case 'documento':
        if (ehDocumento(item.corpo)) {
          documentos.push(item.corpo);
          aceito = true;
        }
        break;
      case 'conversa':
        if (ehConversa(item.corpo)) {
          conversas.push(item.corpo);
          aceito = true;
        }
        break;
      case 'nota':
        if (ehNotaCopiada(item.corpo)) {
          notas.push(item.corpo);
          aceito = true;
        }
        break;
      case 'print':
        if (ehPrintLocal(item.corpo)) {
          prints.push(item.corpo);
          aceito = true;
        }
        break;
      case 'historico': {
        const h = historicoDoRemoto(item.id, item.corpo);
        if (h) {
          historicos.push(h);
          aceito = true;
        }
        break;
      }
    }
    if (aceito) {
      resultado.postas.push(chave);
      resultado.bases[chave] = baseDe(item.corpo);
    } else logger.warn('item do servidor ignorado: formato inesperado', { chave });
  }

  await aplicarLista<MeetingRecord>(
    STORAGE_KEYS.history,
    {
      idDe: (r) => r.id,
      valido: ehReuniao,
      protegido: (r) => r.status === 'recording',
      ordenar: (a, b) => b.startedAt - a.startedAt,
    },
    reunioes,
    tirar.reuniao,
  );
  await aplicarLista<DocumentoGuardado>(
    STORAGE_KEYS.documents,
    { idDe: (d) => d.id, valido: ehDocumento, ordenar: (a, b) => b.updatedAt - a.updatedAt },
    documentos,
    tirar.documento,
  );
  await aplicarLista<Conversation>(
    STORAGE_KEYS.conversations,
    {
      idDe: (c) => c.id,
      valido: ehConversa,
      ordenar: (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      // O mesmo teto da escrita local: sem ele a coleção estouraria o limite e a
      // próxima gravação cortaria o excedente — e cortar aqui vira "apagado" lá.
      limite: MAX_CONVERSAS,
    },
    conversas,
    tirar.conversa,
  );
  await aplicarLista<HistoricoDoDocumento>(
    STORAGE_KEYS.documentVersions,
    { idDe: (h) => h.documentoId, valido: ehHistoricoLocal },
    historicos,
    tirar.historico,
  );
  await aplicarLista<Print>(
    STORAGE_KEYS.shots,
    {
      idDe: (p) => p.id,
      valido: ehPrintLocal,
      ordenar: (a, b) => b.at - a.at,
      // O teto da escrita local, pelo mesmo motivo das conversas.
      limite: MAX_PRINTS,
    },
    prints,
    tirar.print,
  );
  await aplicarNotas(notas, tirar.nota, notasEmConflito);

  return resultado;
}

// ------------------------------------------------------------------ passada

export interface Progresso {
  cursor: number;
  assinaturas: Assinaturas;
  bases: Assinaturas;
  tratados: Assinaturas;
}

export interface ArgumentosDaRestauracao extends Omit<ContextoDaPagina, 'assinaturas' | 'bases' | 'tratados'> {
  token: string;
  /** O cursor onde a última restauração parou. */
  desde: number;
  assinaturas: Assinaturas;
  bases: Assinaturas;
  tratados: Assinaturas;
  /**
   * Chamado depois de cada página aplicada. A extensão grava o progresso a cada
   * página, pelo mesmo motivo de a subida gravar a cada lote: uma queda na
   * página 7 de 10 não pode recomeçar da 1.
   */
  aoAvancar: (progresso: Progresso) => Promise<void>;
}

export interface ResultadoDaRestauracao extends Progresso {
  aplicados: number;
  /** Quantas versões de outra máquina viraram cópia recuperável. */
  conflitos: number;
}

/**
 * Traz tudo que mudou no servidor desde `desde` e funde no storage local.
 *
 * Lança em falha de rede ou de credencial: quem chama decide o que fazer. O
 * progresso das páginas já aplicadas fica gravado por `aoAvancar`.
 */
export async function restaurar(args: ArgumentosDaRestauracao): Promise<ResultadoDaRestauracao> {
  let cursor = args.desde;
  const assinaturas: Assinaturas = { ...args.assinaturas };
  const bases: Assinaturas = { ...args.bases };
  const tratados: Assinaturas = { ...args.tratados };
  const postasNoTotal = new Set<string>();
  let aplicados = 0;
  let conflitos = 0;
  const progresso = (): Progresso => ({
    cursor,
    assinaturas: { ...assinaturas },
    bases: { ...bases },
    tratados: { ...tratados },
  });

  for (let n = 0; n < MAX_PAGINAS; n++) {
    const pagina = await buscarPagina(args.token, cursor);
    if (!pagina) break;

    const r = await aplicarPagina(pagina.itens, {
      assinaturas,
      bases,
      tratados,
      lerDesejado: args.lerDesejado,
      assinaturaDe: args.assinaturaDe,
    });

    // O que acabou de entrar JÁ está no servidor: registra a assinatura do que
    // ficou aqui, ou a próxima passada o reenviaria de volta e o ciclo começaria.
    if (r.postas.length > 0 || r.tiradas.length > 0) {
      const agora = await args.lerDesejado();
      for (const chave of r.postas) {
        postasNoTotal.add(chave);
        const e = agora.get(chave);
        if (e) assinaturas[chave] = args.assinaturaDe(e);
      }
      for (const chave of r.tiradas) {
        delete assinaturas[chave];
        delete bases[chave];
        delete tratados[chave];
      }
    }
    Object.assign(bases, r.bases);
    Object.assign(tratados, r.tratados);
    aplicados += r.postas.length + r.tiradas.length;
    conflitos += r.conflitos.length;

    const avancou = pagina.proximo > cursor;
    if (avancou) cursor = pagina.proximo;
    await args.aoAvancar(progresso());
    if (pagina.fim || !avancou) break;
  }

  // Um histórico pode chegar antes do documento a que pertence: enquanto o
  // documento não existia ele não contava como "item daqui", e a assinatura
  // ficou de fora. Agora que tudo chegou, fecha o que ficou aberto — sem
  // sobrescrever uma assinatura que já existe, que a passada anterior guardou.
  if (postasNoTotal.size > 0) {
    const agora = await args.lerDesejado();
    let faltou = false;
    for (const chave of postasNoTotal) {
      const e = agora.get(chave);
      if (e && assinaturas[chave] === undefined) {
        assinaturas[chave] = args.assinaturaDe(e);
        faltou = true;
      }
    }
    if (faltou) await args.aoAvancar(progresso());
  }

  return { ...progresso(), aplicados, conflitos };
}