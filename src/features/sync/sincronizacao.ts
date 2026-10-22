/**
 * O que mudou desde a última vez — e só isso vai.
 *
 * ── O problema ───────────────────────────────────────────────────────────
 *
 * Mandar tudo a cada sincronização é simples e insustentável: quem usa o
 * TaqCiti há meses tem dezenas de reuniões de uma hora, e reenviá-las a cada
 * fala capturada seria megabytes por minuto para gravar um parágrafo novo.
 *
 * A alternativa óbvia — guardar "sincronizei até tal data" — não funciona
 * porque as coisas mudam PARA TRÁS: renomear uma reunião de março, editar um
 * documento antigo, apagar uma nota. Um marcador temporal não vê nada disso.
 *
 * ── A solução: assinatura por item ───────────────────────────────────────
 *
 * Guardamos um resumo curto de cada item já enviado (`tipo:id` → assinatura).
 * A cada passada, o estado local é convertido, resumido e comparado:
 *
 *   está aqui e a assinatura mudou   → envia
 *   está aqui e não estava guardado  → envia
 *   estava guardado e sumiu daqui    → apaga lá
 *
 * Isso pega renomeação, edição e remoção pelo mesmo caminho, sem relógio e
 * sem depender de os dois lados concordarem sobre "quando".
 *
 * ── Gravar o progresso a cada lote ───────────────────────────────────────
 *
 * As assinaturas são gravadas DEPOIS de cada lote aceito, não no fim. Uma
 * queda no lote 7 de 10 preserva os seis primeiros, e a próxima passada
 * manda só o que falta. Gravar só no fim transformaria qualquer falha no
 * meio em "começar tudo de novo", que é exatamente o que dói quando a
 * conexão é ruim.
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, writeLocal } from '@/shared/services/storage';
import { SERVER_BASE_URL } from '@/shared/config/serverConfig';
import { tokenDeIdentidade, descartarToken, contaDoToken } from '@/shared/services/identidade';
import { logger } from '@/shared/services/log';
import type { MeetingRecord } from '@/shared/types/domain';
import type { DocumentoGuardado } from '@/features/documents/store';
import type { HistoricoDoDocumento } from '@/features/documents/personalizado/versoes';
import type { Conversation } from '@/home/conversations';
import type { Nota } from '@/features/annotations/notes';
import type { MarcasDaReuniao } from '@/features/annotations/marks';
import type { Print } from '@/features/annotations/shots';
import {
  type CopiaParaOServidor,
  type ItemParaOAcervo,
  type TipoDeItem,
  conversaParaOAcervo,
  copiaDaConversa,
  copiaDaNota,
  copiaDaReuniao,
  copiaDoDocumento,
  documentoParaOAcervo,
  historicoParaOAcervo,
  notaParaOAcervo,
  reuniaoParaOAcervo,
} from './paraOAcervo';
import { CredencialRecusada, baseDe, restaurar, type Assinaturas } from './restauracao';

/**
 * Espelha MAX_POR_LOTE em `server/app/api/sync/route.ts`. Conta itens NO FIO:
 * reunião, documento, conversa e nota viajam em dois (a projeção do conector e
 * a cópia fiel), e o histórico de versões em um.
 */
const POR_LOTE = 100;
/**
 * Teto de bytes por lote, abaixo dos 8 MiB do servidor: o histórico de um
 * documento chega a alguns megabytes, e 50 deles juntos estourariam o corpo —
 * falhando o lote inteiro, de novo a cada passada. Um item maior que o teto
 * viaja sozinho.
 */
const BYTES_POR_LOTE = 4 * 1024 * 1024;

interface EstadoDoSync {
  assinaturas: Assinaturas;
  ultimoMs?: number;
  /** O `sub` da conta Google a que estas assinaturas e este cursor se referem. */
  conta?: string;
  /** Até onde a volta (`restauracao.ts`) já leu no servidor. */
  cursor?: number;
  /** Quando a volta rodou pela última vez, para não perguntar a cada tecla. */
  restauradoEm?: number;
  /** O resumo do conteúdo no último acordo com o servidor, por item (ver `restauracao.ts`). */
  bases?: Assinaturas;
  /** A versão remota para a qual cada item já teve a sua cópia de conflito. */
  tratados?: Assinaturas;
  /** Itens recusados por cota: `chave` → até quando NÃO insistir. */
  pausados?: Record<string, number>;
  /** O que o servidor disse da cota na última subida. */
  uso?: { bytes: number; cota: number; em: number };
  /** Quantos itens a cota está segurando agora. */
  recusadosPorCota?: number;
  /** Como terminou a última passada (ver `anotar`). */
  ultimaPassada?: { em: number; ok: true } | { em: number; ok: false; falha: FalhaDoSync };
  /** Quando a última passada que DEU CERTO terminou. */
  ultimoSucessoEm?: number;
  /** A última volta que achou itens editados nas duas máquinas (viraram cópia). */
  conflitos?: { quantos: number; em: number };
}

