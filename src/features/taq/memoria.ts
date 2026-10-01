/**
 * MEMÓRIA E CONTEXTO da conversa — o que liga uma pergunta às anteriores.
 *
 * Memória aqui é RECUPERAÇÃO, não treino: os registros persistidos (reuniões,
 * documentos, conversas) e, por conversa, os ponteiros para os registros que
 * ela já usou (`Conversation.memoria`). Não há resumo guardado; o conteúdo
 * continua nos registros e entra pelas ferramentas, em fatias. Por isso não há
 * resumo a invalidar: um ponteiro para registro apagado some na revalidação, e
 * um renomeado aparece com o nome atual.
 *
 * ── Quem vence quando há mais de um candidato a "essa reunião" ──────────────
 *
 *   1. o que a pessoa NOMEOU na mensagem (o modelo resolve, pela busca);
 *   2. o que a TELA selecionou para esta pergunta (`selecionados`);
 *   3. a reunião que a conversa representa (o escopo da sidebar);
 *   4. o FOCO da conversa — o último registro que ela usou;
 *   5. nada: se ainda assim for ambíguo, pergunta-se (`ask_user`).
 *
 * O contexto inicial diz ao modelo o que é cada um, com rótulos diferentes,
 * para ele não confundir "aberto na tela" com "mencionado antes".
 */
import type { Conversation, RegistroLembrado } from '@/home/conversations';
import type { Escopo, RegistroSelecionado, ResultadoDoAgente } from './contratos';
import type { ArmazenamentoDoTaq } from './armazenamento';
import { podeLerDocumento, podeLerReuniao } from './politica';

export interface LembradoRevalidado {
  tipo: 'reuniao' | 'documento';
  id: string;
  /** O título ATUAL do registro. */
  titulo: string;
  /** O título de quando foi usado, se mudou desde então. */
  tituloAnterior?: string;
}

export interface MemoriaRevalidada {
  foco?: LembradoRevalidado;
  recentes: LembradoRevalidado[];
  /** Quantos ponteiros caíram: registro apagado ou fora do escopo. */
  descartados: number;
}

/**
 * Confere cada ponteiro da memória contra os registros: existe? está no
 * escopo? mudou de nome? O que não passa não chega ao modelo.
 */
export async function revalidarMemoria(
  conversa: Pick<Conversation, 'memoria'> | undefined,
  escopo: Escopo,
  armazenamento: ArmazenamentoDoTaq,
): Promise<MemoriaRevalidada> {
  const memoria = conversa?.memoria;
  if (!memoria?.recentes.length && !memoria?.foco) return { recentes: [], descartados: 0 };
  const reunioes = new Map(
    (await armazenamento.listarReunioes())
      .filter((r) => podeLerReuniao(escopo, r.id))
      .map((r) => [r.id, r.title]),
  );
  const documentos = new Map(
    (await armazenamento.listarDocumentos())
      .filter((d) => podeLerDocumento(escopo, d))
      .map((d) => [d.id, d.title]),
  );
  const conferir = (l: RegistroLembrado): LembradoRevalidado | null => {
    const atual = (l.tipo === 'reuniao' ? reunioes : documentos).get(l.id);
    if (atual === undefined) return null;
    return {
      tipo: l.tipo,
      id: l.id,
      titulo: atual,
      ...(atual !== l.titulo ? { tituloAnterior: l.titulo } : {}),
    };
  };
  const recentes = memoria.recentes.map(conferir);
  const foco = memoria.foco ? conferir(memoria.foco) : null;
  return {
    ...(foco ? { foco } : {}),
    recentes: recentes.filter((r): r is LembradoRevalidado => r !== null),
    descartados: recentes.filter((r) => r === null).length,
  };
}

/** O foco como registro para a tarefa — o que as ferramentas usam por último. */
export function focoDaTarefa(m: MemoriaRevalidada): RegistroSelecionado | undefined {
  return m.foco ? { tipo: m.foco.tipo, id: m.foco.id } : undefined;
}

/** As linhas do contexto inicial sobre a memória. Vazio quando não há o que dizer. */
export function linhasDaMemoria(m: MemoriaRevalidada): string[] {
  if (!m.foco && !m.recentes.length && !m.descartados) return [];
  const nome = (l: LembradoRevalidado) =>
    `${l.tipo} ${l.id} "${l.titulo}"${l.tituloAnterior ? ` (antes chamado "${l.tituloAnterior}")` : ''}`;
  const linhas = ['', 'Memória desta conversa (registros usados em respostas anteriores; já conferidos):'];
  if (m.foco) linhas.push(`- EM FOCO (o último de que a conversa falou): ${nome(m.foco)}`);
  for (const r of m.recentes) {
    if (m.foco && r.tipo === m.foco.tipo && r.id === m.foco.id) continue;
    linhas.push(`- usado antes: ${nome(r)}`);
  }
  if (m.descartados)
    linhas.push(
      `- ${m.descartados} registro(s) usado(s) antes foram apagados ou saíram do escopo: não os cite.`,
    );
  linhas.push(
    '"Essa reunião"/"esse documento" sem nome = o selecionado na tela; senão, o EM FOCO. ' +
      'Se a pessoa nomear outro registro, vale o nomeado.',
  );
  return linhas;
}

/**
 * Os registros que uma resposta USOU, para a memória: os citados (na ordem da
 * primeira citação), os documentos produzidos e os abertos. O primeiro vira o
 * foco da conversa.
 */
export function registrosUsados(
  r: Pick<ResultadoDoAgente, 'evidencias' | 'documentos' | 'operacoes'>,
): Array<Omit<RegistroLembrado, 'em'>> {
  const lista: Array<Omit<RegistroLembrado, 'em'>> = [];
  const vistos = new Set<string>();
  const por = (tipo: 'reuniao' | 'documento', id: string, titulo: string) => {
    const chave = `${tipo}:${id}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    lista.push({ tipo, id, titulo });
  };
  for (const d of r.documentos) por('documento', d.id, d.titulo);
  for (const e of r.evidencias) por(e.tipo, e.registroId, e.titulo);
  for (const o of r.operacoes ?? []) {
    if (!o.ok || o.acao === 'apagar' || o.tipo === 'conversa') continue;
    por(o.tipo, o.id, o.titulo);
  }
  return lista;
}
