/**
 * O diretório da organização — quem são os colegas, e o endereço verdadeiro deles.
 *
 * Fonte: People API, `people:searchDirectoryPeople`, que devolve só o que o
 * Google Workspace do CITi expõe a qualquer membro do domínio (perfis e
 * contatos do domínio). Não há diretório inventado: sem a conta de organização
 * conectada, a capacidade nem é oferecida (`estado.ts`).
 *
 * "Mesma organização" é verificado AQUI, em código: só entra no resultado um
 * endereço do domínio da conta conectada. O que o Google devolver de fora
 * (contato externo no diretório) é descartado.
 */
import { ESCOPO_DIRETORIO } from './escopos';
import { chamarGoogle } from './google';
import { lerConexao } from './estado';
import { ErroDeIntegracao } from './erros';

export interface PessoaDoDiretorio {
  nome: string;
  email: string;
}

interface RespostaDePessoas {
  people?: Array<{
    names?: Array<{ displayName?: string }>;
    emailAddresses?: Array<{ value?: string; metadata?: { primary?: boolean } }>;
  }>;
}

const URL_BUSCA = 'https://people.googleapis.com/v1/people:searchDirectoryPeople';

export async function buscarNoDiretorio(consulta: string, limite = 8): Promise<PessoaDoDiretorio[]> {
  const termo = consulta.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!termo) return [];
  const conexao = await lerConexao();
  if (!conexao?.dominio)
    throw new ErroDeIntegracao('conta_pessoal', 'Não há diretório: a conta conectada não é de uma organização.');

  const url = new URL(URL_BUSCA);
  url.searchParams.set('query', termo);
  url.searchParams.set('readMask', 'names,emailAddresses');
  url.searchParams.append('sources', 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE');
  url.searchParams.append('sources', 'DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT');
  url.searchParams.set('pageSize', String(Math.min(Math.max(limite, 1), 20)));

  const { dados } = await chamarGoogle<RespostaDePessoas>({
    url: url.toString(),
    escopos: [ESCOPO_DIRETORIO],
  });

  const vistos = new Set<string>();
  const pessoas: PessoaDoDiretorio[] = [];
  for (const p of dados.people ?? []) {
    const nome = p.names?.[0]?.displayName?.trim();
    const enderecos = (p.emailAddresses ?? []).map((e) => (e.value ?? '').trim().toLowerCase());
    // O primário do domínio, ou o primeiro endereço do domínio.
    const email = enderecos.find((e) => e.endsWith(`@${conexao.dominio}`));
    if (!nome || !email || vistos.has(email)) continue;
    vistos.add(email);
    pessoas.push({ nome, email });
  }
  return pessoas.slice(0, limite);
}

/** O endereço pertence ao domínio da conta conectada? */
export async function ehDaOrganizacao(email: string): Promise<boolean> {
  const conexao = await lerConexao();
  return !!conexao?.dominio && email.toLowerCase().endsWith(`@${conexao.dominio}`);
}