/**
 * Por que uma passada não terminou: `sessao` — o Google não deu token (a
 * sessão venceu ou foi revogada); `rede` — o servidor não respondeu;
 * `servidor` — respondeu com erro.
 */
export type FalhaDoSync = 'sessao' | 'rede' | 'servidor';

/**
 * O que a tela Conexões mostra da sincronização. Antes, toda falha ia só para
 * o log do service worker: a sincronização podia parar por dias sem ninguém
 * saber, e as cópias "(outra máquina)" apareciam sem explicação.
 */
export interface SituacaoDoSync {
  ultimoSucessoEm: number | null;
  /** A falha da ÚLTIMA passada; `null` quando ela deu certo. */
  falha: { tipo: FalhaDoSync; em: number } | null;
  conflitos: { quantos: number; em: number } | null;
}

export function situacaoDoSync(bruto: unknown): SituacaoDoSync {
  const e = (bruto && typeof bruto === 'object' ? bruto : {}) as Partial<EstadoDoSync>;
  const u = e.ultimaPassada;
  return {
    ultimoSucessoEm: typeof e.ultimoSucessoEm === 'number' ? e.ultimoSucessoEm : null,
    falha: u && u.ok === false ? { tipo: u.falha, em: u.em } : null,
    conflitos: e.conflitos && e.conflitos.quantos > 0 ? e.conflitos : null,
  };
}

/** O que a tela Conexões mostra da cota do servidor. */
export interface ResumoDaCota {
  usoBytes: number;
  cotaBytes: number;
  /** Quantos itens a cota está segurando (esperam espaço). */
  seguradosPorCota: number;
}

/**
 * Lê o resumo da cota do estado guardado. `null` enquanto o servidor ainda não
 * disse nada (nunca subiu nada com cota cobrada): a tela não inventa um número.
 */
export function resumoDaCota(bruto: unknown): ResumoDaCota | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const e = bruto as Partial<EstadoDoSync>;
  const uso = e.uso;
  if (!uso || typeof uso.bytes !== 'number' || typeof uso.cota !== 'number' || uso.cota <= 0) return null;
  return {
    usoBytes: Math.max(0, uso.bytes),
    cotaBytes: uso.cota,
    seguradosPorCota: typeof e.recusadosPorCota === 'number' ? Math.max(0, e.recusadosPorCota) : 0,
  };
}
/** Quanto esperar antes de reenviar o que a cota recusou. */
const PAUSA_DA_COTA_MS = 30 * 60_000;

/**
 * A assinatura de um item: a projeção E a cópia fiel, juntas. Se só a
 * projeção contasse, uma mudança que o conector não enxerga — uma marcação
 * movida, o `html` de um documento — nunca seria enviada, e a outra máquina
 * restauraria a versão velha.
 *
 * O histórico não tem cópia: continua assinado só pelo item, e quem já o enviou
 * não o reenvia por causa desta funcionalidade.
 */
export function assinaturaDe(e: ItemParaOAcervo): string {
  // Um print é imutável (nasce e é apagado, nunca editado): `id` + tamanho
  // bastam, e evitam percorrer centenas de KB de base64 a cada passada.
  if (e.tipo === 'print') {
    const p = e.item as Print;
    return `p.${p.id}.${p.dataUrl.length}`;
  }
  return assinar(e.copia ? { item: e.item, copia: e.copia } : e.item);
}

/** O conteúdo cujo resumo é a BASE do item: a cópia fiel, ou o próprio item. */
function baseDoItem(e: ItemParaOAcervo): string | undefined {
  return e.tipo === 'print' ? undefined : baseDe(e.copia?.corpo ?? e.item);
}

