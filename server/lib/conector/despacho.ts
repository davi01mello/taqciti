/**
 * O catálogo de ferramentas e o roteador — a fronteira entre "o que o
 * conector faz" e "por qual protocolo ele é chamado".
 *
 * ── Por que isto não mora na rota ─────────────────────────────────────────
 *
 * Porque o transporte vai mudar e o contrato não. MCP sobre HTTP é o alvo
 * hoje; amanhã pode ser stdio para uma instalação local, ou uma chamada
 * direta de dentro da própria HOME. `despachar` é uma função pura de
 * (acervo, nome, argumentos) → resultado, e é ela que os testes exercitam.
 * A rota vira o que deve ser: desempacota JSON-RPC, resolve QUEM está
 * perguntando, chama isto, empacota de volta.
 *
 * ── Sobre `search` e `fetch` ──────────────────────────────────────────────
 *
 * As quatro ferramentas de verdade têm nomes em português, como o resto do
 * projeto. `search` e `fetch` existem ao lado delas porque o conector de
 * pesquisa profunda do ChatGPT espera esses dois nomes especificamente — é
 * uma convenção do lado dele, não um desenho nosso.
 *
 * O contrato dessas duas (nomes dos campos, e a resposta precisando vir tanto
 * em `structuredContent` quanto como string JSON em `content`) está
 * implementado em `chatgpt.ts`, conforme a documentação da OpenAI. Ele é
 * diferente do formato das quatro nomeadas, e por isso mora num arquivo só
 * dele em vez de espalhado aqui.
 *
 * Elas não atrapalham a Claude, que usa as quatro nomeadas e ignora estas.
 */
import { ORCAMENTO } from './orcamento';
import { paraBuscaDoChatGpt, paraDocumentoDoChatGpt } from './chatgpt';
import {
  DESCRICOES,
  ErroDeUso,
  ferramentaBuscar,
  ferramentaConteudo,
  ferramentaLer,
  ferramentaListar,
} from './ferramentas';
import type { Acervo } from './tipos';
import { TIPOS_DE_ITEM } from './tipos';

