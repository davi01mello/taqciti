/**
 * O TESTE HISTÓRICO — reproduz uma reunião passada pelo laço completo, por cortes
 * de tempo, para ver o que o assistente teria feito.
 *
 * ── Por que por cortes ──────────────────────────────────────────────────────
 *
 * Avaliar uma sugestão do minuto 10 só pode usar o que foi dito até o minuto 10.
 * Dar ao modelo a transcrição inteira criaria uma falsa impressão de capacidade
 * ao vivo: ele "preveria" o que já sabe que aconteceu. Aqui, a cada passo, o laço
 * recebe apenas as falas que existiam naquele instante, com o relógio simulado.
 *
 * ── Sem sujar os registros reais ────────────────────────────────────────────
 *
 * O laço grava sugestões, pausa e medição por reunião. O teste roda sob um id
 * PRÓPRIO (`teste:<id>`), lê o perfil e a preparação da reunião real, e apaga o
 * que gravou ao fim. A reunião real nunca ganha sugestão por causa do teste.
 *
 * ── Custo ───────────────────────────────────────────────────────────────────
 *
 * Cada avaliação é uma chamada ao modelo e envia trechos da reunião ao provedor.
 * O teste tem um teto de chamadas (`maxAvaliacoes`); passado o teto, os passos
 * seguintes ficam em silêncio e o relatório diz isso.
 */
import { carregarRetomada } from '@/features/conducao/retomada';
import { lerConducao, briefingDaReuniao, type Conducao } from '@/features/conducao/store';
import type { AdaptadorDeModelo } from '@/features/taq/modelo';
import { avaliarReuniao, type FalaDaReuniao } from '@/features/apoio/gerar';
import { criarLaco, falasConsolidadas } from '@/features/apoio/laco';
import { lerApoio, removerReuniaoDoApoio, type Sugestao } from '@/features/apoio/store';

export const PREFIXO_DO_TESTE = 'teste:';
export const PASSO_PADRAO_MS = 60_000;
export const MAX_AVALIACOES_PADRAO = 12;

export type AcaoNoCorte = 'mostrou' | 'silencio' | 'esperou' | 'erro' | 'sem_orcamento';

export interface LinhaDoRelatorio {
  /** O instante (offset desde o início) em que o corte foi feito. */
  noInstanteMs: number;
  /** Quantas falas o laço recebeu (as duas últimas ainda esperam consolidar). */
  falasVistas: number;
  /** Quantas falas consolidadas o modelo pôde ler. */
  falasConsolidadas: number;
  acao: AcaoNoCorte;
  sugestao?: { tipo: string; ponto: string; texto: string; pergunta?: string; falasCitadas: number[] };
  chamouOModelo: boolean;
}

export interface RelatorioHistorico {
  reuniaoId: string;
  passos: number;
  linhas: LinhaDoRelatorio[];
  avaliacoes: number;
  sugestoesGeradas: number;
  sugestoesMostradas: number;
  erros: number;
  /** O teto de chamadas foi atingido: os passos seguintes não foram avaliados. */
  paradoPeloTeto: boolean;
  /** Toda fonte citada existe e está ANTES do corte em que a sugestão nasceu. */
  fontesValidas: boolean;
}

export interface EntradaDoHistorico {
  adaptador: AdaptadorDeModelo;
  reuniao: { id: string; titulo: string };
  falas: readonly (FalaDaReuniao & { startOffsetMs: number })[];
  passoMs?: number;
  maxAvaliacoes?: number;
  /** Chamado a cada passo, para a tela mostrar o andamento. */
  aoAndar?: (feito: number, total: number) => void;
  sinal?: AbortSignal;
  /** Injetáveis para teste. */
  avaliar?: typeof avaliarReuniao;
  lerConducao?: () => Promise<Conducao>;
}

/** O perfil e a preparação da reunião real, valendo para o id do teste. */
function paraOTeste(c: Conducao, realId: string, testeId: string): Conducao {
  const b = briefingDaReuniao(c, realId);
  return b ? { ...c, briefings: [{ ...b, reuniaoId: testeId }, ...c.briefings.filter((x) => x.reuniaoId !== testeId)] } : c;
}