function comporId(tipo: TipoDeItem, id: string): string {
  return `${tipo}:${id}`;
}

/**
 * Um resumo curto e estável do item.
 *
 * Tamanho MAIS hash, e não só o hash: um hash de 32 bits colide com
 * frequência desconfortável num acervo grande, e uma colisão aqui é
 * silenciosa — o item mudou e não é reenviado. Somar o tamanho torna a
 * colisão exigir duas coisas ao mesmo tempo, e o custo é um número.
 */
export function assinar(item: unknown): string {
  const json = JSON.stringify(item);
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = (Math.imul(h, 31) + json.charCodeAt(i)) | 0;
  }
  return `${json.length}.${(h >>> 0).toString(36)}`;
}

async function lerEstado(): Promise<EstadoDoSync> {
  const bruto = await readLocal<EstadoDoSync>(STORAGE_KEYS.syncEstado);
  return bruto && typeof bruto === 'object' && bruto.assinaturas
    ? bruto
    : { assinaturas: {} };
}

// ------------------------------------------------- montar o estado desejado

/**
 * Lê o storage local e devolve TUDO que deveria existir no servidor.
 *
 * Lê as chaves cruas em vez de chamar os módulos de cada coleção porque
 * aqui interessa o conjunto inteiro de uma vez; `lerNota(meetingId)` por
 * reunião seriam dezenas de idas ao storage para montar a mesma coisa.
 */
export async function montarDesejado(): Promise<Map<string, ItemParaOAcervo>> {
  const desejado = new Map<string, ItemParaOAcervo>();

  const reunioes = (await readLocal<MeetingRecord[]>(STORAGE_KEYS.history)) ?? [];
  const titulos = new Map(reunioes.map((r) => [r.id, r.title]));
  for (const r of reunioes) {
    desejado.set(comporId('reuniao', r.id), {
      tipo: 'reuniao',
      item: reuniaoParaOAcervo(r),
      copia: copiaDaReuniao(r),
    });
  }

  const documentos = (await readLocal<DocumentoGuardado[]>(STORAGE_KEYS.documents)) ?? [];
  for (const d of documentos) {
    desejado.set(comporId('documento', d.id), {
      tipo: 'documento',
      item: documentoParaOAcervo(d),
      copia: copiaDoDocumento(d),
    });
  }

  // O histórico de versões dos documentos personalizados sobe como backup, só
  // dos documentos que existem: histórico órfão não é enviado.
  const historicos = (await readLocal<HistoricoDoDocumento[]>(STORAGE_KEYS.documentVersions)) ?? [];
  const idsDosDocumentos = new Set(documentos.map((d) => d.id));
  for (const h of historicos) {
    if (!h || typeof h.documentoId !== 'string' || !Array.isArray(h.versoes) || !idsDosDocumentos.has(h.documentoId)) continue;
    desejado.set(comporId('historico', h.documentoId), {
      tipo: 'historico',
      item: historicoParaOAcervo(h),
    });
  }

  const conversas = (await readLocal<Conversation[]>(STORAGE_KEYS.conversations)) ?? [];
  for (const c of conversas) {
    desejado.set(comporId('conversa', c.id), {
      tipo: 'conversa',
      item: conversaParaOAcervo(c),
      copia: copiaDaConversa(c),
    });
  }

  const notas = (await readLocal<Record<string, Nota>>(STORAGE_KEYS.notes)) ?? {};
  const marcas = (await readLocal<Record<string, MarcasDaReuniao>>(STORAGE_KEYS.marks)) ?? {};
  const prints = (await readLocal<Print[]>(STORAGE_KEYS.shots)) ?? [];
  // Cada print sobe como imagem, para outra máquina da conta restaurá-lo. Só os
  // de reuniões que existem: print órfão não sobe.
  for (const p of prints) {
    if (!titulos.has(p.meetingId)) continue;
    desejado.set(comporId('print', p.id), { tipo: 'print', item: p });
  }
  const printsPorReuniao = new Map<string, number>();
  for (const p of prints) {
    printsPorReuniao.set(p.meetingId, (printsPorReuniao.get(p.meetingId) ?? 0) + 1);
  }

  /*
   * Prints e marcações viajam DENTRO do item de nota. Iterar só as notas com
   * texto fazia uma reunião com prints (ou marcações) e sem nota escrita
   * mandar zero dos dois: o servidor nunca sabia que existiam. Vale a união,
   * restrita às reuniões que existem no histórico.
   */
  const ultimoPrint = new Map<string, number>();
  for (const p of prints) {
    ultimoPrint.set(p.meetingId, Math.max(ultimoPrint.get(p.meetingId) ?? 0, p.at));
  }
  const comAnexo = new Set([
    ...Object.keys(notas),
    ...printsPorReuniao.keys(),
    ...Object.keys(marcas),
  ]);
  for (const meetingId of comAnexo) {
    const temTexto = Boolean(notas[meetingId]?.texto?.trim());
    const temPrint = (printsPorReuniao.get(meetingId) ?? 0) > 0;
    const temMarca = Object.keys(marcas[meetingId] ?? {}).length > 0;
    if (!temTexto && !temPrint && !temMarca) continue;
    // Sem nota escrita, só as reuniões que existem: prints órfãos não sobem.
    if (!temTexto && !titulos.has(meetingId)) continue;
    const nota: Nota = notas[meetingId] ?? {
      meetingId,
      texto: '',
      updatedAt: ultimoPrint.get(meetingId) ?? 0,
    };
    desejado.set(comporId('nota', meetingId), {
      tipo: 'nota',
      item: notaParaOAcervo(
        nota,
        titulos.get(meetingId) ?? 'Reunião',
        marcas[meetingId] ?? {},
        printsPorReuniao.get(meetingId) ?? 0,
      ),
      copia: copiaDaNota(nota, marcas[meetingId] ?? {}),
    });
  }

  return desejado;
}

