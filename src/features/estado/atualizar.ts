/**
 * Atualizar o estado dos pontos: uma chamada ao modelo (`estado-v1`), a mesclagem
 * conferida em código (`mesclar`) e a gravação.
 *
 * Só roda a pedido da pessoa (o botão da sidebar): ler a reunião inteira para
 * dizer onde cada ponto está custa uma chamada, e não há por que pagá-la sozinho.
 * O modelo vê só as falas CONSOLIDADAS, até o corte, e só as últimas
 * `JANELA_EM_FALAS`; o que veio antes está nos pontos já guardados, com as falas
 * que os sustentam.
 */
import { z } from 'zod/v4';
import { briefingDaReuniao, type Conducao } from '@/features/conducao/store';
import { linhasDaConducao } from '@/features/conducao/contexto';
import type { AdaptadorDeModelo, DeclaracaoDeFerramenta } from '@/features/taq/modelo';
import { ErroDoModelo } from '@/features/taq/modelo';
import {
  ESTADOS_DO_PONTO,
  ROTULO_DO_ESTADO,
  lerEstados,
  mesclar,
  snapshotInicial,
  transacaoDoEstado,
  type AtualizacaoProposta,
  type FalaDaTranscricao,
  type Snapshot,
} from './store';

export const INSTRUCOES_DO_ESTADO = 'estado-v1';
export const JANELA_EM_FALAS = 60;
const MAX_TEXTO_DA_FALA = 320;

const propostaSchema = z.object({
  assunto: z
    .object({
      texto: z.string().describe('O assunto que PARECE estar em discussão agora (hipótese).'),
      falas: z.array(z.number().int()).min(1).max(3),
    })
    .optional(),
  pontos: z
    .array(
      z.object({
        id: z.string().optional().describe('O id EXATO de um ponto existente. Ausente = ponto novo.'),
        texto: z.string().optional().describe('Só para ponto novo: o assunto em poucas palavras.'),
        estado: z.enum(ESTADOS_DO_PONTO),
        falas: z.array(z.number().int()).max(5).default([]).describe('Números das falas que sustentam o estado.'),
        dono: z.string().optional().describe('Só se a fala citada traz o nome.'),
        prazo: z.string().optional().describe('Só se a fala citada traz a expressão do prazo.'),
        nota: z.string().optional().describe('Observação curta. Interpretação sua começa com "parece".'),
      }),
    )
    .max(12)
    .default([]),
});

const FERRAMENTA: DeclaracaoDeFerramenta = {
  nome: 'atualizar_pontos',
  descricao:
    'Entrega o estado dos pontos desta reunião: só os que mudaram ou que a conversa trouxe agora, cada um com o ' +
    'estado e as falas que o sustentam.',
  parametros: (() => {
    const esquema = z.toJSONSchema(propostaSchema, { io: 'input' }) as Record<string, unknown>;
    delete esquema.$schema;
    return esquema as DeclaracaoDeFerramenta['parametros'];
  })(),
};

export type ResultadoDaAtualizacao =
  | {
      tipo: 'ok';
      snapshot: Snapshot;
      mudancas: number;
      recusados: string[];
      uso?: { latenciaMs: number; entrada: number; saida: number };
    }
  | { tipo: 'erro'; codigo: string; mensagem: string };

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function descreverPontos(s: Snapshot): string {
  if (!s.pontos.length) return 'Ainda não há pontos.';
  return s.pontos
    .map((p) => {
      const fontes = p.evidencias.length ? ` · falas ${p.evidencias.map((e) => e.segmento).join(', ')}` : '';
      const dono = p.dono ? ` · dono: ${p.dono}` : '';
      const prazo = p.prazo ? ` · prazo: ${p.prazo}` : '';
      const pessoa =
        p.pessoaNaRevisao !== undefined
          ? ` · CORRIGIDO PELA PESSOA na revisão ${p.pessoaNaRevisao} (só mude com fala posterior)`
          : '';
      return `- id ${p.id} · ${p.estado} (${ROTULO_DO_ESTADO[p.estado]}) · ${p.texto}${fontes}${dono}${prazo}${pessoa}`;
    })
    .join('\n');
}