/** Uma ferramenta como o MCP a descreve. */
export interface DefinicaoDeFerramenta {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const ESQUEMA_TIPO = {
  type: 'string',
  enum: [...TIPOS_DE_ITEM],
  description: 'A coleção: reuniao, documento, conversa ou nota.',
} as const;

export const FERRAMENTAS: readonly DefinicaoDeFerramenta[] = [
  {
    name: 'buscar',
    description: DESCRICOES.buscar,
    inputSchema: {
      type: 'object',
      properties: {
        consulta: {
          type: 'string',
          description: 'Palavras a procurar. Casa por prefixo e ignora acentos.',
        },
        tipos: {
          type: 'array',
          items: ESQUEMA_TIPO,
          description: 'Restringe a busca a estas coleções. Ausente = todas.',
        },
        limite: {
          type: 'integer',
          minimum: 1,
          maximum: ORCAMENTO.hits,
          description: `Máximo de resultados (teto ${ORCAMENTO.hits}).`,
        },
      },
      required: ['consulta'],
      additionalProperties: false,
    },
  },
  {
    name: 'listar',
    description: DESCRICOES.listar,
    inputSchema: {
      type: 'object',
      properties: {
        tipo: ESQUEMA_TIPO,
        de: {
          type: 'integer',
          minimum: 0,
          description: 'Índice inicial. Use o `proximo` da resposta anterior.',
        },
        quantidade: {
          type: 'integer',
          minimum: 1,
          maximum: ORCAMENTO.pagina,
          description: `Quantos itens (teto ${ORCAMENTO.pagina}).`,
        },
      },
      required: ['tipo'],
      additionalProperties: false,
    },
  },
  {
    name: 'ler',
    description: DESCRICOES.ler,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'O id composto, no formato "tipo:id" — ex.: "reuniao:abc-123".',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'conteudo',
    description: DESCRICOES.conteudo,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'O id composto, "tipo:id".' },
        de: {
          type: 'integer',
          minimum: 0,
          description:
            'Onde começar: índice da fala/mensagem, ou deslocamento em caracteres. ' +
            'Use a `posicao` de um resultado de `buscar`, ou o `proximo` da fatia anterior.',
        },
        quantidade: {
          type: 'integer',
          minimum: 1,
          description:
            `Quantas falas/mensagens (teto ${ORCAMENTO.falas}). Ignorado em ` +
            'documentos e notas, que fatiam por caractere.',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  // ---- Compatibilidade com o ChatGPT. Ver o cabeçalho do arquivo. ----
  {
    name: 'search',
    description:
      'Procura no acervo e devolve `results` com `id`, `title` e `url`. Alias de ' +
      `\`buscar\` no formato que o ChatGPT espera. ${DESCRICOES.buscar}`,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'fetch',
    description:
      'Traz um item pelo `id` devolvido por `search`, com `title`, `text` e `url`. ' +
      'O `text` é o começo do corpo, não o item inteiro: quando há mais, a última ' +
      'linha diz como continuar com `conteudo`.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

/**
 * Lê um argumento sem confiar nele.
 *
 * Os argumentos vêm de um modelo de linguagem: `limite: "12"` (string),
 * `de: -3`, `tipos: "reuniao"` (sem o array) são todos casos comuns, e
 * nenhum deles pode virar exceção — vira `ErroDeUso`, que o modelo lê e
 * corrige, ou é normalizado quando a intenção é óbvia.
 */
function texto(args: Record<string, unknown>, chave: string): string | undefined {
  const v = args[chave];
  return typeof v === 'string' ? v : undefined;
}

function inteiro(args: Record<string, unknown>, chave: string): number | undefined {
  const v = args[chave];
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.trunc(v));
  // `"12"` em vez de `12` é frequente o bastante para valer aceitar.
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number.parseInt(v, 10);
  return undefined;
}

function listaDeTexto(args: Record<string, unknown>, chave: string): string[] | undefined {
  const v = args[chave];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  // Um tipo só, sem o array. A intenção é inequívoca.
  if (typeof v === 'string') return [v];
  return undefined;
}

function exigirId(args: Record<string, unknown>): string {
  const id = texto(args, 'id');
  if (!id) {
    throw new ErroDeUso(
      'Informe `id`, no formato "tipo:id" — ex.: "reuniao:abc-123". ' +
        'Use `buscar` ou `listar` para obter ids reais.',
    );
  }
  return id;
}

export const NOMES_DE_FERRAMENTA = FERRAMENTAS.map((f) => f.name);

/**
 * Roteia uma chamada. Lança `ErroDeUso` para tudo que o chamador pode
 * consertar — inclusive nome de ferramenta inexistente.
 */
export async function despachar(
  acervo: Acervo,
  nome: string,
  argumentos: Record<string, unknown> = {},
  /** A origem HTTP, só para montar o `url` de citação do ChatGPT. */
  origem?: string,
): Promise<unknown> {
  switch (nome) {
    case 'buscar':
      return ferramentaBuscar(acervo, {
        consulta: texto(argumentos, 'consulta') ?? '',
        tipos: listaDeTexto(argumentos, 'tipos'),
        limite: inteiro(argumentos, 'limite'),
      });

    case 'listar':
      return ferramentaListar(acervo, {
        tipo: texto(argumentos, 'tipo') ?? '',
        de: inteiro(argumentos, 'de'),
        quantidade: inteiro(argumentos, 'quantidade'),
      });

    case 'ler':
      return ferramentaLer(acervo, exigirId(argumentos));

    case 'conteudo':
      return ferramentaConteudo(acervo, {
        id: exigirId(argumentos),
        de: inteiro(argumentos, 'de'),
        quantidade: inteiro(argumentos, 'quantidade'),
      });

    // ---- Os dois nomes que o ChatGPT exige. Ver `chatgpt.ts`. ----
    case 'search':
      return paraBuscaDoChatGpt(
        await ferramentaBuscar(acervo, {
          consulta: texto(argumentos, 'query') ?? texto(argumentos, 'consulta') ?? '',
        }),
        origem,
      );

    case 'fetch': {
      // Envelope + primeira fatia. O cliente que usa `fetch` espera "o
      // documento", e devolver só o envelope o deixaria sem conteúdo nenhum;
      // devolver o corpo inteiro é o que o orçamento proíbe. A primeira fatia
      // com a instrução de continuar é a resposta honesta às duas coisas.
      const id = exigirId(argumentos);
      const [envelope, corpo] = await Promise.all([
        ferramentaLer(acervo, id),
        ferramentaConteudo(acervo, { id, de: 0 }),
      ]);
      return paraDocumentoDoChatGpt(envelope, corpo, origem);
    }

    default:
      throw new ErroDeUso(
        `Ferramenta \`${nome}\` não existe. As disponíveis são: ${NOMES_DE_FERRAMENTA.join(', ')}.`,
      );
  }
}
