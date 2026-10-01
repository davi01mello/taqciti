/**
 * PolicyService — escopo e efeitos, aplicados em CÓDIGO.
 *
 * Nada aqui depende de o modelo se comportar. As instruções dizem ao modelo o
 * que ele deve fazer; esta política decide o que ele CONSEGUE fazer. Os dois
 * se sobrepõem de propósito: se as instruções falharem (um trecho de
 * transcrição convencendo o modelo a "criar um documento"), a política ainda
 * segura.
 *
 * ── Escopo ───────────────────────────────────────────────────────────────────
 *
 * Uma conversa que nasceu de uma reunião (a sidebar, com um trecho anexado)
 * enxerga aquela reunião e os documentos ligados a ela ou à própria conversa.
 * Uma conversa solta (a HOME) enxerga todas as reuniões e documentos deste
 * computador — que já é o limite natural: a extensão não tem outros.
 *
 * O escopo é montado aqui, a partir da conversa, e passado à tarefa. As
 * ferramentas conferem CADA id contra ele. Nenhum argumento amplia: pedir
 * `read_meeting` de uma reunião de fora devolve `fora_do_escopo`, e a busca nem
 * a enxerga.
 *
 * ── Efeitos ──────────────────────────────────────────────────────────────────
 *
 * Leitura é sempre permitida. Escrita local só quando o PEDIDO DA PESSOA pede
 * escrita (criar, redigir, editar…) — e aí sem confirmação extra: o pedido
 * explícito já é a autorização. Sem esse pedido, as ferramentas de escrita nem
 * são oferecidas ao modelo, então instrução maliciosa dentro de uma transcrição
 * não tem ferramenta para usar. Ação externa não existe nesta versão.
 *
 * A detecção é conservadora e erra para o lado seguro: um pedido de escrita
 * que ela não reconheça vira resposta sem documento, e o modelo diz que pode
 * criar se a pessoa pedir. Não há caminho inverso — um pedido de leitura que
 * libere escrita.
 */
import type { DocumentoGuardado } from '@/features/documents/store';
import type { Efeito, Escopo, Pergunta } from './contratos';

type MotivoDePergunta = Pergunta['motivo'];
import { normalizar } from './busca';
import { ErroDeFerramenta } from './tipos';

const VERBOS_DE_CRIACAO =
  /\b(cri[ae]r?|crie|ger[ae]r?|gere|escrev[ae]r?|redi(?:ja|gir|ge)|mont[ae]r?|elabor[ae]r?|prepar[ae]r?|faca|fazer|faz|produz(?:a|ir)?|transform[ae]r?|salv[ae]r?|guard[ae]r?|registr[ae]r?|document[ae]r?)\b/;
const VERBOS_DE_EDICAO =
  /\b(atualiz[ae]r?|atualize|edit[ae]r?|alter[ae]r?|corrij[ao]|corrigir|reescrev[ae]r?|ajust[ae]r?|acrescent[ae]r?|adicion[ae]r?|inclu(?:a|ir|i)|remov[ae]r?|tir[ae]r?|mud[ae]r?|substitu(?:a|ir|i))\b/;
const OBJETOS_DE_ESCRITA =
  /\b(documento|doc|ata|relatorio|resumo|minuta|rascunho|texto|pauta|plano|registro|lista|memorando|briefing|proposta|arquivo)\b/;

/** O pedido da pessoa pede escrita local? Ver o cabeçalho. */
export function pedeEscrita(texto: string): boolean {
  const t = normalizar(texto);
  if (VERBOS_DE_EDICAO.test(t) && OBJETOS_DE_ESCRITA.test(t)) return true;
  return VERBOS_DE_CRIACAO.test(t) && OBJETOS_DE_ESCRITA.test(t);
}

/**
 * `continua`: a mensagem responde a uma pergunta que o Taq fez DENTRO de um
 * pedido de documento (qual tipo, qual reunião, qual o projeto). A resposta
 * "x1" não pede escrita sozinha — mas continua o pedido que a pessoa fez
 * antes, e é esse pedido que autoriza. `confirmacao` não entra: é só sim/não.
 */
/** Operações sobre registros: apagar, excluir, renomear. */
const VERBOS_DE_OPERACAO =
  /\b(apag(?:ue|ar|a)|exclu(?:a|ir|i)|delet(?:e|ar)|remov(?:a|er)|renome(?:ie|ar|ia)|troqu?e o nome|mud(?:e|ar) o nome)\b/;
const OBJETOS_DE_OPERACAO =
  /\b(reuniao|reunioes|transcricao|documento|doc|ata|registro|conversa|conversas)\b/;
