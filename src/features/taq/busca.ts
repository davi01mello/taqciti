/**
 * Busca TEXTUAL sobre as reuniões e documentos do escopo.
 *
 * Sem índice vetorial, e de propósito: o acervo de uma pessoa cabe em memória,
 * as perguntas que se faz a ele citam nomes, termos e assuntos que aparecem
 * literalmente na transcrição, e a posição exata do acerto (o segmento) é o
 * que a citação precisa — um vizinho semântico não a devolve. Quando isso
 * deixar de bastar, o ponto de troca é esta função.
 *
 * Ignora acento e caixa, e descarta palavras vazias, mas não conhece
 * sinônimos. Quem chama (o modelo) é avisado disso pela descrição da ferramenta.
 */
import type { MeetingRecord } from '@/shared/types/domain';
import type { DocumentoGuardado } from '@/features/documents/store';
import type { Conversation } from '@/home/conversations';
import type { Localizacao, TipoDeRegistro } from './contratos';

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const VAZIAS = new Set(
  (
    'a o as os um uma uns umas de da do das dos em na no nas nos por para pra com sem ' +
    'e ou que se ao aos à às é foi ser sobre qual quais quem como quando onde isso isto ' +
    'esse essa este esta aquele aquela me te lhe nos vos eles elas ele ela eu voce vc ' +
    'meu minha seu sua ja nao sim mais menos muito pouco tem ter teve the of and to'
  ).split(' '),
);

export function termosDe(consulta: string): string[] {
  return [
    ...new Set(
      normalizar(consulta)
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2 && !VAZIAS.has(t)),
    ),
  ];
}

export interface TrechoAchado {
  /** Substring EXATA da fonte — é contra ela que a citação é conferida depois. */
  texto: string;
  local: Localizacao;
  falante?: string | null;
}

export interface Acerto {
  tipo: TipoDeRegistro;
  id: string;
  titulo: string;
  /** ISO, só a data. */
  data: string;
  pontuacao: number;
  trechos: TrechoAchado[];
}

export interface FiltrosDeBusca {
  consulta: string;
  tipos?: readonly TipoDeRegistro[];
  /** ISO `AAAA-MM-DD`, inclusive. */
  desde?: string;
  ate?: string;
  limite: number;
  /** Paginação: quantos resultados pular (a página seguinte é `pular + limite`). */
  pular?: number;
}

const TRECHOS_POR_REGISTRO = 3;
/** Janela de um trecho de documento, em caracteres. */
const JANELA = 320;

function dataIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dentroDoPeriodo(ms: number, filtros: FiltrosDeBusca): boolean {
  const dia = dataIso(ms);
  if (filtros.desde && dia < filtros.desde) return false;
  if (filtros.ate && dia > filtros.ate) return false;
  return true;
}

function contar(textoNormalizado: string, termos: readonly string[]): number {
  let n = 0;
  for (const t of termos) if (textoNormalizado.includes(t)) n += 1;
  return n;
}

/** Recorta a fala longa em volta do acerto, mantendo substring exata. */
function recortar(
  texto: string,
  termos: readonly string[],
): { texto: string; inicio: number } {
  if (texto.length <= JANELA) return { texto, inicio: 0 };
  const norm = normalizar(texto);
  const pos = termos.map((t) => norm.indexOf(t)).find((p) => p >= 0) ?? 0;
  // `normalizar` só remove diacríticos combinantes e junta espaços; o índice
  // aproximado basta para escolher a janela — o texto devolvido é da FONTE.
  const inicio = Math.max(0, Math.min(pos - JANELA / 3, texto.length - JANELA));
  return { texto: texto.slice(inicio, inicio + JANELA), inicio: Math.floor(inicio) };
}

function buscarNaReuniao(r: MeetingRecord, termos: readonly string[]): Acerto | null {
  const noTitulo = contar(normalizar(r.title), termos);
  const achados: Array<{ pontos: number; trecho: TrechoAchado }> = [];

  r.segments.forEach((s, i) => {
    const pontos = contar(normalizar(`${s.speaker ?? ''} ${s.text}`), termos);
    if (pontos === 0) return;
    achados.push({
      pontos,
      trecho: {
        texto: recortar(s.text, termos).texto,
        falante: s.speaker,
        local: {
          segmento: i,
          offsetMs: Math.max(0, Math.round(s.startOffsetMs)),
          ...(s.captionId ? { captionId: s.captionId } : {}),
        },
      },
    });
  });

  if (!noTitulo && !achados.length) return null;
  achados.sort(
    (a, b) =>
      b.pontos - a.pontos ||
      (a.trecho.local.segmento ?? 0) - (b.trecho.local.segmento ?? 0),
  );
  return {
    tipo: 'reuniao',
    id: r.id,
    titulo: r.title,
    data: dataIso(r.startedAt),
    pontuacao: noTitulo * 3 + achados.reduce((s, a) => s + a.pontos, 0),
    trechos: achados.slice(0, TRECHOS_POR_REGISTRO).map((a) => a.trecho),
  };
}