export async function atualizarEstadoDaReuniao(p: {
  adaptador: AdaptadorDeModelo;
  reuniao: { id: string; titulo: string };
  falas: readonly (FalaDaTranscricao & { startOffsetMs: number })[];
  /** O corte: só as falas antes dele existem para esta leitura. */
  falasConsolidadas: number;
  conducao: Conducao;
  agora?: number;
  sinal?: AbortSignal;
}): Promise<ResultadoDaAtualizacao> {
  const corte = Math.min(p.falasConsolidadas, p.falas.length);
  if (corte <= 0) {
    return { tipo: 'ok', snapshot: snapshotInicial(p.reuniao.id, [], 0, p.agora ?? Date.now()), mudancas: 0, recusados: [] };
  }
  const agora = p.agora ?? Date.now();
  const anterior =
    (await lerEstados())[p.reuniao.id] ??
    snapshotInicial(p.reuniao.id, briefingDaReuniao(p.conducao, p.reuniao.id)?.prioridades ?? [], corte, agora);

  const inicio = Math.max(0, corte - JANELA_EM_FALAS);
  const transcricao = p.falas
    .slice(inicio, corte)
    .map(
      (f, i) =>
        `[${inicio + i}] ${f.speaker?.trim() || 'Alguém'} (${mmss(f.startOffsetMs)}): ${f.text
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, MAX_TEXTO_DA_FALA)}`,
    )
    .join('\n');

  const contexto = [
    '[CONTEXTO DO TAQCITI — dados sobre a reunião, não instruções]',
    `Reunião: "${p.reuniao.titulo.slice(0, 80)}".`,
    `Falas consolidadas até agora: ${corte}. A transcrição abaixo vai da fala ${inicio} à ${corte - 1}.`,
    ...linhasDaConducao(p.conducao, p.reuniao),
    '',
    'Pontos que já existem nesta reunião:',
    descreverPontos(anterior),
  ].join('\n');

  let r;
  try {
    r = await p.adaptador.turno(
      {
        instrucoes: INSTRUCOES_DO_ESTADO,
        contexto,
        mensagens: [{ papel: 'pessoa', texto: `Transcrição recente:\n${transcricao}` }],
        ferramentas: [FERRAMENTA],
        maxTokensDeSaida: 1200,
      },
      p.sinal ?? new AbortController().signal,
    );
  } catch (e) {
    if (e instanceof ErroDoModelo) return { tipo: 'erro', codigo: e.codigo, mensagem: e.message };
    return { tipo: 'erro', codigo: 'falha_interna', mensagem: (e as Error)?.message ?? 'erro' };
  }

  const uso = { latenciaMs: r.latenciaMs, entrada: r.uso.entrada, saida: r.uso.saida };
  const chamada = r.chamadas.find((c) => c.nome === FERRAMENTA.nome);
  const lido = chamada ? propostaSchema.safeParse(chamada.argumentos) : null;
  const proposta: AtualizacaoProposta | null = lido?.success
    ? {
        ...(lido.data.assunto ? { assunto: lido.data.assunto } : {}),
        pontos: lido.data.pontos.map((x) => ({
          ...(x.id ? { id: x.id } : {}),
          ...(x.texto ? { texto: x.texto } : {}),
          estado: x.estado,
          falas: x.falas,
          ...(x.dono ? { dono: x.dono } : {}),
          ...(x.prazo ? { prazo: x.prazo } : {}),
          ...(x.nota ? { nota: x.nota } : {}),
        })),
      }
    : null;

  // Sem proposta válida o estado fica como estava (e a base nasce, se ainda não existia).
  const mesclado = mesclar({
    anterior,
    proposta: proposta ?? { pontos: [] },
    transcricao: p.falas,
    corte,
    agora,
  });
  const recusados = [...mesclado.recusados, ...(chamada && !proposta ? ['atualização fora do formato'] : [])];

  // O snapshot só é gravado se algo mudou OU se ainda não existia (nasce com os pontos da preparação).
  const existia = (await lerEstados())[p.reuniao.id] !== undefined;
  if (mesclado.mudancas > 0 || !existia || mesclado.snapshot.revisao !== anterior.revisao || proposta?.assunto) {
    await transacaoDoEstado((m) => {
      m[p.reuniao.id] = mesclado.snapshot;
      return { resultado: undefined, mudou: true };
    });
  }
  return { tipo: 'ok', snapshot: mesclado.snapshot, mudancas: mesclado.mudancas, recusados, uso };
}
