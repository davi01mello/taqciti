/**
 * Os especialistas IMPLEMENTADOS: `documents` e `app_assistant`.
 *
 * Os dois são o mesmo ciclo do runtime (`executarCiclo`) com instruções
 * próprias, versionadas no servidor (`server/lib/prompts/taq/`), e com as
 * ferramentas que o catálogo declara para eles. Nada de infraestrutura nova:
 * entram pela mesma porta que qualquer especialista futuro (`ativar`).
 *
 * O que eles recebem da execução principal:
 *   - o histórico da conversa (para entender "essa reunião", "o segundo");
 *   - o pedido LITERAL da pessoa, no contexto — o `objetivo` da delegação é
 *     escrito pelo modelo, e as regras que dependem do que a pessoa disse
 *     leem `tarefa.pedidoOriginal`, nunca o objetivo;
 *   - o escopo, os efeitos, o orçamento e o livro de evidências da execução.
 */
import { montarContextoInicial } from './contexto';
import type { RegistroDeAgentes } from './registroDeAgentes';
import { executarCiclo } from './runtime';
import type { ExecutorDeAgente } from './tipos';

export const INSTRUCOES_DOCUMENTOS = 'documents-v2';
export const INSTRUCOES_APP = 'app-assistant-v4';

function executorDeModelo(instrucoes: string): ExecutorDeAgente {
  return async (tarefa, ambiente) => {
    const contexto =
      (await montarContextoInicial(tarefa, ambiente.armazenamento)) +
      `\n\nPedido literal da pessoa nesta mensagem: "${tarefa.pedidoOriginal.slice(0, 1_000)}"`;
    return executarCiclo(tarefa, ambiente, {
      instrucoes,
      contexto,
      historico: ambiente.historico,
    });
  };
}

/** Liga os especialistas implementados num registro que já os tem catalogados. */
export function ativarEspecialistas(agentes: RegistroDeAgentes): RegistroDeAgentes {
  agentes.ativar(
    'documents',
    executorDeModelo(INSTRUCOES_DOCUMENTOS),
    INSTRUCOES_DOCUMENTOS,
  );
  agentes.ativar('app_assistant', executorDeModelo(INSTRUCOES_APP), INSTRUCOES_APP);
  return agentes;
}
