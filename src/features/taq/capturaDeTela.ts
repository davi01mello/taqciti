/**
 * CAPTURA DE TELA SOB PEDIDO — `capture_screen`.
 *
 * "Capture a tela" / "registre esta tela na reunião" é UM quadro, e não o
 * começo de uma gravação. Dois motivos de o quadro não ser tirado pela
 * ferramenta, e sim pelo cartão que ela entrega:
 *
 *   1. `getDisplayMedia` exige um gesto da pessoa (clique) e abre o seletor do
 *      sistema, onde ELA escolhe a aba, a janela ou a tela inteira. Uma
 *      ferramenta chamada pelo modelo não tem gesto, e capturar sem o seletor
 *      seria capturar a tela de alguém sem que escolhesse.
 *   2. A permissão da plataforma é concedida por captura, e o cancelamento no
 *      seletor é um desfecho normal ("cancelado"), não um erro.
 *
 * Por isso a ferramenta só prepara o cartão e diz, sem rodeio, que nenhuma
 * imagem foi feita ainda. A imagem real, a prévia, "Salvar na reunião",
 * "Abrir" e "Baixar" estão em `shared/ui/CartaoDeTela.tsx`, que usa as funções
 * deste módulo — as mesmas para a HOME e a sidebar.
 *
 * Nada aqui grava vídeo, mantém o fluxo aberto ou captura em intervalo: o
 * fluxo é parado assim que o primeiro quadro é lido.
 */
import { z } from 'zod/v4';
import type { MeetingRecord } from '@/shared/types/domain';
import { reuniaoNoEscopo } from './ferramentas';
import { podeLerReuniao } from './politica';
import { ErroDeFerramenta, type DefinicaoDeFerramenta } from './tipos';

/** O maior lado de uma captura guardada: o storage local tem cota (ver `shots.ts`). */
export const LADO_MAXIMO_PX = 1920;
export const QUALIDADE_JPEG = 0.88;

export type MotivoDeFalhaDaTela =
  /** A pessoa fechou o seletor ou negou a permissão. */
  | 'cancelado'
  /** O navegador não oferece captura de tela neste contexto. */
  | 'sem_suporte'
  /** A fonte escolhida não entregou um quadro (parou, ficou preta, expirou). */
  | 'sem_quadro'
  /** Qualquer outra recusa do navegador. */
  | 'recusado';

export type QuadroDaTela =
  | { ok: true; dataUrl: string; largura: number; altura: number; fonte: 'tela' | 'aba_da_reuniao' }
  | { ok: false; motivo: MotivoDeFalhaDaTela };

export const EXPLICACAO_DA_FALHA: Record<MotivoDeFalhaDaTela, string> = {
  cancelado: 'Captura cancelada: nenhuma imagem foi feita.',
  sem_suporte: 'Este navegador não oferece captura de tela aqui.',
  sem_quadro: 'A fonte escolhida não entregou imagem. Tente de novo.',
  recusado: 'O navegador não deixou capturar essa tela.',
};

/** Só o que `capturarQuadroDaTela` precisa do ambiente — troca-se nos testes. */
export interface AmbienteDeCaptura {
  getDisplayMedia?: (opcoes: DisplayMediaStreamOptions) => Promise<MediaStream>;
  /** Lê UM quadro do fluxo e o devolve como data URL JPEG. */
  lerQuadro: (fluxo: MediaStream) => Promise<{ dataUrl: string; largura: number; altura: number } | null>;
}

/** O quadro, via vídeo + canvas. Só existe onde há DOM. */
async function lerQuadroDoFluxo(
  fluxo: MediaStream,
): Promise<{ dataUrl: string; largura: number; altura: number } | null> {
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = fluxo;
  try {
    await video.play();
    // Espera um quadro de verdade: o primeiro ciclo costuma vir preto.
    await new Promise<void>((resolve, reject) => {
      const limite = setTimeout(() => reject(new Error('sem_quadro')), 4000);
      const pronto = () => {
        if (video.videoWidth > 0) {
          clearTimeout(limite);
          resolve();
        } else requestAnimationFrame(pronto);
      };
      pronto();
    });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const escala = Math.min(1, LADO_MAXIMO_PX / Math.max(video.videoWidth, video.videoHeight));
    const largura = Math.round(video.videoWidth * escala);
    const altura = Math.round(video.videoHeight * escala);
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return null;
    ctx2d.drawImage(video, 0, 0, largura, altura);
    return { dataUrl: canvas.toDataURL('image/jpeg', QUALIDADE_JPEG), largura, altura };
  } catch {
    return null;
  } finally {
    video.pause();
    video.srcObject = null;
  }
}

/**
 * Abre o seletor do sistema, lê UM quadro e PARA o fluxo. Chamar de dentro de
 * um clique: sem o gesto, o navegador recusa.
 */