// --------------------------------------------------------------- o diff

export interface Plano {
  enviar: {
    chave: string;
    tipo: TipoDeItem;
    item: unknown;
    copia?: CopiaParaOServidor;
    assinatura: string;
    /** O resumo do conteúdo enviado: vira a base do item quando o lote é aceito. */
    base?: string;
  }[];
  apagar: { chave: string; tipo: TipoDeItem; id: string }[];
}

export function planejar(
  desejado: Map<string, ItemParaOAcervo>,
  assinaturas: Assinaturas,
): Plano {
  const plano: Plano = { enviar: [], apagar: [] };

  for (const [chave, entrada] of desejado) {
    const assinatura = assinaturaDe(entrada);
    if (assinaturas[chave] !== assinatura) {
      plano.enviar.push({
        chave,
        tipo: entrada.tipo,
        item: entrada.item,
        ...(entrada.copia ? { copia: entrada.copia } : {}),
        assinatura,
        ...(baseDoItem(entrada) !== undefined ? { base: baseDoItem(entrada)! } : {}),
      });
    }
  }

  for (const chave of Object.keys(assinaturas)) {
    if (desejado.has(chave)) continue;
    const corte = chave.indexOf(':');
    const tipo = chave.slice(0, corte) as TipoDeItem;
    const id = chave.slice(corte + 1);
    if (id) plano.apagar.push({ chave, tipo, id });
  }

  return plano;
}

// ------------------------------------------------------------- o envio

export type ResultadoDoSync =
  | { estado: 'nada-a-fazer' }
  | { estado: 'desligado' }
  | { estado: 'sem-token' }
  | {
      estado: 'ok';
      enviados: number;
      apagados: number;
      /** Itens trazidos de outra máquina (e versões que viraram cópia de conflito). */
      restaurados?: number;
      /** Itens que a cota do servidor segurou nesta passada. */
      recusadosPorCota?: number;
    }
  | { estado: 'falhou'; enviados: number; apagados: number; motivo: string };

/** Um item como vai no fio: a projeção do conector, a cópia fiel, ou o histórico. */
type ItemNoFio = { tipo: TipoDeItem | 'copia'; item: unknown };

interface Lote {
  itens: ItemNoFio[];
  apagados: { tipo: TipoDeItem; id: string }[];
  chaves: { chave: string; assinatura?: string; base?: string }[];
}

/**
 * Fatia o plano em lotes que caibam no teto do servidor.
 *
 * Um item e a sua cópia fiel andam SEMPRE no mesmo lote: a assinatura só é
 * gravada depois de o lote ser aceito, e separá-los deixaria uma queda entre
 * os dois registrar como enviado um item cuja cópia nunca chegou.
 */
