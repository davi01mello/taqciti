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
 * A subida roda ANTES da volta na mesma passada, então a janela de "mudou e
 * ainda não subiu" é só o instante entre as duas. Em edição simultânea das
 * duas máquinas, vale a última a sincronizar — o preço de não ter relógio, dito
 * aqui para ninguém descobrir em campo.
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
 * Prints (imagens grandes demais para o acervo) e o resto do estado local —
 * preferências, estado interno do Taq. Só o conteúdo que `sincronizacao.ts`
 * espelha: reuniões, documentos (e o histórico de versões), conversas, notas e
 * marcações.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { SERVER_BASE_URL } from '@/shared/config/serverConfig';
import { readLocal, writeLocal } from '@/shared/services/storage';
import { comTravaLocal } from '@/shared/services/storageLock';
import { logger } from '@/shared/services/log';
import { MAX_CONVERSAS } from '@/home/conversations';
import { MAX_VERSOES } from '@/features/documents/personalizado/versoes';
import { TIPOS_DE_MARCA } from '@/features/annotations/marks';
import type { MeetingRecord } from '@/shared/types/domain';
import type { DocumentoGuardado } from '@/features/documents/store';
import type { Conversation } from '@/home/conversations';
import type { Nota } from '@/features/annotations/notes';
import type { MarcasDaReuniao } from '@/features/annotations/marks';
import type { HistoricoDoDocumento } from '@/features/documents/personalizado/versoes';
import type { ColecaoDaCopia, ItemParaOAcervo, NotaCopiada } from './paraOAcervo';

/** `tipo:id` → assinatura do que já foi aceito pelo servidor. */
export type Assinaturas = Record<string, string>;

type Colecao = ColecaoDaCopia | 'historico';

const COLECOES: readonly Colecao[] = ['reuniao', 'documento', 'conversa', 'nota', 'historico'];

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

export type Decisao = 'por' | 'tirar' | 'nada';

/**
 * O que fazer com UM item remoto. Pura, e é onde mora a regra do cabeçalho.
 *
 * @param local o item como está aqui agora, se está
 * @param guardada a assinatura da última vez que o servidor o aceitou
 * @param atual a assinatura do item local neste instante
 */
export function decidir(
  remoto: Pick<ItemRemoto, 'colecao' | 'apagado' | 'corpo'>,
  local: ItemParaOAcervo | undefined,
  guardada: string | undefined,
  atual: string | undefined,
): Decisao {
  const naoMexido = local !== undefined && guardada !== undefined && guardada === atual;

  if (remoto.apagado) return naoMexido ? 'tirar' : 'nada';

  if (!local) {
    // Sumiu daqui mas ainda consta como enviado: foi apagado AQUI, e a lápide
    // está a caminho. Trazer de volta seria ressuscitar o que se apagou.
    return guardada !== undefined ? 'nada' : 'por';
  }
  if (!naoMexido) return 'nada';

  const aqui = remoto.colecao === 'historico' ? local.item : local.copia?.corpo;
  return canonico(aqui) === canonico(remoto.corpo) ? 'nada' : 'por';
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

async function aplicarNotas(por: readonly NotaCopiada[], tirar: ReadonlySet<string>): Promise<void> {
  if (por.length === 0 && tirar.size === 0) return;

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
    await writeLocal(STORAGE_KEYS.notes, proximo);
  });

  await comTravaLocal(STORAGE_KEYS.marks, async () => {
    const bruto = (await readLocal<unknown>(STORAGE_KEYS.marks)) ?? {};
    if (!obj(bruto)) return;
    const proximo: Record<string, unknown> = { ...bruto };
    for (const id of tirar) delete proximo[id];
    for (const { nota, marcas } of por) {
      if (Object.keys(marcas).length > 0) proximo[nota.meetingId] = marcas as MarcasDaReuniao;
      else delete proximo[nota.meetingId];
    }
    await writeLocal(STORAGE_KEYS.marks, proximo);
  });
}

export interface ContextoDaPagina {
  assinaturas: Assinaturas;
  lerDesejado: () => Promise<Map<string, ItemParaOAcervo>>;
  assinaturaDe: (e: ItemParaOAcervo) => string;
}

export interface ResultadoDaPagina {
  /** Chaves (`colecao:id`) que entraram ou foram substituídas aqui. */
  postas: string[];
  /** Chaves que saíram daqui. */
  tiradas: string[];
}

/** Aplica uma página no storage local. É o único lugar que o escreve. */
export async function aplicarPagina(
  itens: readonly ItemRemoto[],
  ctx: ContextoDaPagina,
): Promise<ResultadoDaPagina> {
  const desejado = await ctx.lerDesejado();
  const resultado: ResultadoDaPagina = { postas: [], tiradas: [] };

  const reunioes: MeetingRecord[] = [];
  const documentos: DocumentoGuardado[] = [];
  const conversas: Conversation[] = [];
  const historicos: HistoricoDoDocumento[] = [];
  const notas: NotaCopiada[] = [];
  const tirar: Record<Colecao, Set<string>> = {
    reuniao: new Set(),
    documento: new Set(),
    conversa: new Set(),
    nota: new Set(),
    historico: new Set(),
  };

  for (const item of itens) {
    const chave = `${item.colecao}:${item.id}`;
    const local = desejado.get(chave);
    const decisao = decidir(
      item,
      local,
      ctx.assinaturas[chave],
      local ? ctx.assinaturaDe(local) : undefined,
    );
    if (decisao === 'nada') continue;

    if (decisao === 'tirar') {
      tirar[item.colecao].add(item.id);
      // Sem o documento, o histórico de versões dele não tem a quem servir.
      if (item.colecao === 'documento') tirar.historico.add(item.id);
      resultado.tiradas.push(chave);
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
      case 'historico': {
        const h = historicoDoRemoto(item.id, item.corpo);
        if (h) {
          historicos.push(h);
          aceito = true;
        }
        break;
      }
    }
    if (aceito) resultado.postas.push(chave);
    else logger.warn('item do servidor ignorado: formato inesperado', { chave });
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
  await aplicarNotas(notas, tirar.nota);

  return resultado;
}

// ------------------------------------------------------------------ passada

export interface ArgumentosDaRestauracao extends Omit<ContextoDaPagina, 'assinaturas'> {
  token: string;
  /** O cursor onde a última restauração parou. */
  desde: number;
  assinaturas: Assinaturas;
  /**
   * Chamado depois de cada página aplicada. A extensão grava o progresso a cada
   * página, pelo mesmo motivo de a subida gravar a cada lote: uma queda na
   * página 7 de 10 não pode recomeçar da 1.
   */
  aoAvancar: (progresso: { cursor: number; assinaturas: Assinaturas }) => Promise<void>;
}

export interface ResultadoDaRestauracao {
  aplicados: number;
  cursor: number;
  assinaturas: Assinaturas;
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
  const postasNoTotal = new Set<string>();
  let aplicados = 0;

  for (let n = 0; n < MAX_PAGINAS; n++) {
    const pagina = await buscarPagina(args.token, cursor);
    if (!pagina) break;

    const r = await aplicarPagina(pagina.itens, {
      assinaturas,
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
      for (const chave of r.tiradas) delete assinaturas[chave];
    }
    aplicados += r.postas.length + r.tiradas.length;

    const avancou = pagina.proximo > cursor;
    if (avancou) cursor = pagina.proximo;
    await args.aoAvancar({ cursor, assinaturas: { ...assinaturas } });
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
    if (faltou) await args.aoAvancar({ cursor, assinaturas: { ...assinaturas } });
  }

  return { aplicados, cursor, assinaturas };
}
