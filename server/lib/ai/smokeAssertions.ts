/**
 * As asserções que rodam SOBRE um 200 do provedor.
 *
 * Existem porque forma de payload aceita e `usage` lido corretamente são
 * duas provas diferentes, e só a primeira vem de graça no 200. Um adaptador
 * com normalização de `usage` errada responde 200 normalmente e reporta
 * custo zero: o defeito só apareceria quando o harness dissesse que uma
 * geração completa custou nada — ou pior, não apareceria.
 *
 * Vivem aqui, e não dentro do route handler, para poderem ser testadas. Uma
 * verificação que ninguém verifica é a mesma classe de problema que ela
 * existe para pegar.
 */
import { estimateCost } from './pricing';
import type { CompletionResult } from './types';

export function assertUsable(result: CompletionResult, expectParsed: boolean): string[] {
  const failures: string[] = [];
  const { inputTokens, outputTokens } = result.usage;

  if (typeof inputTokens !== 'number' || !Number.isFinite(inputTokens) || inputTokens <= 0) {
    failures.push(
      `usage.inputTokens veio ${JSON.stringify(inputTokens)}. Toda requisição tem entrada — ` +
        'zero ou ausente aqui significa normalização de usage errada no adaptador, ' +
        'e custo zero no relatório do harness.',
    );
  }

  if (typeof outputTokens !== 'number' || !Number.isFinite(outputTokens) || outputTokens <= 0) {
    failures.push(
      `usage.outputTokens veio ${JSON.stringify(outputTokens)}, mas o provedor devolveu texto.`,
    );
  }

  if (result.text.trim().length === 0) {
    failures.push('o provedor respondeu 200 com texto vazio.');
  }

  if (expectParsed && result.parsed === undefined) {
    failures.push('jsonSchema foi pedido mas `parsed` veio vazio.');
  }

  if (!estimateCost(result.meta.provider, result.meta.model, result.usage)) {
    failures.push(
      `modelo ${result.meta.model} não está na tabela de preços — o custo sairia undefined.`,
    );
  }

  return failures;
}
