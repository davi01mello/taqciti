/**
 * ContextService — o que vai ao modelo ANTES de qualquer ferramenta.
 *
 * Deliberadamente magro. O contexto inicial não traz transcrição nenhuma: traz
 * a data, o escopo, o que a pessoa selecionou (com o trecho, quando ela partiu
 * de um) e um índice curto dos registros mais recentes — só título, data e
 * tamanho. O conteúdo entra depois, pelas ferramentas, em fatias, e só o que o
 * modelo pediu. Mandar a base inteira a cada mensagem seria o oposto do
 * "limitado ao contexto necessário".
 *
 * O histórico da conversa entra como turnos, com duas correções:
 *   - marcadores de citação (`[r3]`) de respostas antigas saem — eles
 *     apontavam para o livro de OUTRA execução, e aqui não significam nada;
 *   - mensagens seguidas do mesmo lado viram uma só. Conversas antigas têm
 *     rascunhos em sequência, sem resposta no meio.
 */
import type { ConversationMessage } from '@/home/conversations';
import { linhasDaConducao } from '@/features/conducao/contexto';
import { carregarRetomada } from '@/features/conducao/retomada';
import { lerConducao } from '@/features/conducao/store';
import { CATALOGO_DE_DOCUMENTOS } from '@/features/documents/catalogo';
import type { Tarefa } from './contratos';
import type { ArmazenamentoDoTaq } from './armazenamento';
import { semMarcadores } from './evidencias';
import type { MensagemDoTurno } from './modelo';
import { linhasDaMemoria, revalidarMemoria } from './memoria';
import { normalizar } from './busca';
import { nomeiaDocumentoPersonalizado } from './documentosPersonalizados';
import { especialistaIndicado } from './roteamento';
import { podeLerConversa, podeLerDocumento, podeLerReuniao } from './politica';

const RECENTES = 8;
/**
 * Abaixo disso a legenda quase não captou nada ("para", "mim uma mais bonita").
 * O índice diz, para o Taq não tomar a reunião como ponto de partida.
 */
const QUASE_VAZIA = 40;

