/**
 * O que `POST /api/taq/turno` faz, fora do Next — para dar para testar.
 *
 * A rota em `app/api/taq/turno/route.ts` só cuida de CORS, do segredo
 * compartilhado e de ler o corpo; a decisão inteira mora aqui, com o ambiente e
 * o adaptador injetados.
 *
 * A ordem das recusas importa e é a do custo: primeiro o que não custa nada
 * (forma do pedido, configuração, política de dados, tamanho), por último a
 * chamada ao provedor, que custa dinheiro.
 */
import { OverloadedError, ProviderError, RateLimitError } from '@/lib/ai/types';
import {
  pedidoDeTurnoSchema,
  type CodigoDeErro,
  type ErroDoTurno,
  type RespostaDoTurno,
} from './contrato';
import { resolverConfiguracao } from './config';
import { ErroDeConversao, ErroDeLentidao, type AdaptadorDeTurno } from './gemini';
import { instrucoesDoTaq, versaoSuportada } from './instrucoes';

/** Teto do pedido inteiro, em caracteres. A extensão tem o seu, menor. */
const MAX_CONTEXTO_PADRAO = 300_000;

export function maxContextoChars(env: NodeJS.ProcessEnv = process.env): number {
  const bruto = env.TAQ_MAX_CONTEXTO_CHARS?.trim();
  const n = bruto ? Number.parseInt(bruto, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : MAX_CONTEXTO_PADRAO;
}

export interface Resultado {
  status: number;
  corpo: RespostaDoTurno | ErroDoTurno;
}

function erro(status: number, codigo: CodigoDeErro, mensagem: string, transitorio = false): Resultado {
  return { status, corpo: { erro: { codigo, mensagem, transitorio } } };
}

export async function atenderTurno(
  bruto: unknown,
  deps: {
    adaptadores: Record<string, AdaptadorDeTurno>;
    env?: NodeJS.ProcessEnv;
    sinal?: AbortSignal;
  },
): Promise<Resultado> {
  const env = deps.env ?? process.env;

  const lido = pedidoDeTurnoSchema.safeParse(bruto);
  if (!lido.success) {
    const onde = lido.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('; ');
    return erro(400, 'pedido_invalido', `Pedido fora do contrato — ${onde}.`);
  }
  const pedido = lido.data;

  const config = resolverConfiguracao(env);
  if (config.pendencias.length || !config.provedor || !config.modelo) {
    return erro(503, 'configuracao_pendente', config.pendencias.join(' '));
  }
  const adaptador = deps.adaptadores[config.provedor];
  if (!adaptador) {
    return erro(503, 'configuracao_pendente', `Sem adaptador para ${config.provedor}.`);
  }

  if (!versaoSuportada(pedido.instrucoes)) {
    return erro(400, 'pedido_invalido', `Versão de instruções desconhecida: ${pedido.instrucoes}.`);
  }

  if (config.politicaDeDados === 'training' && pedido.sintetica !== true) {
    return erro(
      403,
      'politica_de_dados',
      'A chave do servidor envia o conteúdo para treinamento do provedor. Enquanto for ' +
        'assim, o Taq só aceita conteúdo sintético — registros reais não podem ir para lá.',
    );
  }

  const tamanho =
    pedido.contexto.length +
    JSON.stringify(pedido.mensagens).length +
    JSON.stringify(pedido.ferramentas).length;
  const teto = maxContextoChars(env);
  if (tamanho > teto) {
    return erro(413, 'contexto_grande_demais', `O turno tem ${tamanho} caracteres; o teto é ${teto}.`);
  }

  const inicio = Date.now();
  try {
    const saida = await adaptador.executar(
      config.modelo,
      {
        sistema: instrucoesDoTaq(pedido.instrucoes),
        contexto: pedido.contexto,
        mensagens: pedido.mensagens,
        ferramentas: pedido.ferramentas,
        maxTokensDeSaida: pedido.maxTokensDeSaida,
      },
      deps.sinal,
    );
    return {
      status: 200,
      corpo: { ...saida, instrucoesVersao: pedido.instrucoes, latenciaMs: Date.now() - inicio },
    };
  } catch (e) {
    if (deps.sinal?.aborted || (e as Error)?.name === 'AbortError') {
      return erro(499, 'cancelado', 'O pedido foi cancelado antes de o provedor responder.');
    }
    if (e instanceof ErroDeConversao) return erro(400, 'pedido_invalido', e.message);
    if (e instanceof ErroDeLentidao) return erro(504, 'provedor_lento', e.message);
    if (e instanceof RateLimitError) {
      return e.perDay
        ? erro(429, 'limite_do_provedor', 'A cota diária do provedor acabou. Ela reabre amanhã.')
        : erro(429, 'limite_do_provedor', 'O provedor pediu para esperar (cota por minuto).', true);
    }
    if (e instanceof OverloadedError) {
      return erro(503, 'provedor_sobrecarregado', 'O provedor está sobrecarregado agora.', true);
    }
    if (e instanceof ProviderError) return erro(502, 'falha_do_provedor', e.message);
    return erro(502, 'falha_do_provedor', (e as Error)?.message ?? 'Falha desconhecida.');
  }
}