export async function reproduzirReuniao(p: EntradaDoHistorico): Promise<RelatorioHistorico> {
  const testeId = `${PREFIXO_DO_TESTE}${p.reuniao.id}`;
  const passoMs = p.passoMs ?? PASSO_PADRAO_MS;
  const maxAvaliacoes = p.maxAvaliacoes ?? MAX_AVALIACOES_PADRAO;
  const base = 1_700_000_000_000;
  const avaliarReal = p.avaliar ?? avaliarReuniao;
  const lerC = p.lerConducao ?? lerConducao;

  let relogio = base;
  let chamadas = 0;
  let chamouNoPasso = false;
  let paradoPeloTeto = false;
  const avaliar: typeof avaliarReuniao = async (args) => {
    if (chamadas >= maxAvaliacoes) {
      paradoPeloTeto = true;
      return { tipo: 'ok', nova: null, retiradas: [], recusados: ['teto de chamadas do teste'] };
    }
    chamadas += 1;
    chamouNoPasso = true;
    return avaliarReal(args);
  };

  const laco = criarLaco({
    adaptador: p.adaptador,
    agora: () => relogio,
    avaliar,
    lerConducao: async () => paraOTeste(await lerC(), p.reuniao.id, testeId),
    carregarRetomada: async (c) => carregarRetomada(c, p.reuniao.id),
  });

  const fim = p.falas.at(-1)?.startOffsetMs ?? 0;
  const instantes: number[] = [];
  for (let t = passoMs; t < fim + passoMs; t += passoMs) instantes.push(Math.min(t, fim));
  const unicos = [...new Set(instantes)];

  const linhas: LinhaDoRelatorio[] = [];
  const vistas = new Set<string>();
  let erros = 0;
  try {
    for (const [i, t] of unicos.entries()) {
      if (p.sinal?.aborted) break;
      relogio = base + t;
      // Só as falas que JÁ tinham começado neste instante: nada do futuro.
      const ate = p.falas.filter((f) => f.startOffsetMs <= t);
      chamouNoPasso = false;
      const antes = (await lerApoio()).medicoes[testeId]?.erros ?? 0;
      await laco.aoMudar({
        reuniao: { id: testeId, titulo: p.reuniao.titulo },
        falas: ate,
        encerrada: false,
        gravando: true,
      });
      const apoio = await lerApoio();
      const medicao = apoio.medicoes[testeId];
      const deste = apoio.sugestoes.filter((s) => s.reuniaoId === testeId);
      const nova = deste.find((s) => !vistas.has(s.id));
      if (nova) vistas.add(nova.id);
      const noPasso = (medicao?.erros ?? 0) > antes;
      if (noPasso) erros += 1;
      const consolidadas = falasConsolidadas(ate.length, false);
      linhas.push({
        noInstanteMs: t,
        falasVistas: ate.length,
        falasConsolidadas: consolidadas,
        acao: noPasso
          ? 'erro'
          : nova
            ? 'mostrou'
            : chamouNoPasso
              ? 'silencio'
              : paradoPeloTeto && chamadas >= maxAvaliacoes
                ? 'sem_orcamento'
                : 'esperou',
        ...(nova
          ? {
              sugestao: {
                tipo: nova.tipo,
                ponto: nova.ponto,
                texto: nova.texto,
                ...(nova.pergunta ? { pergunta: nova.pergunta } : {}),
                falasCitadas: nova.evidencias.map((e) => e.segmento),
              },
            }
          : {}),
        chamouOModelo: chamouNoPasso,
      });
      p.aoAndar?.(i + 1, unicos.length);
    }

    const finalApoio = await lerApoio();
    const todas = finalApoio.sugestoes.filter((s) => s.reuniaoId === testeId);
    const fontesValidas = todas.every((s: Sugestao) =>
      s.evidencias.every((e) => e.segmento < s.revisao && e.segmento < p.falas.length),
    );
    return {
      reuniaoId: p.reuniao.id,
      passos: linhas.length,
      linhas,
      avaliacoes: chamadas,
      sugestoesGeradas: todas.length,
      sugestoesMostradas: todas.filter((s) => s.mostradaEm !== undefined).length,
      erros,
      paradoPeloTeto,
      fontesValidas,
    };
  } finally {
    laco.parar();
    await removerReuniaoDoApoio(testeId);
  }
}
