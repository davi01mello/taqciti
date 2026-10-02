/**
 * A tradução do acervo para o contrato que o ChatGPT exige de um conector.
 *
 * ── Por que existe um contrato separado ──────────────────────────────────
 *
 * A Claude lê as quatro ferramentas nomeadas (`buscar`, `listar`, `ler`,
 * `conteudo`) e entende o JSON que elas devolvem, porque a descrição de cada
 * uma explica o formato. O ChatGPT não: ele espera DUAS ferramentas com
 * nomes fixos, `search` e `fetch`, e campos com nomes fixos — e ignora o
 * resto.
 *
 * A documentação da OpenAI é explícita sobre as duas metades da resposta:
 *
 *   `search` → { results: [ { id, title, url } ] }
 *   `fetch`  → { id, title, text, url, metadata? }
 *
 * e as duas precisam vir DUAS VEZES: em `structuredContent` e, como string
 * JSON, dentro de `content`. Não é redundância nossa — é o que está escrito,
 * "para compatibilidade".
 *
 * Isto estava errado antes, e o comentário de `despacho.ts` era honesto ao
 * dizer que a convenção não tinha sido verificada: devolvíamos o formato de
 * `buscar` (`{itens: [...]}`) com os nomes do ChatGPT por cima. Os campos não
 * batiam com nada que ele procura.
 *
 * ── O `url`, e por que ele aponta para algo que existe ───────────────────
 *
 * O ChatGPT usa `url` para CITAR a fonte na resposta. Um item do acervo não
 * é uma página pública, então a tentação é mandar qualquer coisa — e o
 * resultado seria uma citação clicável que leva a lugar nenhum.
 *
 * Em vez disso, apontamos para `/item/<id>` deste mesmo servidor, que é uma
 * página real dizendo o que aquele item é e que ele pertence ao acervo
 * privado de alguém. Não revela conteúdo (não há autenticação ali, então não
 * PODE revelar), mas a citação deixa de ser um link quebrado.
 */
import type { Corpo, Envelope } from './ferramentas';

/** Um resultado de busca, nos nomes que o ChatGPT procura. */
export interface ResultadoDeBuscaChatGpt {
  id: string;
  title: string;
  url: string;
}

/** Um documento, nos nomes que o ChatGPT procura. */
export interface DocumentoChatGpt {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: Record<string, string>;
}

/**
 * O endereço de citação de um item.
 *
 * `origem` pode faltar quando o despacho é chamado fora de uma requisição
 * HTTP (nos testes, por exemplo). Nesse caso o caminho relativo é melhor que
 * uma URL inventada com um domínio que não é o nosso.
 */
export function urlDoItem(id: string, origem?: string): string {
  const caminho = `/item/${encodeURIComponent(id)}`;
  return origem ? `${origem}${caminho}` : caminho;
}

/** O que `buscar` devolve, só na parte que interessa aqui. */
interface BuscaBruta {
  itens?: readonly { id: string; titulo: string }[];
}

export function paraBuscaDoChatGpt(
  bruto: unknown,
  origem?: string,
): { results: ResultadoDeBuscaChatGpt[] } {
  const itens = (bruto as BuscaBruta)?.itens ?? [];
  return {
    results: itens.map((i) => ({
      id: i.id,
      title: i.titulo,
      url: urlDoItem(i.id, origem),
    })),
  };
}

/**
 * Junta envelope e primeira fatia num documento só.
 *
 * O `text` NÃO é o item inteiro, e isso é deliberado: o orçamento de
 * contexto vale para o ChatGPT tanto quanto para a Claude (ver
 * `orcamento.ts`). Quando há mais corpo do que coube, a última linha diz
 * como continuar — em português, porque quem lê é o modelo.
 */
export function paraDocumentoDoChatGpt(
  envelope: Envelope,
  corpo: Corpo,
  origem?: string,
): DocumentoChatGpt {
  const linhas = corpo.itens.map((p) => (p.autor ? `${p.autor}: ${p.texto}` : p.texto));

  const continuacao =
    corpo.proximo === undefined
      ? []
      : [
          '',
          `[Mostrando ${corpo.mostrando} de ${corpo.total} ${corpo.unidade}. ` +
            `Para o resto, chame \`conteudo\` com id="${envelope.id}" e de=${corpo.proximo}.]`,
        ];

  return {
    id: envelope.id,
    title: envelope.titulo,
    text: [...linhas, ...continuacao].join('\n'),
    url: urlDoItem(envelope.id, origem),
    metadata: {
      tipo: envelope.tipo,
      data: envelope.data,
      ...envelope.sobre,
    },
  };
}
