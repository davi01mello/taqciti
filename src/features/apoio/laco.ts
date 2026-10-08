/**
 * O LAÇO AO VIVO do apoio à condução.
 *
 * Roda enquanto a sidebar está aberta numa reunião e junta as partes: lê o
 * perfil e a pausa, aplica a política (`politica.ts`), chama o gerador
 * (`gerar.ts`) dentro do orçamento e grava o que foi aceito. A captura não
 * depende disto: falha aqui nunca derruba nada, e sem perfil de condução (ou
 * com o modo "só quando eu chamar") o laço NÃO chama o modelo.
 *
 * ── Ordem de cada passada ───────────────────────────────────────────────────
 *
 *   1. reunião encerrada → o que estava aberto expira; fim.
 *   2. modo, pausa e corte (falas consolidadas) lidos AGORA.
 *   3. política sobre o que já existe: expira o obsoleto, mostra a melhor (UMA)
 *      — isto é só conta e acontece também quando o modelo não é chamado.
 *   4. se o orçamento deixa (`podeAvaliar`), UMA avaliação pelo modelo.
 *   5. o resultado só vale se a reunião ainda é a mesma e a chamada não foi
 *      cancelada: uma tarefa antiga não publica sugestão de assunto superado.
 *      O que vale é gravado e a política roda de novo, já com o corte atual.
 *
 * Cada chamada ao modelo deixa uma medição (tempo, tokens, resultado), que é
 * o que a Etapa 6 usa para ajustar frequência e custo com dados.
 */
import { perfilQueValeParaAReuniao } from '@/features/conducao/contexto';
import { lerConducao, type Conducao, type ModoDeIntervencao } from '@/features/conducao/store';
import type { AdaptadorDeModelo } from '@/features/taq/modelo';
import { aplicarAvaliacao, avaliarReuniao, janelaDeLeitura, type FalaDaReuniao } from './gerar';
import { contarPalavras, planejar, podeAvaliar } from './politica';
import { lerApoio, mudarEstado, somarMedicao, type Apoio, type Sugestao } from './store';

/** As últimas falas do ao vivo ainda podem ser revistas: esperam. */
export const FALAS_INSTAVEIS = 2;

export const falasConsolidadas = (total: number, encerrada: boolean): number =>
  encerrada ? total : Math.max(0, total - FALAS_INSTAVEIS);

export interface EntradaDoLaco {
  reuniao: { id: string; titulo: string };
  /** Quem provavelmente conduz (a pessoa que o Taq ajuda), quando se sabe. */
  quemConduz?: string | null;
  falas: readonly FalaDaReuniao[];
  /** A reunião acabou: tudo está consolidado e nada mais é sugerido. */
  encerrada: boolean;
  /** A captura está rodando (não pausada). Pausada, o laço só aplica a política. */
  gravando: boolean;
}

export interface DependenciasDoLaco {
  adaptador: AdaptadorDeModelo;
  agora?: () => number;
  avaliar?: typeof avaliarReuniao;
  lerConducao?: () => Promise<Conducao>;
  lerApoio?: () => Promise<Apoio>;
}

export interface Laco {
  /** Avisa que a reunião mudou e roda uma passada. Seguro de chamar a cada fala. */
  aoMudar(entrada: EntradaDoLaco): Promise<void>;
  /** Roda uma passada com a última entrada (passou o tempo, mudou o perfil ou a pausa). */
  cutucar(): Promise<void>;
  /** Cancela a avaliação em curso e esquece a reunião. */
  parar(): void;
}

