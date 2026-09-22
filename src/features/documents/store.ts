/**
 * Os DOCUMENTOS guardados — a coleção que a seção "Documentos" lista.
 *
 * ── O que ela substitui ──────────────────────────────────────────────────
 *
 * Nada era guardado. A geração entregava o arquivo (Google Docs ou download) e
 * terminava ali, e a seção "Documentos" listava REUNIÕES como substituto — o
 * caminho de ida para gerar, não documentos. Quem gerasse uma ata e fechasse a
 * aba não tinha como voltar a ela pela extensão.
 *
 * ── O que entra, e o que nunca entra ─────────────────────────────────────
 *
 * Entra documento cujo CONTEÚDO está aqui. Um arquivo que só foi baixado numa
 * versão anterior não vira registro retroativo: a extensão não tem o texto
 * dele, e listá-lo ofereceria "abrir" e "editar" para algo que não existe mais
 * deste lado. Melhor uma lista vazia e verdadeira.
 *
 * As NOTAS de reunião também não entram. Elas são um agregado da reunião (ver
 * `features/annotations/notes.ts`), não um documento independente — promovê-las
 * automaticamente encheria esta lista de textos que ninguém pediu para guardar
 * aqui, e criaria duas superfícies editando o mesmo conteúdo com regras
 * diferentes.
 *
 * ── Por que fora do registro da reunião ──────────────────────────────────
 *
 * Mesma razão das anotações: a captura reescreve o registro da reunião a cada
 * trecho, e um documento aninhado nele seria atropelado pela escrita seguinte.
 * O vínculo é um id.
 */
import { criarFilaDeGravacao } from '@/shared/services/saveQueue';
import { comTravaLocal } from '@/shared/services/storageLock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange, readLocal, writeLocal } from '@/shared/services/storage';

/**
 * O formato do conteúdo guardado.
 *
 * `markdown` é o que a geração devolve em `content` e o que o editor edita.
 * `html` existe porque a entrega (Google Docs, PDF) parte dele — é guardado ao
 * lado, nunca no lugar do editável.
 */
export type FormatoDoDocumento = 'markdown' | 'texto';

export interface DocumentoGuardado {
  /** Estável: sobrevive a renomear, editar e reabrir o navegador. */
  id: string;
  title: string;
  /** O conteúdo EDITÁVEL. É isto que o editor abre e o download leva. */
  content: string;
  formato: FormatoDoDocumento;
  createdAt: number;
  updatedAt: number;
  /** A reunião de onde ele saiu, quando saiu de uma. */
  meetingId?: string;
  /** A conversa de onde ele saiu, quando saiu de uma. */
  conversationId?: string;
  /**
   * O tipo pedido na geração (`ata`, `x1`, …), quando veio de uma. Fica como
   * texto solto de propósito: é rótulo de origem, e esta coleção não deve
   * depender do vocabulário do servidor de geração para existir.
   */
  tipo?: string;
  /**
   * O HTML que a geração produziu, quando produziu.
   *
   * Guardado ao lado do `content`, e nunca no lugar dele: é dele que saem o
   * Google Docs e o PDF, e reconstruí-lo a partir do markdown editado seria
   * inventar uma conversão que o servidor faz melhor. Editar o `content` não o
   * atualiza — e o download do editor leva o que foi editado, não este.
   */
  html?: string;
  /**
   * De onde veio. `demo` é semeado pelos dados de teste e some com eles.
   * Não há `importado`: documento sem conteúdo não vira registro.
   */
  origem: 'gerado' | 'manual' | 'demo';
}

function ehDocumento(v: unknown): v is DocumentoGuardado {
  if (!v || typeof v !== 'object') return false;
  const d = v as Partial<DocumentoGuardado>;
  return (
    typeof d.id === 'string' &&
    typeof d.title === 'string' &&
    typeof d.content === 'string' &&
    typeof d.updatedAt === 'number'
  );
}