export async function capturarQuadroDaTela(
  ambiente: Partial<AmbienteDeCaptura> = {},
): Promise<QuadroDaTela> {
  const pedir =
    ambiente.getDisplayMedia ??
    (typeof navigator !== 'undefined' && navigator.mediaDevices?.getDisplayMedia
      ? (o: DisplayMediaStreamOptions) => navigator.mediaDevices.getDisplayMedia(o)
      : undefined);
  if (!pedir) return { ok: false, motivo: 'sem_suporte' };

  let fluxo: MediaStream;
  try {
    // Sem áudio, e sem pedir taxa alta: é um quadro, não uma gravação.
    fluxo = await pedir({ video: { frameRate: 5 }, audio: false });
  } catch (e) {
    const nome = e instanceof Error ? e.name : '';
    // NotAllowedError é a pessoa fechando o seletor ou negando a permissão.
    return { ok: false, motivo: nome === 'NotAllowedError' || nome === 'AbortError' ? 'cancelado' : 'recusado' };
  }
  try {
    const quadro = await (ambiente.lerQuadro ?? lerQuadroDoFluxo)(fluxo);
    if (!quadro) return { ok: false, motivo: 'sem_quadro' };
    return { ok: true, ...quadro, fonte: 'tela' };
  } finally {
    // Nunca deixa o compartilhamento aberto — nem em erro.
    for (const faixa of fluxo.getTracks()) faixa.stop();
  }
}

/** Nome de arquivo do download: sem acento nem caractere perigoso. */
export function nomeDoArquivoDaCaptura(titulo: string | undefined, em: number): string {
  const base = (titulo ?? 'tela')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const d = new Date(em);
  const dia = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const hora = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  return `tela-${base || 'captura'}-${dia}-${hora}.jpg`;
}

// --------------------------------------------------------------- a ferramenta

const entrada = z.object({
  reuniao_id: z
    .string()
    .min(1)
    .optional()
    .describe('A reunião onde registrar a captura. Omita para "esta reunião"/a reunião em andamento.'),
});

/** A reunião do pedido: a dita, a da tela/conversa, ou a em andamento. Nenhuma é opcional demais. */
async function reuniaoDoPedido(
  ctx: Parameters<DefinicaoDeFerramenta['executar']>[1],
  id: string | undefined,
): Promise<MeetingRecord | null> {
  if (id) return reuniaoNoEscopo(ctx, id);
  const daTela =
    ctx.tarefa.selecionados.find((s) => s.tipo === 'reuniao')?.id ??
    (ctx.tarefa.escopo.reunioes !== 'todas' ? ctx.tarefa.escopo.reunioes[0] : undefined);
  if (daTela) return reuniaoNoEscopo(ctx, daTela);
  if (ctx.tarefa.foco?.tipo === 'reuniao') {
    try {
      return await reuniaoNoEscopo(ctx, ctx.tarefa.foco.id);
    } catch {
      /* foco que sumiu: cai para a reunião em andamento */
    }
  }
  const emCurso = (await ctx.armazenamento.listarReunioes())
    .filter((r) => r.status === 'recording' && podeLerReuniao(ctx.tarefa.escopo, r.id))
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  return emCurso ?? null;
}

export const captureScreen: DefinicaoDeFerramenta<z.infer<typeof entrada>> = {
  nome: 'capture_screen',
  descricao:
    'Prepara UMA captura de tela sob pedido ("capture a tela", "registre esta tela na reunião"). NÃO ' +
    'captura sozinha: o navegador exige que a pessoa escolha a aba/janela/tela e confirme, então o ' +
    'resultado é um cartão com “Capturar a tela”, prévia, “Salvar na reunião”, “Abrir” e “Baixar”. ' +
    'Nenhuma imagem existe até a pessoa clicar. Nunca é gravação nem captura contínua.',
  schemaDeEntrada: entrada,
  efeito: 'interface',
  requisitos: ['reunioes'],
  politica: { repeticao: 'idempotente', maxPorExecucao: 1 },
  etapa: 'Preparando a captura de tela',
  async executar(args, ctx) {
    let reuniao: MeetingRecord | null;
    try {
      reuniao = await reuniaoDoPedido(ctx, args.reuniao_id);
    } catch (e) {
      if (e instanceof ErroDeFerramenta) throw e;
      throw new ErroDeFerramenta('nao_encontrado', 'Não achei essa reunião.');
    }
    ctx.registrarCartao({
      tipo: 'captura_de_tela',
      ...(reuniao ? { reuniaoId: reuniao.id, titulo: reuniao.title } : {}),
      emAndamento: reuniao?.status === 'recording',
    });
    return {
      captura_realizada: false,
      aguardando_acao_da_pessoa: true,
      reuniao: reuniao ? { id: reuniao.id, titulo: reuniao.title } : null,
      aviso:
        'Nenhuma imagem foi feita ainda. Diga que o cartão abaixo pede a escolha da tela e que, depois da prévia, ' +
        'a pessoa decide se salva' +
        (reuniao ? ` na reunião “${reuniao.title}”` : ' (sem reunião no contexto, só dá para baixar)') +
        '. Não diga que capturou, salvou ou vinculou nada.',
    };
  },
  resumir: (s) => (s.reuniao ? 'cartão de captura de tela' : 'cartão de captura de tela (sem reunião)'),
};
