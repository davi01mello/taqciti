/**
 * Quais entradas da matriz dá para rodar agora, e por que as outras não.
 *
 * Existe por causa de uma regra só: **nunca omitir em silêncio.** Uma tabela
 * comparativa sem a linha da Anthropic parece completa e não é — quem lê
 * conclui que o Gemini ganhou, quando na verdade a Anthropic nem correu.
 * Entrada pulada continua aparecendo no relatório, com o motivo; e quando
 * TODAS as entradas de um fornecedor são puladas, isso vira uma linha
 * própria, porque "o fornecedor inteiro ficou de fora" é uma informação
 * diferente de "três configurações ficaram de fora".
 *
 * O harness da Fase 8 consome isto. A rota de fumaça também, para que o
 * comportamento esteja exercitado antes do harness existir.
 */
import { COMPARISON_MATRIX, type MatrixEntry } from './config';
import { PROVIDER_IDS, type ProviderId } from './types';

export const API_KEY_ENV_VAR: Record<ProviderId, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  xai: 'XAI_API_KEY',
};

export function hasApiKey(provider: ProviderId): boolean {
  return Boolean(process.env[API_KEY_ENV_VAR[provider]]?.trim());
}

export interface SkippedEntry {
  entry: MatrixEntry;
  reason: string;
}

export interface SkippedProvider {
  provider: ProviderId;
  reason: string;
  /** Ids das entradas que ficaram de fora junto com o fornecedor. */
  entryIds: string[];
}

export interface RunPlan {
  runnable: MatrixEntry[];
  skipped: SkippedEntry[];
  /** Fornecedores cujas entradas foram TODAS puladas. */
  skippedProviders: SkippedProvider[];
}

function missingKeyReason(provider: ProviderId): string {
  return `${API_KEY_ENV_VAR[provider]} não está definida — configuração não executada.`;
}

/**
 * Divide as entradas em executáveis e puladas. Não faz chamada nenhuma: é
 * planejamento, e o relatório precisa saber o que vai ficar de fora antes de
 * gastar o primeiro token.
 */
export function planMatrixRun(entries: MatrixEntry[] = COMPARISON_MATRIX): RunPlan {
  const runnable: MatrixEntry[] = [];
  const skipped: SkippedEntry[] = [];

  for (const entry of entries) {
    if (hasApiKey(entry.provider)) runnable.push(entry);
    else skipped.push({ entry, reason: missingKeyReason(entry.provider) });
  }

  const skippedProviders: SkippedProvider[] = [];
  for (const provider of PROVIDER_IDS) {
    const doProvider = entries.filter((entry) => entry.provider === provider);
    if (doProvider.length === 0) continue;
    const todasPuladas = doProvider.every((entry) => !hasApiKey(entry.provider));
    if (todasPuladas) {
      skippedProviders.push({
        provider,
        reason: missingKeyReason(provider),
        entryIds: doProvider.map((entry) => entry.id),
      });
    }
  }

  return { runnable, skipped, skippedProviders };
}

/**
 * Resumo em texto para o topo do relatório. Devolve `null` quando não houve
 * pulo — assim quem imprime não precisa decidir se tem algo a dizer.
 */
export function describeSkips(plan: RunPlan): string | null {
  if (plan.skipped.length === 0) return null;

  const linhas: string[] = [];
  for (const { provider, entryIds, reason } of plan.skippedProviders) {
    linhas.push(`FORNECEDOR ${provider.toUpperCase()} INTEIRO fora: ${reason} (${entryIds.length} configurações: ${entryIds.join(', ')})`);
  }

  const idsDeFornecedorInteiro = new Set(
    plan.skippedProviders.flatMap((item) => item.entryIds),
  );
  for (const { entry, reason } of plan.skipped) {
    if (idsDeFornecedorInteiro.has(entry.id)) continue;
    linhas.push(`configuração ${entry.id} fora: ${reason}`);
  }

  return linhas.join('\n');
}
