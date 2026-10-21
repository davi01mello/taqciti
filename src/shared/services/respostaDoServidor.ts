/**
 * O que dizer à pessoa quando o servidor do TaqCiti recusa um pedido.
 *
 * O servidor já escreve, para os erros que dependem de quem usa (cota do dia,
 * provedor ocupado, transcrição longa demais, documento que mudou), uma frase
 * pronta — e é ela que tem que chegar à tela. Antes, `requestGeneration` só
 * lia o corpo no 400 e mostrava "erro (429)" para a cota esgotada: a pessoa
 * não sabia se esperava um minuto ou até amanhã.
 *
 * Os erros que NÃO dependem de quem usa (chave da extensão recusada, trava de
 * política de dados, campo inválido) chegam do servidor em linguagem de quem
 * opera o servidor ("declare sintetica", "DOCCITI_SHARED_KEY"). Esses viram
 * uma frase que diz o que a pessoa pode fazer, e o detalhe vai para o log.
 */
import { SERVER_BASE_URL } from '@/shared/config/serverConfig';
import { logger } from './log';

export const SEM_CONEXAO =
  'Não foi possível falar com o servidor do TaqCiti. Confira a internet e tente de novo em instantes.';

/**
 * `fetch` lançou: servidor fora do ar, ou o navegador bloqueou a chamada
 * (CORS). O script não sabe qual dos dois — o console do navegador sabe, e é
 * para quem cuida do servidor, não para quem usa.
 */
export function semConexao(rota: string): string {
  logger.warn(`sem resposta de ${SERVER_BASE_URL}${rota}: servidor fora do ar ou chamada bloqueada (CORS)`);
  return SEM_CONEXAO;
}

const AVISE = 'Se continuar, avise quem cuida do TaqCiti.';

/** Lê o corpo da resposta recusada e devolve a frase para a tela. */
export async function mensagemDeRecusa(resposta: Response, rota: string): Promise<string> {
  const corpo = (await resposta.json().catch(() => ({}))) as { error?: unknown; aviso?: unknown };
  const doServidor = typeof corpo.error === 'string' && corpo.error.trim() ? corpo.error : undefined;
  const status = resposta.status;
  logger.warn(`servidor recusou ${rota}`, { status });

  if (status === 401) {
    return `O servidor do TaqCiti não reconheceu esta versão da extensão. Atualize o TaqCiti. ${AVISE}`;
  }
  if (status === 400) {
    // A trava de política de dados manda `aviso` junto: o servidor está numa
    // configuração de testes, e reunião de verdade não pode entrar nela.
    if (corpo.aviso) {
      return `O servidor do TaqCiti está numa configuração de testes, que não aceita reuniões de verdade. ${AVISE}`;
    }
    return `O servidor do TaqCiti não aceitou o pedido. ${AVISE}`;
  }
  if (doServidor) return doServidor;
  if (status === 409) return 'O documento mudou desde que você o abriu. Recarregue a versão atual.';
  if (status === 413) return 'O conteúdo é longo demais para o servidor. Tente com um recorte menor.';
  if (status === 422) return 'Não foi possível montar o documento com o que as fontes trazem.';
  if (status === 429) return 'O provedor de IA está com muitas chamadas agora. Tente de novo em um minuto.';
  return `O servidor do TaqCiti não conseguiu atender agora (${status}). Tente de novo em instantes.`;
}
