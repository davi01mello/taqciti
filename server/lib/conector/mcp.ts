/**
 * A ponte entre o protocolo MCP e o despacho que já existe.
 *
 * ── Por que a classe `Server`, e não `McpServer` ─────────────────────────
 *
 * O SDK tem duas camadas. `McpServer` é a de conveniência: você registra
 * ferramentas com esquemas Zod e ele monta o catálogo. `Server` é a de
 * baixo: você atende `tools/list` e `tools/call` você mesmo.
 *
 * Aqui a de baixo é a certa, porque o catálogo já existe — `despacho.ts` tem
 * as definições em JSON Schema e o roteador, ambos testados e independentes
 * de protocolo. Passar por `McpServer` exigiria reescrever aqueles esquemas
 * em Zod só para o SDK os converter de volta em JSON Schema, criando uma
 * segunda descrição das mesmas ferramentas — duas descrições divergem, e a
 * que diverge é sempre a que ninguém está olhando.
 *
 * ── Erro de uso não é erro de protocolo ──────────────────────────────────
 *
 * Um id inventado pelo modelo vira `isError: true` com a mensagem dentro do
 * RESULTADO, não um erro JSON-RPC. A diferença importa: o resultado com erro
 * chega ao modelo como conteúdo, ele lê "o formato é tipo:id" e corrige na
 * chamada seguinte. Um erro de protocolo ele não lê — a chamada só falha.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { FERRAMENTAS, despachar } from './despacho';
import { ErroDeUso } from './ferramentas';
import type { Acervo } from './tipos';

/** A versão anunciada ao cliente. Acompanha a do `package.json` da extensão. */
const VERSAO = '2.1.2';

/**
 * Os dois nomes cuja resposta o ChatGPT lê por `structuredContent`.
 * Ver `chatgpt.ts` para o contrato.
 */
const DO_CHATGPT = new Set(['search', 'fetch']);

export function construirServidorMcp(
  acervo: Acervo,
  /** A origem HTTP, para o `url` de citação. Ausente fora de uma requisição. */
  origem?: string,
): Server {
  const servidor = new Server(
    { name: 'taqciti', version: VERSAO },
    {
      capabilities: { tools: {} },
      // O que o cliente lê antes de chamar qualquer coisa. Vale a pena: é a
      // única chance de ensinar a escada ANTES de o modelo inventar o
      // próprio caminho, e um modelo que começa por `listar` gasta muito
      // mais contexto do que um que começa por `buscar`.
      instructions:
        'Acervo do TaqCiti: reuniões transcritas, documentos gerados, conversas e notas ' +
        'de quem conectou este servidor.\n\n' +
        'Use nesta ordem: `buscar` para achar (devolve trechos curtos com a POSIÇÃO do ' +
        'acerto), depois `conteudo` com `de` = essa posição para ler só o pedaço certo. ' +
        '`ler` mostra os metadados de um item sem o corpo. `listar` enumera sem conteúdo ' +
        'nenhum.\n\n' +
        'Nenhuma ferramenta devolve um item inteiro: as respostas são fatiadas e trazem ' +
        '`total`, `mostrando` e `proximo`. Para continuar, chame de novo com `de` = ' +
        '`proximo`. Peça só a faixa de que precisa — pedir tudo não é possível, e ' +
        'páginas desnecessárias só gastam a janela de contexto.',
    },
  );

  servidor.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: FERRAMENTAS.map((f) => ({
      name: f.name,
      description: f.description,
      inputSchema: f.inputSchema as { type: 'object' },
    })),
  }));

  servidor.setRequestHandler(CallToolRequestSchema, async (pedido) => {
    const { name, arguments: argumentos } = pedido.params;
    try {
      const resultado = await despachar(acervo, name, argumentos ?? {}, origem);
      return {
        // Para as quatro ferramentas nomeadas: texto com JSON, que é o
        // formato que todo cliente de MCP entende, e o conteúdo já é
        // compacto por construção (ver `orcamento.ts`).
        //
        // Para `search` e `fetch`: TAMBÉM `structuredContent`. A documentação
        // da OpenAI exige as duas metades — a estruturada é a que ele lê, a
        // de texto existe "para compatibilidade". Mandar só uma faz o
        // conector aparecer conectado e não devolver nada.
        ...(DO_CHATGPT.has(name)
          ? { structuredContent: resultado as Record<string, unknown> }
          : {}),
        content: [{ type: 'text' as const, text: JSON.stringify(resultado) }],
      };
    } catch (erro) {
      if (erro instanceof ErroDeUso) {
        return {
          content: [{ type: 'text' as const, text: erro.message }],
          isError: true,
        };
      }
      // Erro de verdade: registra aqui e devolve algo que não vaze detalhe de
      // implementação para dentro da conversa de alguém.
      console.error(`[mcp] falha em ${name}`, erro);
      return {
        content: [
          { type: 'text' as const, text: 'Falha ao consultar o acervo. Tente de novo.' },
        ],
        isError: true,
      };
    }
  });

  return servidor;
}
