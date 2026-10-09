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
import { tokenDeIdentidade, descartarToken } from '@/shared/services/identidade';
import { logger } from '@/shared/services/log';
import type { MeetingRecord } from '@/shared/types/domain';
import type { DocumentoGuardado } from '@/features/documents/store';
import type { HistoricoDoDocumento } from '@/features/documents/personalizado/versoes';
import type { Conversation } from '@/home/conversations';
import type { Nota } from '@/features/annotations/notes';
import type { MarcasDaReuniao } from '@/features/annotations/marks';
import type { Print } from '@/features/annotations/shots';
import {
  type ItemParaOAcervo,
  type TipoDeItem,
  conversaParaOAcervo,
  documentoParaOAcervo,
  historicoParaOAcervo,
  notaParaOAcervo,
  reuniaoParaOAcervo,
} from './paraOAcervo';

/** Espelha MAX_POR_LOTE em `server/app/api/sync/route.ts`. */
const POR_LOTE = 50;
/**
 * Teto de bytes por lote, abaixo dos 8 MiB do servidor: o histórico de um
 * documento chega a alguns megabytes, e 50 deles juntos estourariam o corpo —
 * falhando o lote inteiro, de novo a cada passada. Um item maior que o teto
 * viaja sozinho.
 */
const BYTES_POR_LOTE = 4 * 1024 * 1024;

/** `tipo:id` → assinatura do que já foi aceito pelo servidor. */
type Assinaturas = Record<string, string>;

interface EstadoDoSync {
  assinaturas: Assinaturas;
  ultimoMs?: number;
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
    });
  }

  const documentos = (await readLocal<DocumentoGuardado[]>(STORAGE_KEYS.documents)) ?? [];
  for (const d of documentos) {
    desejado.set(comporId('documento', d.id), {
      tipo: 'documento',
      item: documentoParaOAcervo(d),
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
    });
  }

  const notas = (await readLocal<Record<string, Nota>>(STORAGE_KEYS.notes)) ?? {};
  const marcas = (await readLocal<Record<string, MarcasDaReuniao>>(STORAGE_KEYS.marks)) ?? {};
  const prints = (await readLocal<Print[]>(STORAGE_KEYS.shots)) ?? [];
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
    });
  }

  return desejado;
}

// --------------------------------------------------------------- o diff

export interface Plano {
  enviar: { chave: string; tipo: TipoDeItem; item: unknown; assinatura: string }[];
  apagar: { chave: string; tipo: TipoDeItem; id: string }[];
}

