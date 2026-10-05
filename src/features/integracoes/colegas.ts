/**
 * Quem é do CITi numa reunião — a regra da cor das falas.
 *
 * "É do CITi" quer dizer: o e-mail termina em `@citi.org.br` ou num subdomínio
 * dele (`@sub.citi.org.br`). `@citibank.com` NÃO é: o que vale é o domínio
 * inteiro, nunca a palavra "citi" solta.
 *
 * ── De onde vem o e-mail ────────────────────────────────────────────────────
 *
 * O Meet entrega o NOME de quem fala, não o e-mail. O e-mail vem do diretório
 * do Google Workspace (`buscarNoDiretorio`), pelo nome: só conta quando o nome
 * do diretório é IGUAL ao do falante (sem acento e sem caixa) e o endereço é do
 * domínio. Nome parecido não basta — errar para "do CITi" pinta de verde quem
 * não é. Sem conta conectada o diretório não responde, e todo mundo fica como
 * "de fora" (a cor de sempre) sem nada quebrar.
 *
 * Quem já foi reconhecido fica guardado neste computador; quem NÃO foi achado
 * também, por um dia (o diretório muda, e a consulta tem custo).
 */
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal, writeLocal } from '@/shared/services/storage';
import { buscarNoDiretorio } from './diretorio';

export const DOMINIO_DO_CITI = 'citi.org.br';

/** O endereço é do CITi: o domínio, ou um subdomínio dele. */
export function ehEmailDoCiti(email: string): boolean {
  const dominio = email.trim().toLowerCase().split('@');
  if (dominio.length !== 2 || !dominio[0]) return false;
  const d = dominio[1]!;
  return d === DOMINIO_DO_CITI || d.endsWith(`.${DOMINIO_DO_CITI}`);
}

/** Minúsculas, sem acento, espaços colapsados: a chave do nome. */
export function chaveDoNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Como o falante aparece na tela. */
export type PapelDoFalante = 'eu' | 'citi' | 'externo';

export function papelDoFalante(
  nome: string,
  eu: string | null,
  colegas: ReadonlySet<string>,
): PapelDoFalante {
  const chave = chaveDoNome(nome);
  if (eu !== null && chave === chaveDoNome(eu)) return 'eu';
  return colegas.has(chave) ? 'citi' : 'externo';
}

// ------------------------------------------------------------------ o cache

const VALIDADE_DO_NAO_MS = 24 * 60 * 60 * 1000;

interface Entrada {
  citi: boolean;
  em: number;
}
type Cache = Record<string, Entrada>;

async function lerCache(): Promise<Cache> {
  try {
    const bruto = await readLocal<unknown>(STORAGE_KEYS.colegasDoCiti);
    return bruto && typeof bruto === 'object' ? (bruto as Cache) : {};
  } catch {
    return {};
  }
}

function vale(e: Entrada | undefined, agora: number): e is Entrada {
  return !!e && (e.citi || agora - e.em < VALIDADE_DO_NAO_MS);
}

/** Dos nomes dados, os que já estão reconhecidos como do CITi (só o cache). */
export async function colegasConhecidos(nomes: readonly string[]): Promise<Set<string>> {
  const cache = await lerCache();
  const achados = new Set<string>();
  for (const n of nomes) {
    const k = chaveDoNome(n);
    if (cache[k]?.citi) achados.add(k);
  }
  return achados;
}

/**
 * Consulta o diretório pelos nomes que o cache ainda não resolve e devolve o
 * conjunto de quem é do CITi. Falha de rede ou conta desconectada: devolve só o
 * que o cache já sabia, e não guarda "não" — não foi achado, foi impossível
 * perguntar.
 */
export async function reconhecerColegas(
  nomes: readonly string[],
  agora: number = Date.now(),
  buscar: typeof buscarNoDiretorio = buscarNoDiretorio,
): Promise<Set<string>> {
  const cache = await lerCache();
  const pendentes = new Map<string, string>();
  for (const n of nomes) {
    const k = chaveDoNome(n);
    if (k && k !== 'alguem' && k !== 'falante' && !vale(cache[k], agora)) pendentes.set(k, n);
  }

  let mudou = false;
  for (const [k, nome] of pendentes) {
    try {
      const pessoas = await buscar(nome, 5);
      const citi = pessoas.some((p) => chaveDoNome(p.nome) === k && ehEmailDoCiti(p.email));
      cache[k] = { citi, em: agora };
      mudou = true;
    } catch {
      // Sem conexão com o Google: não dá para saber agora. Para de insistir.
      break;
    }
  }
  if (mudou) await writeLocal(STORAGE_KEYS.colegasDoCiti, cache).catch(() => undefined);

  const achados = new Set<string>();
  for (const n of nomes) {
    const k = chaveDoNome(n);
    if (cache[k]?.citi) achados.add(k);
  }
  return achados;
}
