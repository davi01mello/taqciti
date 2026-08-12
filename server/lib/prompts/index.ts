/**
 * Carregador de prompts. Nenhum prompt de agente vive como string dentro do
 * código do agente.
 *
 * Quatro regras, todas com consequência prática:
 *
 * 1. **Neutros quanto ao provedor.** Nada de "você é o Claude", nenhuma
 *    convenção de formatação de um fornecedor. O mesmo texto roda nos três —
 *    é a condição para a comparação da Fase 8 significar alguma coisa. Há
 *    teste garantindo.
 * 2. **Versionados.** `v1.md`, `v2.md`. Versão nova é arquivo novo, nunca
 *    edição no lugar: o resultado do harness fica atrelado à versão do prompt,
 *    e editar no lugar apagaria a base de comparação.
 * 3. **Sem regra de negócio duplicada.** As regras da Ata vivem no `guidance`
 *    do `SectionSpec`. O prompt do Pensante INTERPOLA esse campo, não o
 *    reescreve — regra em dois lugares diverge.
 * 4. **Formato de saída declarado por schema**, não por prosa. O prompt
 *    descreve a tarefa; o `jsonSchema` descreve a forma.
 *
 * A interpolação acontece só aqui.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PromptAgent = 'analista' | 'pensante' | 'auditor' | 'escritor';
export type PromptVersion = `v${number}`;

/** Cache por arquivo. Prompt não muda em runtime; ler a cada chamada seria
 *  I/O de disco em toda seção de todo documento. */
const cache = new Map<string, string>();

/**
 * Caminho a partir de `process.cwd()`, que no servidor Next é `server/`.
 *
 * Deliberadamente `fs` em vez de `import`: o arquivo precisa ser legível como
 * TEXTO e versionável como texto, e transformar `.md` em módulo exigiria
 * plugin de bundler — o que amarraria os prompts à ferramenta de build. O
 * preço é que uma build `output: 'standalone'` precisará copiar
 * `lib/prompts/` explicitamente; está anotado aqui para não ser descoberto
 * em produção.
 */
function pathFor(agent: PromptAgent, version: PromptVersion): string {
  return join(process.cwd(), 'lib', 'prompts', agent, `${version}.md`);
}

export function loadPromptTemplate(agent: PromptAgent, version: PromptVersion): string {
  const key = `${agent}/${version}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let raw: string;
  try {
    raw = readFileSync(pathFor(agent, version), 'utf8');
  } catch (error) {
    throw new Error(
      `Prompt ${key} não encontrado em ${pathFor(agent, version)}. ` +
        `Causa: ${(error as Error).message}`,
    );
  }
  cache.set(key, raw);
  return raw;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Substitui `{{marcador}}` pelos valores dados.
 *
 * Falha alto quando sobra marcador sem valor. O contrário — deixar passar —
 * mandaria a string literal `{{sectionGuidance}}` para o modelo, que
 * responderia alguma coisa plausível sobre um texto que nunca recebeu. É o
 * tipo de defeito que só aparece na revisão do documento final.
 */
export function interpolate(
  template: string,
  values: Record<string, string>,
  label = 'prompt',
): string {
  const missing = new Set<string>();

  const result = template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      missing.add(name);
      return '';
    }
    return value;
  });

  if (missing.size > 0) {
    throw new Error(
      `${label}: marcador sem valor — ${[...missing].map((n) => `{{${n}}}`).join(', ')}.`,
    );
  }

  return result.trim();
}

/** Carrega e interpola numa passada. */
export function renderPrompt(
  agent: PromptAgent,
  version: PromptVersion,
  values: Record<string, string> = {},
): string {
  return interpolate(loadPromptTemplate(agent, version), values, `${agent}/${version}`);
}

/** Só para teste: esquecer o cache entre casos. */
export function clearPromptCache(): void {
  cache.clear();
}
