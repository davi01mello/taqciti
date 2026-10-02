/**
 * Qual provedor e qual modelo o Taq usa — e o que falta para ele funcionar.
 *
 * ── Separado de `lib/ai/config.ts`, de propósito ────────────────────────────
 *
 * A camada de IA existente serve ao pipeline de geração (Pensante, Auditor,
 * Escritor), e tem uma regra que aqui seria errada: fora de produção, sem
 * chave, ela cai no MOCK. Para gerar documento em desenvolvimento isso é
 * conveniência; para um assistente de conversa é resposta inventada com cara de
 * resposta real. O Taq nunca cai no mock — sem chave, o estado é
 * `configuracao_pendente` e a interface diz isso antes de a pessoa escrever.
 *
 * O que É reaproveitado: o formato `provedor:modelo` (`parseOverride`), o nome
 * da variável da chave por provedor e a política de dados da chave.
 *
 * ── Dois provedores, por enquanto ────────────────────────────────────────────
 *
 * Google (`gemini.ts`) e, temporariamente, Groq (`groq.ts`) têm adaptador com
 * ferramentas. Escolher outro provedor em `TAQ_ORQUESTRADOR` não é erro de
 * sintaxe: é uma pendência, dita como tal.
 *
 * O modelo padrão foi conferido na lista de modelos da chave configurada em
 * 2026-09-22 (`models.list`): `gemini-3.5-flash` está disponível e é o mesmo que
 * o pipeline já usa no Pensante.
 */
import { API_KEY_ENV_VAR } from '@/lib/ai/availability';
import { parseOverride } from '@/lib/ai/config';
import type { ProviderId } from '@/lib/ai/types';
import type { EstadoDoTaq } from './contrato';
import { VERSAO_DAS_INSTRUCOES } from './instrucoes';

export const VARIAVEL_DO_MODELO = 'TAQ_ORQUESTRADOR';
export const PADRAO = 'google:gemini-3.5-flash';

/**
 * `groq` é do Taq só, e temporário (ver `groq.ts`): não é um `ProviderId` do
 * pipeline, então é lido aqui antes de `parseOverride`.
 */
export type ProvedorDoTaq = ProviderId | 'groq';

/** Provedores com adaptador de ferramentas implementado, e a variável da chave de cada um. */
const CHAVE_DO_ADAPTADOR: Partial<Record<ProvedorDoTaq, string>> = {
  google: API_KEY_ENV_VAR.google,
  groq: 'GROQ_API_KEY',
};

export interface ConfiguracaoDoTaq {
  provedor: ProvedorDoTaq | null;
  modelo: string | null;
  politicaDeDados: 'private' | 'training';
  pendencias: string[];
}

/** Pura sobre `env`: é o que deixa os testes dizerem qualquer cenário. */
export function resolverConfiguracao(env: NodeJS.ProcessEnv = process.env): ConfiguracaoDoTaq {
  const politicaDeDados = env.DOCCITI_DATA_POLICY?.trim() === 'training' ? 'training' : 'private';
  const bruto = env[VARIAVEL_DO_MODELO]?.trim() || PADRAO;

  let provedor: ProvedorDoTaq;
  let modelo: string;
  try {
    if (bruto.startsWith('groq:')) {
      provedor = 'groq';
      modelo = bruto.slice('groq:'.length).trim();
      if (!modelo) throw new Error(`${VARIAVEL_DO_MODELO}="${bruto}": o modelo está vazio.`);
    } else {
      ({ provider: provedor, model: modelo } = parseOverride(bruto, VARIAVEL_DO_MODELO));
    }
  } catch (error) {
    return {
      provedor: null,
      modelo: null,
      politicaDeDados,
      pendencias: [(error as Error).message],
    };
  }

  const pendencias: string[] = [];
  const variavel = CHAVE_DO_ADAPTADOR[provedor];
  if (!variavel) {
    pendencias.push(
      `O provedor "${provedor}" ainda não tem adaptador com ferramentas para o Taq. ` +
        `Use ${VARIAVEL_DO_MODELO}=google:<modelo> ou groq:<modelo>.`,
    );
  } else {
    if (!env[variavel]?.trim()) {
      pendencias.push(`Falta ${variavel} no servidor (server/.env.local ou variáveis da Vercel).`);
    }
  }
  return { provedor, modelo, politicaDeDados, pendencias };
}

export function estadoPublico(config: ConfiguracaoDoTaq): EstadoDoTaq {
  return {
    pronto: config.pendencias.length === 0,
    provedor: config.provedor,
    modelo: config.modelo,
    instrucoesVersao: VERSAO_DAS_INSTRUCOES,
    politicaDeDados: config.politicaDeDados,
    pendencias: config.pendencias,
  };
}