export function criarLaco(deps: DependenciasDoLaco): Laco {
  const agora = deps.agora ?? Date.now;
  const avaliar = deps.avaliar ?? avaliarReuniao;
  const conducao = deps.lerConducao ?? lerConducao;
  const apoio = deps.lerApoio ?? lerApoio;

  let ultima: EntradaDoLaco | null = null;
  let reuniaoAtual = '';
  let ultimaAvaliacao: { em: number; falas: number } | null = null;
  let emVoo: AbortController | null = null;
  /** Passadas em fila: uma de cada vez, a mais recente vence. */
  let correndo: Promise<void> = Promise.resolve();

  const doModo = (c: Conducao, id: string): ModoDeIntervencao =>
    perfilQueValeParaAReuniao(c, id)?.intervencao.modo ?? 'sob_demanda';

  async function aplicarPolitica(
    e: EntradaDoLaco,
    modo: ModoDeIntervencao,
    pausado: boolean,
    sugestoes: readonly Sugestao[],
  ): Promise<void> {
    const doMeeting = sugestoes.filter((s) => s.reuniaoId === e.reuniao.id);
    const plano = planejar({
      modo,
      pausado,
      agora: agora(),
      falasConsolidadas: falasConsolidadas(e.falas.length, e.encerrada),
      sugestoes: doMeeting,
    });
    for (const s of plano.expirarNaTela) await mudarEstado(s.id, 'expirada', 'tempo', agora());
    for (const d of plano.descartar)
      await mudarEstado(d.sugestao.id, 'expirada', d.motivo === 'obsoleta' ? 'tempo' : 'politica', agora());
    for (const s of plano.substituir) await mudarEstado(s.id, 'substituida', 'substituicao', agora());
    if (plano.mostrar) await mudarEstado(plano.mostrar.id, 'mostrada', undefined, agora());
  }

  /** Sob demanda ou pausado: o que ainda não apareceu não vai aparecer depois. */
  async function limparPendentes(reuniaoId: string, sugestoes: readonly Sugestao[]): Promise<void> {
    for (const s of sugestoes)
      if (s.reuniaoId === reuniaoId && s.estado === 'pendente') await mudarEstado(s.id, 'expirada', 'politica', agora());
  }

  async function passada(e: EntradaDoLaco): Promise<void> {
    if (e.reuniao.id !== reuniaoAtual) {
      emVoo?.abort();
      emVoo = null;
      ultimaAvaliacao = null;
      reuniaoAtual = e.reuniao.id;
    }
    const ap0 = await apoio();
    if (e.encerrada) {
      emVoo?.abort();
      emVoo = null;
      await limparPendentes(e.reuniao.id, ap0.sugestoes);
      for (const s of ap0.sugestoes)
        if (s.reuniaoId === e.reuniao.id && s.estado === 'mostrada') await mudarEstado(s.id, 'expirada', 'tempo', agora());
      return;
    }
    const c = await conducao();
    const modo = doModo(c, e.reuniao.id);
    const pausado = ap0.pausadas[e.reuniao.id] === true;
    const corte = falasConsolidadas(e.falas.length, e.encerrada);

    if (modo === 'sob_demanda' || pausado) {
      await limparPendentes(e.reuniao.id, ap0.sugestoes);
      return;
    }
    await aplicarPolitica(e, modo, pausado, ap0.sugestoes);

    const palavrasNaJanela = janelaDeLeitura(e.falas, corte).falas.reduce((n, f) => n + contarPalavras(f.text), 0);
    if (
      emVoo ||
      !e.gravando ||
      !podeAvaliar({
        modo,
        pausado,
        agora: agora(),
        falasConsolidadas: corte,
        palavrasNaJanela,
        ultimaAvaliacao,
      })
    )
      return;

    const controle = new AbortController();
    emVoo = controle;
    ultimaAvaliacao = { em: agora(), falas: corte };
    const sugestoes = (await apoio()).sugestoes.filter((s) => s.reuniaoId === e.reuniao.id);
    let r: Awaited<ReturnType<typeof avaliarReuniao>>;
    try {
      r = await avaliar({
        adaptador: deps.adaptador,
        reuniao: e.reuniao,
        ...(e.quemConduz ? { quemConduz: e.quemConduz } : {}),
        falas: e.falas,
        falasConsolidadas: corte,
        conducao: c,
        sugestoes,
        modo,
        sinal: controle.signal,
      });
    } catch (erro) {
      r = { tipo: 'erro', codigo: 'falha_interna', mensagem: (erro as Error)?.message ?? 'erro' };
    }
    if (emVoo === controle) emVoo = null;
    // Cancelada, ou a reunião mudou no meio: o resultado é de uma tarefa antiga.
    if (controle.signal.aborted || reuniaoAtual !== e.reuniao.id) return;

    if (r.tipo === 'erro') {
      await somarMedicao(e.reuniao.id, { avaliacoes: 1, erros: 1 });
      return;
    }
    const feito = await aplicarAvaliacao(r, sugestoes);
    await somarMedicao(e.reuniao.id, {
      avaliacoes: 1,
      silencios: !feito.criada && !feito.retiradas ? 1 : 0,
      sugestoesGeradas: feito.criada ? 1 : 0,
      retiradas: feito.retiradas,
      recusadas: r.recusados.length,
      ...(r.uso
        ? { latenciaTotalMs: r.uso.latenciaMs, tokensEntrada: r.uso.entrada, tokensSaida: r.uso.saida }
        : {}),
    });
    // O corte andou enquanto o modelo pensava: a política decide com o de agora.
    const atual = ultima ?? e;
    if (atual.reuniao.id === e.reuniao.id) {
      const ap = await apoio();
      await aplicarPolitica(atual, modo, ap.pausadas[e.reuniao.id] === true, ap.sugestoes);
    }
  }

  const enfileirar = (e: EntradaDoLaco): Promise<void> => {
    correndo = correndo.then(() => passada(e)).catch(() => undefined);
    return correndo;
  };

  return {
    aoMudar(entrada) {
      ultima = entrada;
      return enfileirar(entrada);
    },
    cutucar() {
      return ultima ? enfileirar(ultima) : Promise.resolve();
    },
    parar() {
      emVoo?.abort();
      emVoo = null;
      ultima = null;
      reuniaoAtual = '';
      ultimaAvaliacao = null;
    },
  };
}
