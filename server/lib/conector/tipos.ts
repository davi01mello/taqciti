/**
 * O que o conector mostra para uma IA — e por que não é o tipo da extensão.
 *
 * A tentação é servir `MeetingRecord` como ele está no storage. Não serve, por
 * uma razão que só aparece em uso: o registro da extensão carrega coisas que
 * não cabem numa janela de contexto e que ninguém pediu. Um `Print` é um
 * `data:image/jpeg;base64,…` — uma única captura de tela vira dezenas de
 * milhares de tokens se escapar para dentro de uma resposta. `speakersObserved`
 * é telemetria do parser de legenda. `providerParticipantId` é id opaco de
 * tile.
 *
 * Então o conector tem o SEU tipo, e ele é uma projeção deliberadamente magra:
 * só o que responde perguntas sobre a reunião. O que ficou de fora não é
 * esquecimento, é orçamento — ver `orcamento.ts`.
 *
 * ── Identidade ────────────────────────────────────────────────────────────
 *
 * Todo item tem um id composto `tipo:id` (`reuniao:abc-123`). É isso que
 * permite `ler` e `conteudo` receberem UM argumento em vez de um par
 * (tipo, id), que a IA erraria metade das vezes. O prefixo também é a única
 * coisa que impede o id de um documento de casar por acidente com o de uma
 * reunião: as duas coleções são indexadas por chaves geradas em lugares
 * diferentes e nada garante que não colidam.
 */

/** As quatro coleções que o conector enxerga. */
export type TipoDeItem = 'reuniao' | 'documento' | 'conversa' | 'nota';

export const TIPOS_DE_ITEM: readonly TipoDeItem[] = [
  'reuniao',
  'documento',
  'conversa',
  'nota',
];

/** `reuniao:abc-123`. Ver o cabeçalho. */
export type IdDoConector = string;

export function comporId(tipo: TipoDeItem, id: string): IdDoConector {
  return `${tipo}:${id}`;
}

/**
 * Parte um id composto. Devolve `null` em vez de lançar porque quem passa o id
 * é um modelo de linguagem: id inventado é caso ESPERADO, não excepcional, e
 * precisa virar uma resposta que ensina o formato certo — não um 500.
 */
export function separarId(
  composto: string,
): { tipo: TipoDeItem; id: string } | null {
  const corte = composto.indexOf(':');
  if (corte <= 0) return null;
  const tipo = composto.slice(0, corte);
  const id = composto.slice(corte + 1);
  if (!id) return null;
  if (!(TIPOS_DE_ITEM as readonly string[]).includes(tipo)) return null;
  return { tipo: tipo as TipoDeItem, id };
}

// ---------------------------------------------------------------- O acervo

/**
 * Uma fala da transcrição, já achatada.
 *
 * `offsetMs` em vez de `startOffsetMs`/`endOffsetMs`: o fim de uma fala é o
 * começo da próxima para todo efeito prático de leitura, e dois números por
 * fala numa transcrição de 600 falas é 600 números a mais no contexto sem
 * nenhuma pergunta que eles respondam.
 */
export interface Fala {
  /** Quem falou. `null` quando a legenda não atribuiu. */
  falante: string | null;
  texto: string;
  /** Milissegundos desde o começo da reunião. */
  offsetMs: number;
}

/** Uma reunião, do jeito que o conector a conta. */
export interface ReuniaoDoAcervo {
  id: string;
  titulo: string;
  /** Instante do início, epoch ms. */
  inicioMs: number;
  duracaoSegundos: number;
  /** Só os nomes. Papel e confiança não respondem pergunta nenhuma aqui. */
  participantes: string[];
  falas: Fala[];
}

export interface DocumentoDoAcervo {
  id: string;
  titulo: string;
  /** O texto editável. É o que o editor abre e o download leva. */
  texto: string;
  criadoMs: number;
  atualizadoMs: number;
  /** `ata`, `x1`, … quando o documento veio de uma geração. */
  tipoGerado?: string;
  /** A reunião de onde saiu, quando saiu de uma. */
  reuniaoId?: string;
}

export interface MensagemDaConversa {
  autor: 'pessoa' | 'assistente';
  texto: string;
  emMs: number;
}

export interface ConversaDoAcervo {
  id: string;
  titulo: string;
  criadaMs: number;
  atualizadaMs: number;
  mensagens: MensagemDaConversa[];
  /** A reunião que serviu de contexto, quando a conversa nasceu de uma. */
  reuniaoId?: string;
}