function buscarNoDocumento(
  d: DocumentoGuardado,
  termos: readonly string[],
): Acerto | null {
  const noTitulo = contar(normalizar(d.title), termos);
  const trechos: TrechoAchado[] = [];
  let pontos = 0;

  // Por parágrafo: é a unidade que a pessoa reconhece ao abrir o documento.
  let cursor = 0;
  for (const paragrafo of d.content.split(/\n{2,}/)) {
    const inicio = d.content.indexOf(paragrafo, cursor);
    cursor = inicio + paragrafo.length;
    const p = contar(normalizar(paragrafo), termos);
    if (!p || !paragrafo.trim()) continue;
    pontos += p;
    if (trechos.length < TRECHOS_POR_REGISTRO) {
      const corte = recortar(paragrafo, termos);
      trechos.push({
        texto: corte.texto,
        local: {
          inicio: inicio + corte.inicio,
          fim: inicio + corte.inicio + corte.texto.length,
        },
      });
    }
  }

  if (!noTitulo && !pontos) return null;
  return {
    tipo: 'documento',
    id: d.id,
    titulo: d.title,
    data: dataIso(d.updatedAt),
    pontuacao: noTitulo * 3 + pontos,
    trechos,
  };
}

/**
 * Consulta vazia = os mais recentes, sem trechos — é o "o que existe?" quando
 * não há termo para procurar.
 */
export function buscarRegistros(
  filtros: FiltrosDeBusca,
  fontes: {
    reunioes: readonly MeetingRecord[];
    documentos: readonly DocumentoGuardado[];
  },
): Acerto[] {
  const tipos = filtros.tipos?.length
    ? filtros.tipos
    : (['reuniao', 'documento'] as const);
  const termos = termosDe(filtros.consulta);
  const pular = filtros.pular ?? 0;
  const reunioes = tipos.includes('reuniao')
    ? fontes.reunioes.filter((r) => dentroDoPeriodo(r.startedAt, filtros))
    : [];
  const documentos = tipos.includes('documento')
    ? fontes.documentos.filter((d) => dentroDoPeriodo(d.updatedAt, filtros))
    : [];

  if (!termos.length) {
    const recentes: Array<{ ms: number; acerto: Acerto }> = [
      ...reunioes.map((r) => ({
        ms: r.startedAt,
        acerto: {
          tipo: 'reuniao' as const,
          id: r.id,
          titulo: r.title,
          data: dataIso(r.startedAt),
          pontuacao: 0,
          trechos: [],
        },
      })),
      ...documentos.map((d) => ({
        ms: d.updatedAt,
        acerto: {
          tipo: 'documento' as const,
          id: d.id,
          titulo: d.title,
          data: dataIso(d.updatedAt),
          pontuacao: 0,
          trechos: [],
        },
      })),
    ];
    return recentes
      .sort((a, b) => b.ms - a.ms)
      .slice(pular, pular + filtros.limite)
      .map((r) => r.acerto);
  }

  const acertos = [
    ...reunioes.map((r) => buscarNaReuniao(r, termos)),
    ...documentos.map((d) => buscarNoDocumento(d, termos)),
  ].filter((a): a is Acerto => a !== null);
  return acertos
    .sort((a, b) => b.pontuacao - a.pontuacao)
    .slice(pular, pular + filtros.limite);
}

// ---------------------------------------------------------------- conversas

/** Quem escreveu a mensagem. A resposta antiga do Taq NÃO é fonte de fato. */
export type PapelNaConversa = 'pessoa' | 'resposta_anterior_do_taq';

export interface AcertoDeConversa {
  id: string;
  titulo: string;
  data: string;
  pontuacao: number;
  trechos: Array<{ mensagem: number; papel: PapelNaConversa; texto: string }>;
}

/**
 * Busca nas conversas guardadas — mesma regra das reuniões (palavras, sem
 * acento), por mensagem. Consulta vazia lista as mais recentes.
 */
export function buscarConversas(
  filtros: Omit<FiltrosDeBusca, 'tipos'>,
  conversas: readonly Conversation[],
): AcertoDeConversa[] {
  const termos = termosDe(filtros.consulta);
  const pular = filtros.pular ?? 0;
  const noPeriodo = conversas.filter((c) => dentroDoPeriodo(c.updatedAt, filtros));
  const acertos = noPeriodo
    .map((c): AcertoDeConversa | null => {
      const noTitulo = termos.length ? contar(normalizar(c.title), termos) : 0;
      const achados = termos.length
        ? c.messages
            .map((m, i) => ({ m, i, pontos: m.demo ? 0 : contar(normalizar(m.text), termos) }))
            .filter((x) => x.pontos > 0)
        : [];
      if (termos.length && !noTitulo && !achados.length) return null;
      return {
        id: c.id,
        titulo: c.title,
        data: dataIso(c.updatedAt),
        pontuacao: noTitulo * 3 + achados.reduce((s, a) => s + a.pontos, 0),
        trechos: achados
          .sort((a, b) => b.pontos - a.pontos)
          .slice(0, TRECHOS_POR_REGISTRO)
          .map(({ m, i }) => ({
            mensagem: i,
            papel: m.role === 'user' ? 'pessoa' : 'resposta_anterior_do_taq',
            texto: recortar(m.text, termos).texto,
          })),
      };
    })
    .filter((a): a is AcertoDeConversa => a !== null);
  return acertos
    .sort((a, b) => b.pontuacao - a.pontuacao || (b.data > a.data ? 1 : -1))
    .slice(pular, pular + filtros.limite);
}