export function planejar(
  desejado: Map<string, ItemParaOAcervo>,
  assinaturas: Assinaturas,
): Plano {
  const plano: Plano = { enviar: [], apagar: [] };

  for (const [chave, { tipo, item }] of desejado) {
    const assinatura = assinar(item);
    if (assinaturas[chave] !== assinatura) {
      plano.enviar.push({ chave, tipo, item, assinatura });
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
  | { estado: 'ok'; enviados: number; apagados: number }
  | { estado: 'falhou'; enviados: number; apagados: number; motivo: string };

interface Lote {
  itens: { tipo: TipoDeItem; item: unknown }[];
  apagados: { tipo: TipoDeItem; id: string }[];
  chaves: { chave: string; assinatura?: string }[];
}

/** Fatia o plano em lotes que caibam no teto do servidor. */
export function fatiar(plano: Plano, porLote = POR_LOTE): Lote[] {
  const lotes: Lote[] = [];
  let atual: Lote = { itens: [], apagados: [], chaves: [] };
  let bytes = 0;
  const fechar = () => {
    if (atual.chaves.length) lotes.push(atual);
    atual = { itens: [], apagados: [], chaves: [] };
    bytes = 0;
  };

  for (const e of plano.enviar) {
    const tamanho = JSON.stringify(e.item).length;
    if (atual.chaves.length > 0 && bytes + tamanho > BYTES_POR_LOTE) fechar();
    bytes += tamanho;
    atual.itens.push({ tipo: e.tipo, item: e.item });
    atual.chaves.push({ chave: e.chave, assinatura: e.assinatura });
    if (atual.chaves.length >= porLote) fechar();
  }
  for (const a of plano.apagar) {
    atual.apagados.push({ tipo: a.tipo, id: a.id });
    atual.chaves.push({ chave: a.chave });
    if (atual.chaves.length >= porLote) fechar();
  }
  fechar();
  return lotes;
}

/** `true` quando a pessoa disse sim na página Conexões. */
async function ligada(): Promise<boolean> {
  const sim = await readLocal<{ ligada?: boolean }>(STORAGE_KEYS.sync);
  return sim?.ligada === true;
}

/**
 * Uma passada de sincronização.
 *
 * Nunca lança: é chamada de um listener de evento do service worker, onde uma
 * exceção não tem quem a pegue e só vira ruído no console. Tudo vira um
 * `ResultadoDoSync`, que quem chama pode registrar ou ignorar.
 */
export async function sincronizar(): Promise<ResultadoDoSync> {
  if (!(await ligada())) return { estado: 'desligado' };

  const token = await tokenDeIdentidade(false);
  if (!token) return { estado: 'sem-token' };

  const estado = await lerEstado();
  const plano = planejar(await montarDesejado(), estado.assinaturas);
  if (plano.enviar.length === 0 && plano.apagar.length === 0) {
    return { estado: 'nada-a-fazer' };
  }

  const assinaturas = { ...estado.assinaturas };
  let enviados = 0;
  let apagados = 0;

  for (const lote of fatiar(plano)) {
    let resposta: Response;
    try {
      resposta = await fetch(`${SERVER_BASE_URL}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ itens: lote.itens, apagados: lote.apagados }),
      });
    } catch {
      return { estado: 'falhou', enviados, apagados, motivo: 'servidor inalcançável' };
    }

    if (resposta.status === 401) {
      // Token vencido. Descartar o cache local é o que permite a próxima
      // passada pegar um novo — sem isso, vira recusa permanente.
      await descartarToken();
      return { estado: 'falhou', enviados, apagados, motivo: 'credencial recusada' };
    }
    if (!resposta.ok) {
      return { estado: 'falhou', enviados, apagados, motivo: `servidor ${resposta.status}` };
    }

    // Item que o servidor RECUSOU por formato (histórico torto) não derruba o
    // lote: é registrado como aceito — reenviar o mesmo item só o recusaria
    // de novo, para sempre — e o motivo vai para o log.
    const corpo = (await resposta.json().catch(() => null)) as { recusados?: { id: string; motivo: string }[] } | null;
    for (const r of corpo?.recusados ?? []) logger.warn('item recusado pelo servidor', { id: r.id, motivo: r.motivo });

    // O lote inteiro foi aceito: registra as assinaturas dele ANTES do
    // próximo. Ver o cabeçalho.
    for (const { chave, assinatura } of lote.chaves) {
      if (assinatura) assinaturas[chave] = assinatura;
      else delete assinaturas[chave];
    }
    await writeLocal(STORAGE_KEYS.syncEstado, {
      assinaturas,
      ultimoMs: Date.now(),
    } satisfies EstadoDoSync);

    enviados += lote.itens.length;
    apagados += lote.apagados.length;
  }

  return { estado: 'ok', enviados, apagados };
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
async function passada(): Promise<void> {
  if (rodando) return;
  rodando = true;
  try {
    const r = await sincronizar();
    if (r.estado === 'ok') {
      logger.info('sincronizado', { enviados: r.enviados, apagados: r.apagados });
    } else if (r.estado === 'falhou') {
      logger.warn('sincronizacao falhou', { motivo: r.motivo, enviados: r.enviados });
    }
  } finally {
    rodando = false;
  }
}

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
 * Sem `chrome.alarms`: ele exigiria uma permissão nova, e o que ela
 * compraria é a repetição periódica. As duas situações reais já estão
 * cobertas — o acervo muda (evento de storage) ou o navegador reabre
 * (`onStartup`). Uma falha de rede é retentada na próxima das duas. Se isso
 * se mostrar insuficiente na prática, `alarms` é uma linha.
 */
export function ligarSincronizacaoAutomatica(): void {
  chrome.storage.onChanged.addListener((mudancas, area) => {
    if (area !== 'local') return;
    if (!Object.keys(mudancas).some((k) => CHAVES_OBSERVADAS.includes(k))) return;
    agendarSincronizacao();
  });

  chrome.runtime.onStartup.addListener(() => void passada());
  // Na instalação e a cada atualização: é quando o service worker nasce sem
  // nenhum evento de storage para acordá-lo, e pode haver pendência da
  // versão anterior.
  chrome.runtime.onInstalled.addListener(() => void passada());
}
