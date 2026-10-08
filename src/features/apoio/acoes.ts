/**
 * O que a pessoa faz com uma sugestão — cada gesto muda o estado E deixa o
 * feedback correspondente, para a calibração saber o que foi útil.
 *
 * "Usei esta pergunta" NÃO manda nada à reunião e NÃO prova que a pergunta foi
 * respondida: só registra que a pessoa a usou. Quem diz que um ponto foi
 * respondido é a conversa (o modelo, com a fala citada) ou a própria pessoa em
 * "Isso já foi resolvido".
 *
 * O alcance do feedback é "agora": nada vira regra geral em silêncio. Estender
 * para a reunião, o cliente ou a preferência é uma escolha explícita da
 * calibração (Etapa 6).
 */
import {
  definirPausa,
  mudarEstado,
  registrarFeedback,
  type ResultadoDaMudanca,
  type TipoDeFeedback,
} from './store';

async function agir(id: string, para: 'usada' | 'guardada' | 'resolvida' | 'descartada', feedback: TipoDeFeedback): Promise<ResultadoDaMudanca> {
  const r = await mudarEstado(id, para, 'pessoa');
  // Só deixa feedback do que de fato mudou: gesto repetido ou fora da tabela não conta.
  if (r.tipo === 'ok') await registrarFeedback({ sugestaoId: id, tipo: feedback });
  return r;
}

export const usarSugestao = (id: string) => agir(id, 'usada', 'util');
export const guardarParaDepois = (id: string) => agir(id, 'guardada', 'adiada');
export const jaFoiResolvido = (id: string) => agir(id, 'resolvida', 'ja_respondido');
export const descartarSugestao = (id: string) => agir(id, 'descartada', 'descartada');

/** Traz de volta uma guardada. Só se nada estiver na tela (uma por vez): quem chama confere. */
export const mostrarGuardada = (id: string) => mudarEstado(id, 'mostrada');

export const pausarSugestoes = (reuniaoId: string, pausada: boolean) => definirPausa(reuniaoId, pausada);
