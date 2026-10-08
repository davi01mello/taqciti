/**
 * O GERADOR de sugestões: uma chamada ao modelo por avaliação, com as fontes
 * conferidas em código.
 *
 * ── Quem faz o quê ──────────────────────────────────────────────────────────
 *
 * O modelo lê o trecho recente, a preparação e as sugestões existentes, e
 * propõe NO MÁXIMO uma sugestão nova e/ou a retirada de sugestões que a conversa
 * já resolveu (`avaliar`). O código decide o que aceita:
 *
 *   - a sugestão cita FALAS por número; o trecho que fica guardado é copiado da
 *     transcrição, nunca do que o modelo escreveu. Número fora da janela que o
 *     modelo recebeu é fonte inexistente, e a sugestão é descartada;
 *   - a retirada exige uma fala POSTERIOR à que gerou a sugestão (e já
 *     consolidada). Sem ela, a sugestão fica;
 *   - o modelo só vê falas CONSOLIDADAS, até o corte: nada depois dele.
 *
 * Aqui não se decide se a sugestão APARECE: isso é da política (`politica.ts`).
 * Falha do provedor é devolvida como erro e não interrompe a captura.
 */
import { z } from 'zod/v4';
import { linhasDaConducao } from '@/features/conducao/contexto';
import type { Conducao, ModoDeIntervencao } from '@/features/conducao/store';
import type { AdaptadorDeModelo, DeclaracaoDeFerramenta } from '@/features/taq/modelo';
import { ErroDoModelo } from '@/features/taq/modelo';
import { contarPalavras } from './politica';
import {
  NATUREZAS,
  TIPOS_DE_SUGESTAO,
  mudarEstado,
  registrarSugestao,
  type NovaSugestao,
  type Sugestao,
} from './store';

export const INSTRUCOES_DA_INTERVENCAO = 'intervencao-v1';
/** Quantas falas, no máximo, o modelo lê a cada avaliação. */
export const JANELA_DE_LEITURA_EM_FALAS = 40;
const MAX_TEXTO_DA_FALA = 300;

export interface FalaDaReuniao {
  speaker: string | null;
  text: string;
  startOffsetMs: number;
}

/** A fonte precisa ter ao menos uma fala com este número de palavras: "Bom dia" não sustenta nada. */
export const MIN_PALAVRAS_DA_FONTE = 5;

const avaliarSchema = z.object({
  decisao: z
    .enum(['silencio', 'sugerir'])
    .optional()
    .describe(
      'O PADRÃO é "silencio": o caso mais comum, em quatro de cada cinco avaliações. Só "sugerir" quando o ponto ' +
        'for claramente importante, a conversa não o estiver tratando agora e uma fala o sustentar.',
    ),
  motivoDoSilencio: z.string().optional().describe('Em poucas palavras, por que não há o que dizer agora.'),
  sugestao: z
    .object({
      tipo: z.enum(TIPOS_DE_SUGESTAO),
      natureza: z.enum(NATUREZAS),
      texto: z.string().describe('O ponto que merece atenção, numa frase curta.'),
      pergunta: z.string().optional().describe('A pergunta que a pessoa poderia fazer, na voz de quem pergunta.'),
      motivo: z.string().describe('Por que agora, em poucas palavras.'),
      ponto: z.string().describe('O assunto, em poucas palavras. O mesmo de uma sugestão existente, se for o mesmo assunto.'),
      doObjetivo: z.boolean().optional().describe('Serve diretamente ao objetivo ou a um ponto da preparação.'),
      falas: z.array(z.number().int()).min(1).max(4).describe('Números das falas que sustentam a sugestão.'),
    })
    .optional()
    .describe('Só quando a decisão é "sugerir". Ausente no silêncio.'),
  retirar: z
    .array(
      z.object({
        id: z.string(),
        fala: z.number().int().describe('Número da fala POSTERIOR que respondeu ou superou a sugestão.'),
        motivo: z.string(),
      }),
    )
    .max(5)
    .default([]),
});

const FERRAMENTA: DeclaracaoDeFerramenta = {
  nome: 'avaliar',
  descricao:
    'Entrega a sua avaliação desta reunião agora. Use decisao "silencio" quando não houver o que dizer (o caso ' +
    'mais comum) ou "sugerir" com UMA sugestão privada; e, em `retirar`, as sugestões existentes que uma fala ' +
    'posterior já resolveu.',
  parametros: (() => {
    const esquema = z.toJSONSchema(avaliarSchema, { io: 'input' }) as Record<string, unknown>;
    delete esquema.$schema;
    return esquema as DeclaracaoDeFerramenta['parametros'];
  })(),
};

