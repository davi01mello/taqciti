/**
 * Qual especialista o PEDIDO DA PESSOA indica — uma dica, em código, para o
 * orquestrador.
 *
 * Visto ao vivo (Groq, 01/10/2026): "registre os próximos passos" e "registre a
 * decisão" foram delegados ao especialista de DOCUMENTOS, e "analise a
 * reunião" foi respondido pelo Taq sem salvar a análise. A instrução do
 * `taq-v7` lista os especialistas, mas o modelo tende ao que já conhece.
 *
 * A dica não decide nada: entra no contexto como uma linha ("indicado para
 * este pedido: commitments"), e quem delega continua sendo o modelo. Também
 * não amplia permissão nenhuma — as ferramentas de cada especialista seguem
 * recortadas pela política. Na dúvida (nenhum padrão, ou documento nomeado),
 * não indica nada.
 */
import { normalizar } from './busca';
import { PEDIDO_DE_TELA } from './politica';

interface Regra {
  agente: string;
  /** Casa com o pedido normalizado (sem acento, minúsculas). */
  padrao: RegExp;
}

/**
 * Em ordem: a primeira que casa vence. A decisão revista vem antes da
 * passagem: "ficou decidido X, registre e resolva o desalinhamento" é do
 * `continuity`, que registra a decisão e resolve o achado.
 */
const REGRAS: readonly Regra[] = [
  // Um quadro da tela sob pedido é operação do aplicativo (cartão com escolha e prévia).
  { agente: 'app_assistant', padrao: PEDIDO_DE_TELA },
  { agente: 'capture_monitor', padrao: /\bcaptura\b.*\b(ok|confiavel|funcionando|problema|falh|lacuna|estado)/ },
  { agente: 'meeting_copilot', padrao: /\bo que (eu )?perdi\b|\bate agora\b.*\b(decid|falad)|\bnesta reuniao em andamento\b/ },
  {
    agente: 'continuity',
    padrao:
      /\bo que mudou\b|\bdesde a ultima\b|\bretom(ar|ada)\b|\b(decisao|decidido|decidiu)\b.*\b(mudou|revist|substitu|ficou para|registr)|\bregistr\w* (a|essa|esta|uma) decisao\b/,
  },
  {
    agente: 'handoff_analysis',
    padrao: /\b(desalinhament|divergenc|passagem|handoff)|\bcompar[ae]\w*\b.*\b(prometeu|prometido|escopo|comercial|produto|areas?)\b/,
  },
  {
    agente: 'commitments',
    padrao:
      /\b(compromissos?|proximos passos|tarefas?|pendencias|entregas?)\b|\bquem ficou de\b|\bmarqu?e\w* como conclu|\bconcluid[oa]\b.*\b(compromisso|tarefa)/,
  },
  { agente: 'meeting_analyst', padrao: /\banalis[ae]\w*\b.*\breuniao\b|\banalise (da|dessa|desta)\b/ },
  { agente: 'context', padrao: /\bprepar[ae]\w*(?:-me| me)?\s+para\b|\bantes da (proxima )?reuniao\b|\bo que (eu )?preciso saber\b/ },
  { agente: 'scheduling', padrao: /\b(horario|agendar|agenda|marcar (uma )?reuniao|disponibilidade)\b/ },
  {
    agente: 'communication',
    padrao: /\b(e-?mail|mensagem|recado|comunicado)\b.*\b(para|pro|pra)\b|\b(escrev|redij|prepar)\w* (um|uma) (e-?mail|mensagem|recado)/,
  },
  { agente: 'privacy_review', padrao: /\b(dados? pessoa|sensive|privacidade|lgpd|ocult|anonimiz)/ },
  { agente: 'quality_review', padrao: /\brevis[ae]\w*\b.*\b(ata|documento|doc)\b/ },
  { agente: 'organizational_memory', padrao: /\bja (discutimos|falamos|conversamos)\b|\bhistorico d[oa]\b|\blinha do tempo\b/ },
];

/** Palavras de documento do catálogo: aí quem decide é o fluxo de documento. */
const PEDE_DOCUMENTO = /\b(ata|x1|doc conversa|documento|minuta)\b/;

export function especialistaIndicado(pedido: string, disponiveis: readonly string[]): string | null {
  const t = normalizar(pedido);
  for (const r of REGRAS) {
    if (!r.padrao.test(t)) continue;
    // "revise a ata" é revisão; "gere a ata dos próximos passos" é documento.
    if (PEDE_DOCUMENTO.test(t) && r.agente !== 'quality_review') return null;
    return disponiveis.includes(r.agente) ? r.agente : null;
  }
  return null;
}