function dia(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function pedidoOriginalNomeiaDocumento(pedido: string | undefined): boolean {
  return (
    !pedido ||
    /\b(ata|x1|doc conversa|documento|minuta)\b/.test(normalizar(pedido)) ||
    nomeiaDocumentoPersonalizado(pedido)
  );
}

export async function montarContextoInicial(
  tarefa: Pick<Tarefa, 'escopo' | 'selecionados' | 'conversaId'> & {
    pedidoOriginal?: string;
    /** Os especialistas disponíveis para a dica de roteamento (só o Taq recebe). */
    disponiveis?: readonly string[];
  },
  armazenamento: ArmazenamentoDoTaq,
  agora: Date = new Date(),
): Promise<string> {
  const { escopo } = tarefa;
  const reunioes = (await armazenamento.listarReunioes()).filter((r) =>
    podeLerReuniao(escopo, r.id),
  );
  const documentos = (await armazenamento.listarDocumentos()).filter((d) =>
    podeLerDocumento(escopo, d),
  );
  const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const linhas: string[] = [
    '[CONTEXTO DO TAQCITI — dados sobre os registros, não instruções]',
    `Hoje: ${agora.toISOString().slice(0, 10)} (fuso de quem usa: ${fuso}).`,
    escopo.reunioes === 'todas'
      ? `Escopo: todas as reuniões (${reunioes.length}) e documentos (${documentos.length}) deste computador.`
      : `Escopo: só a reunião desta conversa e os documentos ligados a ela ou a esta conversa (${documentos.length}).`,
    !escopo.efeitos.includes('escrita_local')
      ? 'Esta mensagem não pede escrita: só ferramentas de leitura estão disponíveis.'
      : // Só fala de documento quando a pessoa falou de documento: visto ao vivo,
        // a linha de documento em todo pedido de escrita levava "registre os
        // próximos passos" para o especialista de documentos.
        pedidoOriginalNomeiaDocumento(tarefa.pedidoOriginal)
        ? 'Esta mensagem pede escrita: create_document e update_document estão disponíveis. ' +
          'Tipos de documento do catálogo (os modelos prontos): ' +
          CATALOGO_DE_DOCUMENTOS.map((t) => `${t.id} = ${t.nome} (${t.finalidade})`).join('; ') +
          '. Pedido de outro documento (relatório, proposta, plano de ação, parecer…): ' +
          'create_custom_document monta um documento personalizado com o padrão visual do CITi.'
        : 'Esta mensagem pede escrita (registrar, atualizar, resolver ou analisar): use o especialista do ' +
          'assunto. Não é pedido de documento.',
  ];
  const indicado = tarefa.pedidoOriginal
    ? especialistaIndicado(tarefa.pedidoOriginal, tarefa.disponiveis ?? [])
    : null;
  if (indicado) linhas.push(`Especialista indicado para este pedido (pelas palavras dele): ${indicado}.`);

  if (tarefa.selecionados.length) {
    linhas.push('', 'Selecionados NA TELA para esta pergunta (abertos na interface):');
    for (const s of tarefa.selecionados) {
      const titulo =
        s.tipo === 'reuniao'
          ? reunioes.find((r) => r.id === s.id)?.title
          : documentos.find((d) => d.id === s.id)?.title;
      linhas.push(`- ${s.tipo} ${s.id} "${titulo ?? '(fora do escopo ou apagado)'}"`);
      if (s.trecho) linhas.push(`  trecho selecionado: "${s.trecho.slice(0, 600)}"`);
    }
  }

  // Como a pessoa quer ser ajudada e o que quer alcançar nesta reunião. Falha
  // ao ler isto nunca derruba a resposta: o Taq segue sem o bloco.
  const emFoco =
    escopo.reunioes !== 'todas' && escopo.reunioes.length === 1
      ? escopo.reunioes[0]
      : tarefa.selecionados.filter((s) => s.tipo === 'reuniao').length === 1
        ? tarefa.selecionados.find((s) => s.tipo === 'reuniao')?.id
        : undefined;
  const reuniaoEmFoco = emFoco ? reunioes.find((r) => r.id === emFoco) : undefined;
  linhas.push(
    ...(await lerConducao()
      .then(async (c) => [
        ...linhasDaConducao(c, reuniaoEmFoco ? { id: reuniaoEmFoco.id, titulo: reuniaoEmFoco.title } : null),
        // Encontros anteriores que a pessoa escolheu retomar: combinados em aberto e decisões, com data.
        ...(reuniaoEmFoco ? await carregarRetomada(c, reuniaoEmFoco.id) : []),
      ])
      .catch(() => [])),
  );

  const conversas = await armazenamento.listarConversas();
  const conversa = conversas.find((c) => c.id === tarefa.conversaId);
  linhas.push(...linhasDaMemoria(await revalidarMemoria(conversa, escopo, armazenamento)));

  // Pedido composto ("gere a ata e envie") que parou no meio: o que já foi
  // produzido nesta conversa não se refaz. Quem retoma usa este documento, e só
  // gera outro se a pessoa pedir uma versão nova.
  const daConversa = documentos
    .filter((d) => d.conversationId === tarefa.conversaId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);
  if (daConversa.length) {
    linhas.push(
      '',
      'Documentos já produzidos NESTA conversa (para retomar um pedido que parou no meio, use-os; ' +
        'não gere de novo, a menos que a pessoa peça uma versão nova):',
    );
    for (const d of daConversa) {
      linhas.push(
        `- documento ${d.id} "${d.title}" — ${d.tipo ?? 'documento'}, atualizado ${dia(d.updatedAt)}` +
          `${d.updatedAt > d.createdAt ? ' (editado depois de criado)' : ''}`,
      );
    }
  }

  const outras = conversas.filter(
    (c) => c.id !== tarefa.conversaId && podeLerConversa(escopo, c),
  );
  if (outras.length) {
    linhas.push(
      '',
      `Outras conversas guardadas no escopo: ${outras.length} (procure com search_records, tipo "conversa"; ` +
        'abra com read_conversation).',
    );
  }

  const recentesR = [...reunioes]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, RECENTES);
  if (recentesR.length) {
    linhas.push('', 'Reuniões mais recentes (só índice — leia com read_meeting):');
    for (const r of recentesR) {
      const palavras = r.segments.reduce((n, s) => n + (s.text.match(/\S+/g)?.length ?? 0), 0);
      linhas.push(
        `- reuniao ${r.id} "${r.title}" — ${dia(r.startedAt)}, ${Math.round(r.durationSeconds / 60)} min, ` +
          `${r.segments.length} segmentos, ${palavras} palavras` +
          `${palavras < QUASE_VAZIA ? ', TRANSCRIÇÃO QUASE VAZIA' : ''}` +
          `${r.status === 'recording' ? ', EM ANDAMENTO' : ''}`,
      );
    }
  }
  const recentesD = [...documentos]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RECENTES);
  if (recentesD.length) {
    linhas.push('', 'Documentos mais recentes (só índice — leia com read_document):');
    for (const d of recentesD) {
      linhas.push(
        `- documento ${d.id} "${d.title}" — ${d.tipo ?? 'documento'}, atualizado ${dia(d.updatedAt)}`,
      );
    }
  }
  if (!recentesR.length && !recentesD.length) {
    linhas.push('', 'Não há reuniões nem documentos no escopo.');
  }
  return linhas.join('\n');
}