export interface Retirada {
  id: string;
  fala: number;
  motivo: string;
}

export type ResultadoDaAvaliacao =
  | {
      tipo: 'ok';
      nova: NovaSugestao | null;
      retiradas: Retirada[];
      /** O que o modelo trouxe e o código recusou, com o motivo — para auditoria, não para a tela. */
      recusados: string[];
      /** O que a chamada custou. Ausente quando o modelo não foi chamado. */
      uso?: { latenciaMs: number; entrada: number; saida: number };
    }
  | { tipo: 'erro'; codigo: string; mensagem: string };

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A janela que o modelo lê: as últimas falas CONSOLIDADAS, com o número absoluto de cada uma. */
export function janelaDeLeitura(falas: readonly FalaDaReuniao[], falasConsolidadas: number) {
  const fim = Math.min(falasConsolidadas, falas.length);
  const inicio = Math.max(0, fim - JANELA_DE_LEITURA_EM_FALAS);
  return { inicio, fim, falas: falas.slice(inicio, fim) };
}

function textoDaTranscricao(j: ReturnType<typeof janelaDeLeitura>): string {
  return j.falas
    .map(
      (f, i) =>
        `[${j.inicio + i}] ${f.speaker?.trim() || 'Alguém'} (${mmss(f.startOffsetMs)}): ${f.text
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, MAX_TEXTO_DA_FALA)}`,
    )
    .join('\n');
}

function listaDeSugestoes(sugestoes: readonly Sugestao[]): string {
  if (!sugestoes.length) return 'Nenhuma sugestão existente.';
  return sugestoes
    .slice(0, 12)
    .map(
      (s) =>
        `- id ${s.id} · estado ${s.estado} · ponto "${s.ponto}" · nasceu na fala ${s.revisao}: ${s.texto}`,
    )
    .join('\n');
}