/**
 * A nota de uma reunião, com as marcações junto.
 *
 * Nota e marcação viajam no mesmo item de propósito: as duas são "o que a
 * pessoa achou importante nesta reunião", vivem indexadas pelo mesmo
 * `meetingId` e são curtas. Separá-las em duas coleções dobraria o número de
 * itens no índice para ganhar uma distinção que ninguém vai consultar.
 *
 * Prints entram só como CONTAGEM. A imagem em si não é exposta — ver o
 * cabeçalho do arquivo.
 */
export interface NotaDoAcervo {
  /** É o id da reunião: existe no máximo uma nota por reunião. */
  id: string;
  reuniaoId: string;
  /** Título da reunião, para a nota ser legível sozinha num resultado de busca. */
  reuniaoTitulo: string;
  texto: string;
  atualizadaMs: number;
  /** Quantas falas foram marcadas, por tipo. Vazio quando não houve marcação. */
  marcacoes: Partial<Record<'destaque' | 'duvida' | 'decisao' | 'acao', number>>;
  /** Quantos prints existem. A imagem nunca sai daqui. */
  prints: number;
}

export interface ItemPorTipo {
  reuniao: ReuniaoDoAcervo;
  documento: DocumentoDoAcervo;
  conversa: ConversaDoAcervo;
  nota: NotaDoAcervo;
}

export type ItemDoAcervo = ItemPorTipo[TipoDeItem];

// --------------------------------------------------------------- o índice

/**
 * A linha magra de cada tipo: o que `listar` precisa e NADA além.
 *
 * Existe por uma assimetria que só aparece quando há banco de verdade:
 * mostrar vinte e cinco títulos não pode custar vinte e cinco transcrições.
 * Com uma interface só — `listar` devolvendo o item inteiro — era exatamente
 * isso que acontecia: um `SELECT *` trazendo megabytes de JSONB para imprimir
 * o campo `titulo`. Os contadores aqui são calculáveis em SQL
 * (`jsonb_array_length`, `length`), então a linha sai pronta do banco.
 */
export interface IndicePorTipo {
  reuniao: {
    id: string;
    titulo: string;
    inicioMs: number;
    duracaoSegundos: number;
    participantes: number;
    falas: number;
  };
  documento: {
    id: string;
    titulo: string;
    criadoMs: number;
    tipoGerado?: string;
    caracteres: number;
  };
  conversa: { id: string; titulo: string; criadaMs: number; mensagens: number };
  nota: {
    id: string;
    reuniaoTitulo: string;
    atualizadaMs: number;
    caracteres: number;
    marcacoes: number;
    prints: number;
  };
}

/**
 * A fonte de dados de UMA pessoa.
 *
 * Interface, e não classe, porque o conector precisa ser testável sem banco
 * nenhum: `acervoDeMemoria.ts` implementa isto com arrays, e é contra ele que
 * toda a disciplina de contexto é exercitada. O Postgres entra atrás da mesma
 * assinatura, sem que nenhuma ferramenta saiba a diferença.
 *
 * Três métodos, e a divisão entre eles é o ponto:
 *
 * - `indice`   listar sem pagar pelo conteúdo;
 * - `obter`    um item inteiro, quando se sabe qual;
 * - `procurar` uma PENEIRA GROSSA para a busca.
 *
 * `procurar` devolve candidatos, não resultados. Quem ranqueia e acha a
 * posição exata do termo é `busca.ts`, em TypeScript — porque a posição (o
 * índice da fala) é o que faz a escada do conector funcionar, e nenhum índice
 * de texto do banco a devolve. O banco só precisa jogar fora o que não tem
 * chance, e ele faz isso com um índice; o acervo de memória cumpre o mesmo
 * contrato devolvendo tudo, que para arrays é o comportamento certo.
 *
 * Tudo assíncrono mesmo na versão de memória: se fosse síncrono aqui, trocar
 * para o banco viraria uma mudança de assinatura subindo por toda a pilha.
 */
export interface Acervo {
  indice<T extends TipoDeItem>(tipo: T): Promise<readonly IndicePorTipo[T][]>;
  obter<T extends TipoDeItem>(tipo: T, id: string): Promise<ItemPorTipo[T] | null>;
  procurar<T extends TipoDeItem>(
    tipo: T,
    termos: readonly string[],
  ): Promise<readonly ItemPorTipo[T][]>;
}
