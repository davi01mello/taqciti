/**
 * O REGISTRO de uma execução do Taq — o que fica gravado depois que ela acaba.
 *
 * Responde "o que o assistente fez?" sem guardar o que ele leu: ids, estado,
 * duração, a sequência de ferramentas com o resultado resumido em uma linha
 * ("3 resultados", "documento criado"), as falhas, e o consumo que o provedor
 * informou. NÃO guarda: trecho de transcrição, texto de documento, a pergunta,
 * a resposta (essas já estão na conversa, que é o lugar delas), a continuação
 * opaca do provedor, nem segredo algum.
 */
import { z } from 'zod/v4';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { readLocal } from '@/shared/services/storage';
import type { ResultadoDoAgente, Tarefa } from './contratos';
import type { EventoDeExecucao } from './tipos';

export const registroDeExecucaoSchema = z.object({
  id: z.string(),
  conversaId: z.string(),
  agenteId: z.string(),
  iniciadaEm: z.number(),
  duracaoMs: z.number(),
  estado: z.string(),
  provedor: z.string().optional(),
  modelo: z.string().optional(),
  instrucoesVersao: z.string().optional(),
  uso: z.object({ entrada: z.number(), saida: z.number() }),
  passos: z.number(),
  ferramentas: z.array(
    z.object({
      tarefaId: z.string(),
      nome: z.string(),
      ok: z.boolean(),
      codigoDeErro: z.string().optional(),
      duracaoMs: z.number(),
      resumo: z.string(),
    }),
  ),
  delegacoes: z.array(
    z.object({ tarefaId: z.string(), agenteId: z.string(), estado: z.string() }),
  ),
  erros: z.array(z.object({ codigo: z.string(), mensagem: z.string() })),
  documentos: z.array(z.object({ id: z.string(), acao: z.string() })),
  referenciasCitadas: z.number(),
});
export type RegistroDeExecucao = z.infer<typeof registroDeExecucaoSchema>;

export function montarRegistro(
  tarefa: Tarefa,
  iniciadaEm: number,
  resultado: ResultadoDoAgente,
  eventos: readonly EventoDeExecucao[],
  usoTotal: { entrada: number; saida: number },
  passosTotais: number,
): RegistroDeExecucao {
  const ferramentas: RegistroDeExecucao['ferramentas'] = [];
  const delegacoes: RegistroDeExecucao['delegacoes'] = [];
  for (const e of eventos) {
    if (e.tipo === 'ferramenta_fim') {
      ferramentas.push({
        tarefaId: e.tarefaId,
        nome: e.nome,
        ok: e.ok,
        ...(e.codigoDeErro ? { codigoDeErro: e.codigoDeErro } : {}),
        duracaoMs: e.duracaoMs,
        resumo: e.resumo,
      });
    } else if (e.tipo === 'delegacao' && e.estado !== 'iniciada') {
      delegacoes.push({ tarefaId: e.tarefaId, agenteId: e.agenteId, estado: e.estado });
    }
  }
  const { provedor, modelo, instrucoesVersao } = resultado.metricas;
  return {
    id: tarefa.execucaoId,
    conversaId: tarefa.conversaId,
    agenteId: tarefa.agenteId,
    iniciadaEm,
    duracaoMs: resultado.metricas.duracaoMs,
    estado: resultado.estado,
    ...(provedor ? { provedor } : {}),
    ...(modelo ? { modelo } : {}),
    ...(instrucoesVersao ? { instrucoesVersao } : {}),
    uso: usoTotal,
    passos: passosTotais,
    ferramentas,
    delegacoes,
    // Só código e mensagem: a mensagem de erro é nossa (ferramenta, runtime,
    // servidor), nunca conteúdo de registro.
    erros: resultado.erros.map((e) => ({
      codigo: e.codigo,
      mensagem: e.mensagem.slice(0, 300),
    })),
    documentos: resultado.documentos.map((d) => ({ id: d.id, acao: d.acao })),
    referenciasCitadas: resultado.evidencias.length,
  };
}

export async function lerExecucoes(): Promise<RegistroDeExecucao[]> {
  const bruto = await readLocal<unknown>(STORAGE_KEYS.taqExecucoes);
  if (!Array.isArray(bruto)) return [];
  return bruto.flatMap((r) => {
    const lido = registroDeExecucaoSchema.safeParse(r);
    return lido.success ? [lido.data] : [];
  });
}