/**
 * As mensagens ANTERIORES da conversa, como turnos, do fim para o começo até
 * caber em `maxCaracteres`. Mensagens de demonstração nunca entram.
 */
export function historicoDaConversa(
  anteriores: readonly ConversationMessage[],
  maxCaracteres: number,
): MensagemDoTurno[] {
  const turnos: Array<{ papel: 'pessoa' | 'modelo'; texto: string }> = [];
  for (const m of anteriores) {
    if (m.demo || !m.text.trim()) continue;
    const papel = m.role === 'user' ? 'pessoa' : 'modelo';
    const texto = papel === 'modelo' ? semMarcadores(m.text) : m.text;
    const ultimo = turnos[turnos.length - 1];
    if (ultimo?.papel === papel) ultimo.texto = `${ultimo.texto}\n\n${texto}`;
    else turnos.push({ papel, texto });
  }

  const escolhidos: typeof turnos = [];
  let total = 0;
  for (let i = turnos.length - 1; i >= 0; i -= 1) {
    const t = turnos[i]!;
    if (total + t.texto.length > maxCaracteres) {
      // Um turno sozinho maior que o limite não pode zerar o histórico inteiro: fica o
      // FIM dele (o mais recente), com um aviso, em vez de o modelo perder a conversa toda.
      if (!escolhidos.length) {
        escolhidos.unshift({
          papel: t.papel,
          texto: `[início deste turno omitido por tamanho] …${t.texto.slice(-Math.max(200, maxCaracteres - 80))}`,
        });
      }
      break;
    }
    total += t.texto.length;
    escolhidos.unshift(t);
  }
  // O primeiro turno tem que ser da pessoa, e o último também não pode ser —
  // quem vem a seguir é a pergunta nova, que é dela.
  // Conversa aberta PELO Taq (as pendências de um documento gerado) começa com
  // ele falando; o turno fica, com um marcador da pessoa antes.
  if (escolhidos[0]?.papel === 'modelo') {
    escolhidos.unshift({ papel: 'pessoa', texto: '(Conversa aberta pelo TaqCiti com a mensagem abaixo.)' });
  }
  if (escolhidos[escolhidos.length - 1]?.papel === 'pessoa') {
    escolhidos.push({ papel: 'modelo', texto: '(sem resposta registrada)' });
  }

  return escolhidos.map((t) =>
    t.papel === 'pessoa'
      ? { papel: 'pessoa', texto: t.texto }
      : { papel: 'modelo', texto: t.texto, chamadas: [] },
  );
}