function novoId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Mais recentes primeiro, como em todo o resto do produto. */
function ordenar(lista: DocumentoGuardado[]): DocumentoGuardado[] {
  return [...lista].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function lerDocumentos(): Promise<DocumentoGuardado[]> {
  const bruto = await readLocal<unknown>(STORAGE_KEYS.documents);
  if (bruto !== null && !Array.isArray(bruto))
    throw new Error('Não foi possível ler a coleção de documentos');
  // Defensivo: registro gravado por uma versão anterior (ou corrompido por uma
  // escrita interrompida) não pode derrubar a seção inteira.
  return ordenar(Array.isArray(bruto) ? bruto.filter(ehDocumento) : []);
}

async function gravar(lista: DocumentoGuardado[]): Promise<void> {
  const bruto = await readLocal<unknown>(STORAGE_KEYS.documents);
  if (bruto !== null && !Array.isArray(bruto))
    throw new Error('Coleção de documentos inválida');
  const desconhecidos = Array.isArray(bruto) ? bruto.filter((d) => !ehDocumento(d)) : [];
  await writeLocal(STORAGE_KEYS.documents, [...ordenar(lista), ...desconhecidos]);
}

/** Observa a coleção. Emite o valor atual e cada mudança — mesma regra dos
 *  demais observadores do produto, para a UI não precisar do passo duplo. */
export function observarDocumentos(
  cb: (documentos: DocumentoGuardado[]) => void,
  onErro: () => void = () => {},
): () => void {
  let vivo = true;
  let mudou = false;
  void lerDocumentos()
    .then((d) => {
      if (vivo && !mudou) cb(d);
    })
    .catch(() => {
      if (vivo) onErro();
    });
  const parar = onLocalChange<unknown>(STORAGE_KEYS.documents, (valor) => {
    if (!vivo) return;
    mudou = true;
    cb(ordenar(Array.isArray(valor) ? valor.filter(ehDocumento) : []));
  });
  return () => {
    vivo = false;
    parar();
  };
}

export interface NovoDocumento {
  title: string;
  content: string;
  formato?: FormatoDoDocumento;
  meetingId?: string;
  conversationId?: string;
  tipo?: string;
  html?: string;
  origem?: DocumentoGuardado['origem'];
}

/**
 * Guarda um documento novo e devolve o registro gravado.
 *
 * Devolve o REGISTRO, e não só o id, porque quem chama precisa mostrar o
 * documento salvo na hora — e precisa do `updatedAt` que acabou de existir
 * para não inventar um. Lança se o storage recusar: quem gerou precisa saber
 * que não salvou, porque a tela não pode dizer "Salvo" sobre o que não foi.
 */
export async function guardarDocumento(novo: NovoDocumento): Promise<DocumentoGuardado> {
  const agora = Date.now();
  const documento: DocumentoGuardado = {
    id: novoId(),
    title: novo.title.trim() || 'Documento sem título',
    content: novo.content,
    formato: novo.formato ?? 'markdown',
    createdAt: agora,
    updatedAt: agora,
    origem: novo.origem ?? 'manual',
    ...(novo.meetingId ? { meetingId: novo.meetingId } : {}),
    ...(novo.conversationId ? { conversationId: novo.conversationId } : {}),
    ...(novo.tipo ? { tipo: novo.tipo } : {}),
    ...(novo.html ? { html: novo.html } : {}),
  };

  await comTravaLocal(STORAGE_KEYS.documents, async () => {
    await gravar([documento, ...(await lerDocumentos())]);
  });
  return documento;
}

/**
 * Altera um documento existente. `updatedAt` sobe sozinho.
 *
 * A leitura acontece DENTRO da gravação, no instante dela, pelo mesmo motivo
 * do helper das anotações: com duas superfícies abertas, `ler → mudar → gravar`
 * separados perdem escrita.
 */
export async function atualizarDocumento(
  id: string,
  patch: Partial<Pick<DocumentoGuardado, 'title' | 'content' | 'formato' | 'html'>>,
): Promise<DocumentoGuardado | null> {
  return comTravaLocal(STORAGE_KEYS.documents, async () => {
    const todos = await lerDocumentos();
    const atual = todos.find((d) => d.id === id);
    if (!atual) return null;

    const proximo: DocumentoGuardado = { ...atual, ...patch, updatedAt: Date.now() };
    await gravar([proximo, ...todos.filter((d) => d.id !== id)]);
    return proximo;
  });
}

export async function apagarDocumento(id: string): Promise<void> {
  return comTravaLocal(STORAGE_KEYS.documents, async () => {
    const todos = await lerDocumentos();
    if (!todos.some((d) => d.id === id)) return;
    await gravar(todos.filter((d) => d.id !== id));
  });
}

/** Respiro entre a última tecla e a gravação. O mesmo das notas. */
export const AGUARDAR_MS = 700;

export type EstadoDaGravacaoDoDocumento = 'parado' | 'gravando' | 'salvo' | 'falhou';

/**
 * Um gravador com respiro, por documento.
 *
 * Fora do React de propósito, pelo mesmo motivo do gravador de notas: o editor
 * desmonta ao navegar para outra seção, e um temporizador dentro dele perderia
 * a última tecla exatamente quando a pessoa sai da tela — que é o momento em
 * que perder dói mais. `descarregar` existe para esse instante.
 *
 * O estado é devolvido para a interface poder dizer, discretamente, "salvo" ou
 * "não deu". Uma falha nunca pode se parecer com sucesso.
 */
export function criarGravadorDeDocumento(
  aoMudarEstado: (estado: EstadoDaGravacaoDoDocumento) => void,
) {
  return criarFilaDeGravacao<Partial<Pick<DocumentoGuardado, 'title' | 'content'>>>(
    async (id, patch) => {
      if (!(await atualizarDocumento(id, patch)))
        throw new Error('Documento não encontrado');
    },
    (anterior, novo) => ({ ...anterior, ...novo }),
    aoMudarEstado,
  );
}

export function documentosDaReuniao(
  todos: readonly DocumentoGuardado[],
  meetingId: string,
) {
  return todos.filter((d) => d.meetingId === meetingId);
}

export async function desvincularDaReuniao(meetingId: string): Promise<number> {
  return comTravaLocal(STORAGE_KEYS.documents, async () => {
    const todos = await lerDocumentos();
    const afetados = todos.filter((d) => d.meetingId === meetingId);
    if (!afetados.length) return 0;
    await gravar(
      todos.map((d) => {
        if (d.meetingId !== meetingId) return d;
        const copia = { ...d };
        delete copia.meetingId;
        return copia;
      }),
    );
    return afetados.length;
  });
}