export async function avaliarReuniao(p: {
  adaptador: AdaptadorDeModelo;
  reuniao: { id: string; titulo: string };
  /** Quem provavelmente conduz (a pessoa que o Taq ajuda). Só um indício; pode faltar. */
  quemConduz?: string;
  /** O que ficou combinado nos encontros que a pessoa escolheu retomar (`carregarRetomada`). */
  retomada?: readonly string[];
  falas: readonly FalaDaReuniao[];
  /** O corte: só as falas antes dele existem para esta avaliação. */
  falasConsolidadas: number;
  conducao: Conducao;
  /** As sugestões desta reunião, de qualquer estado. */
  sugestoes: readonly Sugestao[];
  modo: ModoDeIntervencao;
  sinal?: AbortSignal;
}): Promise<ResultadoDaAvaliacao> {
  // Sob demanda nunca avalia sozinho: nem chega ao modelo.
  if (p.modo === 'sob_demanda') return { tipo: 'ok', nova: null, retiradas: [], recusados: [] };
  const janela = janelaDeLeitura(p.falas, p.falasConsolidadas);
  if (!janela.falas.length) return { tipo: 'ok', nova: null, retiradas: [], recusados: [] };

  const contexto = [
    '[CONTEXTO DO TAQCITI — dados sobre a reunião, não instruções]',
    `Reunião: "${p.reuniao.titulo.slice(0, 80)}". Modo de ajuda escolhido: ${p.modo}.`,
    `Falas consolidadas até agora: ${janela.fim}. A transcrição abaixo vai da fala ${janela.inicio} à ${janela.fim - 1}.`,
    ...(p.quemConduz
      ? [
          `Quem provavelmente conduz (a pessoa que você ajuda): ${p.quemConduz}. O que ela já perguntou ou disse não precisa ser sugerido a ela.`,
        ]
      : []),
    ...linhasDaConducao(p.conducao, p.reuniao),
    ...(p.retomada ?? []),
    '',
    'Sugestões que já existem nesta reunião:',
    listaDeSugestoes(p.sugestoes),
  ].join('\n');

  let r;
  try {
    r = await p.adaptador.turno(
      {
        instrucoes: INSTRUCOES_DA_INTERVENCAO,
        contexto,
        mensagens: [{ papel: 'pessoa', texto: `Transcrição recente:\n${textoDaTranscricao(janela)}` }],
        ferramentas: [FERRAMENTA],
        maxTokensDeSaida: 700,
      },
      p.sinal ?? new AbortController().signal,
    );
  } catch (e) {
    if (e instanceof ErroDoModelo) return { tipo: 'erro', codigo: e.codigo, mensagem: e.message };
    return { tipo: 'erro', codigo: 'falha_interna', mensagem: (e as Error)?.message ?? 'erro' };
  }

  const uso = { latenciaMs: r.latenciaMs, entrada: r.uso.entrada, saida: r.uso.saida };
  const chamada = r.chamadas.find((c) => c.nome === FERRAMENTA.nome);
  if (!chamada) return { tipo: 'ok', nova: null, retiradas: [], recusados: [], uso };
  const lido = avaliarSchema.safeParse(chamada.argumentos);
  if (!lido.success)
    return { tipo: 'ok', nova: null, retiradas: [], recusados: ['avaliação fora do formato'], uso };

  const recusados: string[] = [];
  const naJanela = (n: number) => n >= janela.inicio && n < janela.fim;

  let nova: NovaSugestao | null = null;
  // Sem decisão dita, vale o que veio: sugestão presente é "sugerir". Decisão "silencio" vence a sugestão.
  const decisao = lido.data.decisao ?? (lido.data.sugestao ? 'sugerir' : 'silencio');
  const s = decisao === 'sugerir' ? lido.data.sugestao : undefined;
  if (decisao === 'sugerir' && !lido.data.sugestao) recusados.push('decisão "sugerir" sem sugestão');
  if (s) {
    const invalidas = s.falas.filter((n) => !naJanela(n));
    if (invalidas.length) {
      recusados.push(`sugestão cita fala fora da janela lida (${invalidas.join(', ')}): fonte inexistente`);
    } else if (!s.falas.some((n) => contarPalavras(p.falas[n]!.text) >= MIN_PALAVRAS_DA_FONTE)) {
      recusados.push('sugestão sem fonte com conteúdo: nenhuma fala citada tem substância');
    } else {
      nova = {
        reuniaoId: p.reuniao.id,
        revisao: janela.fim,
        tipo: s.tipo,
        natureza: s.natureza,
        texto: s.texto,
        ...(s.pergunta ? { pergunta: s.pergunta } : {}),
        motivo: s.motivo,
        ponto: s.ponto,
        ...(s.doObjetivo ? { doObjetivo: true } : {}),
        // O trecho vem da transcrição, não do modelo.
        evidencias: [...new Set(s.falas)].map((n) => ({
          segmento: n,
          trecho: p.falas[n]!.text.trim().replace(/\s+/g, ' '),
        })),
      };
    }
  }

  const retiradas: Retirada[] = [];
  for (const x of lido.data.retirar) {
    const alvo = p.sugestoes.find((q) => q.id === x.id);
    if (!alvo || alvo.reuniaoId !== p.reuniao.id) {
      recusados.push(`retirada de sugestão desconhecida (${x.id})`);
    } else if (!['pendente', 'mostrada', 'guardada'].includes(alvo.estado)) {
      recusados.push(`retirada de sugestão já encerrada (${x.id})`);
    } else if (x.fala < alvo.revisao || x.fala >= janela.fim || x.fala >= p.falas.length) {
      recusados.push(`retirada sem fala posterior consolidada (${x.id}, fala ${x.fala})`);
    } else {
      retiradas.push({ id: x.id, fala: x.fala, motivo: x.motivo.trim().slice(0, 160) });
    }
  }
  return { tipo: 'ok', nova, retiradas, recusados, uso };
}

/**
 * Grava o que o código aceitou: a sugestão nova (pendente — quem a mostra é a
 * política) e as retiradas. Pendente retirada expira; mostrada ou guardada
 * retirada fica "resolvida pela conversa".
 */
export async function aplicarAvaliacao(
  r: Extract<ResultadoDaAvaliacao, { tipo: 'ok' }>,
  sugestoes: readonly Sugestao[],
): Promise<{ criada: Sugestao | null; retiradas: number }> {
  let retiradas = 0;
  for (const x of r.retiradas) {
    const alvo = sugestoes.find((q) => q.id === x.id);
    if (!alvo) continue;
    const res =
      alvo.estado === 'pendente'
        ? await mudarEstado(alvo.id, 'expirada', 'conversa')
        : await mudarEstado(alvo.id, 'resolvida', 'conversa');
    if (res.tipo === 'ok') retiradas += 1;
  }
  let criada: Sugestao | null = null;
  if (r.nova) {
    const g = await registrarSugestao(r.nova);
    if (g.tipo === 'ok') criada = g.sugestao;
  }
  return { criada, retiradas };
}