export function fatiar(plano: Plano, porLote = POR_LOTE): Lote[] {
  const lotes: Lote[] = [];
  let atual: Lote = { itens: [], apagados: [], chaves: [] };
  let bytes = 0;
  const cheio = (a: Lote) => a.itens.length + a.apagados.length;
  const fechar = () => {
    if (atual.chaves.length) lotes.push(atual);
    atual = { itens: [], apagados: [], chaves: [] };
    bytes = 0;
  };

  for (const e of plano.enviar) {
    const fios: ItemNoFio[] = [{ tipo: e.tipo, item: e.item }];
    if (e.copia) fios.push({ tipo: 'copia', item: e.copia });
    const tamanho = fios.reduce((soma, f) => soma + JSON.stringify(f.item).length, 0);
    if (
      atual.chaves.length > 0 &&
      (bytes + tamanho > BYTES_POR_LOTE || cheio(atual) + fios.length > porLote)
    ) {
      fechar();
    }
    bytes += tamanho;
    atual.itens.push(...fios);
    atual.chaves.push({
      chave: e.chave,
      assinatura: e.assinatura,
      ...(e.base !== undefined ? { base: e.base } : {}),
    });
    if (cheio(atual) >= porLote) fechar();
  }
  for (const a of plano.apagar) {
    atual.apagados.push({ tipo: a.tipo, id: a.id });
    atual.chaves.push({ chave: a.chave });
    if (cheio(atual) >= porLote) fechar();
  }
  fechar();
  return lotes;
}

/** `true` quando a pessoa disse sim na página Conexões. */
async function ligada(): Promise<boolean> {
  const sim = await readLocal<{ ligada?: boolean }>(STORAGE_KEYS.sync);
  return sim?.ligada === true;
}

/** Quanto esperar entre duas voltas, a menos que a passada peça uma. */
const INTERVALO_DA_RESTAURACAO_MS = 60_000;

export interface OpcoesDoSync {
  /** Pergunta ao servidor agora, mesmo que tenha perguntado há pouco. */
  forcarRestauracao?: boolean;
}

async function salvar(estado: EstadoDoSync): Promise<void> {
  await writeLocal(STORAGE_KEYS.syncEstado, estado);
}

/** Registra como a passada terminou, para a tela (ver `situacaoDoSync`). */
async function anotar(resultado: true | FalhaDoSync, conflitos = 0): Promise<void> {
  const em = Date.now();
  const estado = await lerEstado();
  await salvar({
    ...estado,
    ultimaPassada: resultado === true ? { em, ok: true } : { em, ok: false, falha: resultado },
    ...(resultado === true ? { ultimoSucessoEm: em } : {}),
    ...(conflitos > 0 ? { conflitos: { quantos: conflitos, em } } : {}),
  });
}

/**
 * Uma passada de sincronização: primeiro TRAZ o que mudou nas outras máquinas
 * da conta (`restauracao.ts`), depois SOBE o que mudou aqui.
 *
 * Nessa ordem de propósito. Trazer primeiro é o que deixa perceber que um item
 * mudou nas DUAS pontas — e guardar a versão que ia ser sobrescrita, em vez de
 * perdê-la calado. Subir primeiro só descobriria o conflito depois de o
 * servidor já ter perdido a outra versão. Ver o cabeçalho de `restauracao.ts`.
 *
 * Nunca lança: é chamada de um listener de evento do service worker, onde uma
 * exceção não tem quem a pegue e só vira ruído no console. Tudo vira um
 * `ResultadoDoSync`, que quem chama pode registrar ou ignorar. Uma volta que
 * falha não derruba a subida: vai para o log e é tentada de novo na próxima.
 */