/** Desfazer uma exclusão: pedido de escrita mesmo sem nomear o objeto ("desfaça"). */
const VERBOS_DE_RESTAURACAO = /\b(desfa(?:ca|zer|z)|restaur(?:e|ar|a)|recuper(?:e|ar|a)|volt(?:e|ar) com)\b/;
/** Ações só na tela: abrir, mostrar, exportar, baixar. */
const VERBOS_DE_INTERFACE =
  /\b(abr(?:a|e|ir)|mostr(?:e|ar)|exib(?:a|ir)|export(?:e|ar|a)|baix(?:e|ar|a)|leve-me|me leve|ir para|v(?:a|a) para)\b/;

/** A pessoa pediu uma ação na TELA (abrir, baixar)? Ver o cabeçalho. */
export function pedeAcaoNaInterface(texto: string): boolean {
  return VERBOS_DE_INTERFACE.test(normalizar(texto));
}

/**
 * `continua`: a mensagem responde a uma pergunta que o Taq fez DENTRO de um
 * pedido (qual tipo, qual reunião, qual o projeto, qual dos registros). A
 * resposta "x1" não pede nada sozinha — mas continua o pedido que a pessoa fez
 * antes, e é esse pedido que autoriza. `confirmacao` não entra: é só sim/não,
 * e quem confirma uma exclusão escreve "apague" na própria mensagem da opção.
 */
export function efeitosDoPedido(texto: string, continua?: MotivoDePergunta): Efeito[] {
  const t = normalizar(texto);
  const continuaPedido =
    continua === 'tipo_de_documento' ||
    continua === 'registro_de_origem' ||
    continua === 'informacao_indispensavel' ||
    continua === 'escolha_de_registro';
  const efeitos: Efeito[] = ['leitura'];
  if (
    pedeEscrita(texto) ||
    (VERBOS_DE_OPERACAO.test(t) && OBJETOS_DE_OPERACAO.test(t)) ||
    VERBOS_DE_RESTAURACAO.test(t) ||
    continuaPedido
  ) {
    efeitos.push('escrita_local');
  }
  if (pedeAcaoNaInterface(texto) || continua === 'escolha_de_registro') efeitos.push('interface');
  return efeitos;
}
export function escopoDaConversa(p: {
  conversaId: string;
  /** A reunião que a conversa representa, quando nasceu de uma. */
  meetingId?: string;
  texto: string;
  continua?: MotivoDePergunta;
}): Escopo {
  return {
    reunioes: p.meetingId ? [p.meetingId] : 'todas',
    documentos: p.meetingId ? 'vinculados' : 'todos',
    conversaId: p.conversaId,
    efeitos: efeitosDoPedido(p.texto, p.continua),
  };
}

export function podeLerReuniao(escopo: Escopo, id: string): boolean {
  return escopo.reunioes === 'todas' || escopo.reunioes.includes(id);
}

export function podeLerDocumento(
  escopo: Escopo,
  doc: Pick<DocumentoGuardado, 'meetingId' | 'conversationId'>,
): boolean {
  if (escopo.documentos === 'todos') return true;
  if (doc.conversationId === escopo.conversaId) return true;
  return !!doc.meetingId && podeLerReuniao(escopo, doc.meetingId);
}

/**
 * Conversas seguem a mesma regra: a HOME enxerga todas; a conversa nascida de
 * uma reunião enxerga ela mesma e as outras conversas daquela reunião.
 */
export function podeLerConversa(
  escopo: Escopo,
  c: { id: string; meetingId?: string },
): boolean {
  if (escopo.reunioes === 'todas') return true;
  if (c.id === escopo.conversaId) return true;
  return !!c.meetingId && podeLerReuniao(escopo, c.meetingId);
}

export function exigirEfeito(escopo: Escopo, efeito: Efeito, ferramenta: string): void {
  if (!escopo.efeitos.includes(efeito)) {
    throw new ErroDeFerramenta(
      'efeito_nao_autorizado',
      `A ferramenta ${ferramenta} tem efeito "${efeito}", que esta execução não autoriza. ` +
        'Só a pessoa, na conversa, pode pedir uma escrita.',
    );
  }
}

export function exigirReuniao(escopo: Escopo, id: string): void {
  if (!podeLerReuniao(escopo, id)) {
    throw new ErroDeFerramenta(
      'fora_do_escopo',
      `A reunião ${id} está fora do escopo desta conversa.`,
    );
  }
}

export function exigirDocumento(
  escopo: Escopo,
  doc: Pick<DocumentoGuardado, 'id' | 'meetingId' | 'conversationId'>,
): void {
  if (!podeLerDocumento(escopo, doc)) {
    throw new ErroDeFerramenta(
      'fora_do_escopo',
      `O documento ${doc.id} está fora do escopo desta conversa.`,
    );
  }
}