export async function sincronizar(opcoes: OpcoesDoSync = {}): Promise<ResultadoDoSync> {
  if (!(await ligada())) {
    // Desligada, uma falha antiga não é mais notícia: sem isto, o aviso de
    // "sincronização parou" seguiria na tela de quem desligou de propósito.
    const anterior = await lerEstado();
    if (anterior.ultimaPassada?.ok === false) {
      const semFalha = { ...anterior };
      delete semFalha.ultimaPassada;
      await salvar(semFalha);
    }
    return { estado: 'desligado' };
  }

  const token = await tokenDeIdentidade(false);
  if (!token) {
    await anotar('sessao');
    return { estado: 'sem-token' };
  }

  let estado = await lerEstado();

  /*
   * De quem são estas assinaturas?
   *
   * Do `sub` da conta que sincronizou por último nesta máquina. Trocou a conta
   * Google: o que está no storage é da conta ANTERIOR, e mandá-lo para o acervo
   * da nova seria entregar dados de uma pessoa à outra. Então o que já está
   * aqui é marcado como "já tratado" (não sobe) e o cursor da volta recomeça —
   * a conta nova traz o que é dela. O que ficou no storage fica; apagar o
   * acervo local de alguém por ter trocado de conta seria pior.
   */
  const conta = contaDoToken(token);
  if (conta && estado.conta !== conta) {
    if (estado.conta) {
      logger.warn('conta do Google trocada nesta máquina; o acervo local não sobe');
      estado = {
        assinaturas: Object.fromEntries(
          [...(await montarDesejado())].map(([chave, e]) => [chave, assinaturaDe(e)]),
        ),
        conta,
        ...(estado.ultimoMs !== undefined ? { ultimoMs: estado.ultimoMs } : {}),
      };
    } else {
      estado = { ...estado, conta };
    }
    await salvar(estado);
  }

  // ---- a volta
  let restaurados = 0;
  let conflitos = 0;
  /** A volta falhou: a subida ainda roda, mas a passada não conta como sucesso. */
  let falhaDaVolta: FalhaDoSync | null = null;
  /*
   * Quando perguntar ao servidor o que mudou:
   *
   *  - a passada pediu (abrir o navegador, o alarme periódico);
   *  - nunca perguntou;
   *  - passou o intervalo;
   *  - HÁ ALGO A ENVIAR. Esta é a que importa para o conflito: subir sem ter
   *    olhado o servidor sobrescreveria uma edição feita noutra máquina há
   *    meio minuto, e a pessoa nunca saberia. Custa uma consulta indexada — e
   *    nenhuma, quando o servidor acusa que não há novidade (`cabeca.ts`).
   */
  const previo = planejar(await montarDesejado(), estado.assinaturas);
  const haAlgoParaEnviar = previo.enviar.length > 0 || previo.apagar.length > 0;
  const devida =
    opcoes.forcarRestauracao === true ||
    haAlgoParaEnviar ||
    estado.restauradoEm === undefined ||
    Date.now() - estado.restauradoEm >= INTERVALO_DA_RESTAURACAO_MS;
  if (devida) {
    try {
      const r = await restaurar({
        token,
        desde: estado.cursor ?? 0,
        assinaturas: estado.assinaturas,
        bases: estado.bases ?? {},
        tratados: estado.tratados ?? {},
        lerDesejado: montarDesejado,
        assinaturaDe,
        aoAvancar: async ({ cursor, assinaturas, bases, tratados }) => {
          estado = { ...estado, cursor, assinaturas, bases, tratados };
          await salvar(estado);
        },
      });
      restaurados = r.aplicados + r.conflitos;
      conflitos = r.conflitos;
      estado = {
        ...estado,
        cursor: r.cursor,
        assinaturas: r.assinaturas,
        bases: r.bases,
        tratados: r.tratados,
        restauradoEm: Date.now(),
      };
      await salvar(estado);
    } catch (erro) {
      if (erro instanceof CredencialRecusada) await descartarToken();
      falhaDaVolta = erro instanceof CredencialRecusada ? 'sessao' : 'rede';
      logger.warn('restauracao falhou', {
        motivo: erro instanceof Error ? erro.message : 'desconhecido',
      });
    }
  }

  // ---- a subida
  const agora = Date.now();
  // O que a cota recusou há pouco espera: reenviar centenas de KB de imagem a
  // cada passada, só para ouvir "cheio" de novo, desperdiçaria rede e banco.
  const pausados = Object.fromEntries(
    Object.entries(estado.pausados ?? {}).filter(([, ate]) => ate > agora),
  );
  const plano = planejar(await montarDesejado(), estado.assinaturas);
  plano.enviar = plano.enviar.filter((e) => !(e.chave in pausados));
  const temPlano = plano.enviar.length > 0 || plano.apagar.length > 0;

  let enviados = 0;
  let apagados = 0;
  let recusadosPorCota = 0;

  if (temPlano) {
    const assinaturas = { ...estado.assinaturas };
    const bases = { ...(estado.bases ?? {}) };
    const tratados = { ...(estado.tratados ?? {}) };

    for (const lote of fatiar(plano)) {
      let resposta: Response;
      try {
        resposta = await fetch(`${SERVER_BASE_URL}/api/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ itens: lote.itens, apagados: lote.apagados }),
        });
      } catch {
        await anotar('rede', conflitos);
        return { estado: 'falhou', enviados, apagados, motivo: 'servidor inalcançável' };
      }

      if (resposta.status === 401) {
        // Token vencido. Descartar o cache local é o que permite a próxima
        // passada pegar um novo — sem isso, vira recusa permanente.
        await descartarToken();
        await anotar('sessao', conflitos);
        return { estado: 'falhou', enviados, apagados, motivo: 'credencial recusada' };
      }
      if (!resposta.ok) {
        await anotar('servidor', conflitos);
        return { estado: 'falhou', enviados, apagados, motivo: `servidor ${resposta.status}` };
      }

      /*
       * O que o servidor RECUSOU:
       *
       *  - por FORMATO (histórico torto): não derruba o lote, e é registrado
       *    como aceito — reenviar o mesmo item só o recusaria de novo, para
       *    sempre. O motivo vai para o log.
       *  - por COTA (`temporario`): NÃO é registrado como enviado. Quando
       *    houver espaço, volta a ser tentado — e fica em pausa até lá.
       */
      const corpo = (await resposta.json().catch(() => null)) as {
        recusados?: { id: string; motivo: string; chave?: string; temporario?: boolean }[];
        uso?: { bytes: number; cota: number };
      } | null;
      const seguraveis = new Set<string>();
      for (const r of corpo?.recusados ?? []) {
        logger.warn('item recusado pelo servidor', { id: r.id, motivo: r.motivo });
        if (r.temporario && r.chave) seguraveis.add(r.chave);
      }
      if (corpo?.uso) estado = { ...estado, uso: { ...corpo.uso, em: Date.now() } };

      // O lote foi aceito (menos o que a cota segurou): registra as
      // assinaturas dele ANTES do próximo. Ver o cabeçalho.
      for (const { chave, assinatura, base } of lote.chaves) {
        if (seguraveis.has(chave)) {
          pausados[chave] = Date.now() + PAUSA_DA_COTA_MS;
          recusadosPorCota += 1;
          continue;
        }
        delete pausados[chave];
        if (assinatura) {
          assinaturas[chave] = assinatura;
          if (base !== undefined) bases[chave] = base;
        } else {
          delete assinaturas[chave];
          delete bases[chave];
          delete tratados[chave];
        }
      }
      estado = {
        ...estado,
        assinaturas: { ...assinaturas },
        bases: { ...bases },
        tratados: { ...tratados },
        pausados: { ...pausados },
        ultimoMs: Date.now(),
      };
      await salvar(estado);

      enviados += lote.chaves.filter((c) => c.assinatura && !seguraveis.has(c.chave)).length;
      apagados += lote.apagados.length;
    }
  }

  const seguradosAgora = Object.keys(pausados).length;
  if (seguradosAgora !== (estado.recusadosPorCota ?? 0)) {
    estado = { ...estado, recusadosPorCota: seguradosAgora };
    await salvar(estado);
  }

  await anotar(falhaDaVolta ?? true, conflitos);
  if (!temPlano && restaurados === 0) return { estado: 'nada-a-fazer' };
  return {
    estado: 'ok',
    enviados,
    apagados,
    ...(restaurados > 0 ? { restaurados } : {}),
    ...(recusadosPorCota > 0 ? { recusadosPorCota } : {}),
  };
}
/**
 * Esquece o que já foi enviado, forçando a próxima passada a mandar tudo.
 *
 * Existe para o caso de o acervo do servidor ser apagado por fora: sem isto,
 * a extensão acharia que tudo já está lá e nunca reenviaria nada.
 */
export async function esquecerSincronizado(): Promise<void> {
  await writeLocal(STORAGE_KEYS.syncEstado, { assinaturas: {} } satisfies EstadoDoSync);
}

// ---------------------------------------------------------- o agendamento

/**
 * As chaves cuja mudança pede uma sincronização.
 *
 * `taq:state` fica de fora de propósito: é o estado VIVO da reunião, que
 * muda a cada fala capturada. Sincronizar a cada trecho seria uma requisição
 * por segundo durante a reunião inteira, para mandar uma frase. O histórico
 * (`taq:history`) é reescrito ao longo da captura e no fim dela, e é ele que
 * carrega a transcrição — é o gatilho certo.
 */
export const CHAVES_OBSERVADAS: readonly string[] = [
  STORAGE_KEYS.history,
  STORAGE_KEYS.documents,
  STORAGE_KEYS.documentVersions,
  STORAGE_KEYS.conversations,
  STORAGE_KEYS.notes,
  STORAGE_KEYS.marks,
  STORAGE_KEYS.shots,
  STORAGE_KEYS.sync,
];

/**
 * Espera antes de sincronizar, para não disparar a cada tecla.
 *
 * Curto de propósito. O service worker do MV3 dorme por ociosidade, e um
 * temporizador longo tem chance real de nunca disparar — o trabalho precisa
 * começar enquanto o evento que o acordou ainda o segura vivo.
 */
const ESPERA_MS = 1_500;

let pendente: ReturnType<typeof setTimeout> | null = null;
let rodando = false;

/** Uma passada, sem deixar duas se atropelarem. */
async function passada(forcarRestauracao = false): Promise<void> {
  if (rodando) return;
  rodando = true;
  try {
    const r = await sincronizar({ forcarRestauracao });
    if (r.estado === 'ok') {
      logger.info('sincronizado', {
        enviados: r.enviados,
        apagados: r.apagados,
        restaurados: r.restaurados ?? 0,
      });
    } else if (r.estado === 'falhou') {
      logger.warn('sincronizacao falhou', { motivo: r.motivo, enviados: r.enviados });
    }
  } finally {
    rodando = false;
  }
}

/** O alarme que faz a volta rodar sozinha, com o navegador parado. */
export const NOME_DO_ALARME = 'taq:sync-periodico';
export const PERIODO_DO_ALARME_MIN = 5;

export function agendarSincronizacao(): void {
  if (pendente) clearTimeout(pendente);
  pendente = setTimeout(() => {
    pendente = null;
    void passada();
  }, ESPERA_MS);
}

/**
 * Liga o gatilho. Chamado uma vez pelo background.
 *
 * Três gatilhos: o acervo muda (evento de storage), o navegador abre
 * (`onStartup`/`onInstalled`) e um ALARME periódico. O alarme é o que faz outra
 * máquina da conta aparecer sozinha, com o navegador parado — sem ele, só abrir
 * o navegador ou mexer em algo traria o que as outras máquinas fizeram.
 *
 * A permissão `alarms` não gera aviso na tela de instalação, então a extensão
 * não é desativada na atualização esperando consentimento novo. Cinco minutos:
 * de cada alarme sai UMA pergunta barata ao servidor, que na maioria das vezes
 * responde "nada de novo" sem tocar no banco (`server/lib/conector/cabeca.ts`).
 */
export function ligarSincronizacaoAutomatica(): void {
  chrome.storage.onChanged.addListener((mudancas, area) => {
    if (area !== 'local') return;
    if (!Object.keys(mudancas).some((k) => CHAVES_OBSERVADAS.includes(k))) return;
    agendarSincronizacao();
  });

  // Abrir o navegador é o momento natural de perguntar ao servidor o que as
  // outras máquinas fizeram enquanto este estava fechado: sempre pergunta.
  chrome.runtime.onStartup.addListener(() => void passada(true));
  // Na instalação e a cada atualização: é quando o service worker nasce sem
  // nenhum evento de storage para acordá-lo, e pode haver pendência da
  // versão anterior.
  chrome.runtime.onInstalled.addListener(() => void passada(true));

  // O listener é registrado já, no topo do worker: um alarme que dispara com o
  // worker dormindo o ACORDA, mas só se houver quem escute quando ele nascer.
  if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener((alarme) => {
      if (alarme.name === NOME_DO_ALARME) void passada(true);
    });
    // Só cria se ainda não existir: recriar a cada vez que o worker acorda
    // reiniciaria a contagem, e um worker que acorda a cada poucos minutos
    // nunca deixaria o alarme disparar.
    void chrome.alarms.get(NOME_DO_ALARME).then((existente) => {
      if (!existente) {
        chrome.alarms.create(NOME_DO_ALARME, {
          periodInMinutes: PERIODO_DO_ALARME_MIN,
          delayInMinutes: PERIODO_DO_ALARME_MIN,
        });
      }
    });
  }
}
