/**
 * A BIBLIOTECA — guardar, ler, alterar, apagar e procurar referências.
 *
 * ── O armazenamento é um arquivo JSON, e isso é provisório de propósito ──
 *
 * Não há banco ainda, e não há decisão sobre qual. O que existe é uma
 * INTERFACE — `abrirBiblioteca(caminho)` devolve um objeto com os métodos —, e
 * é ela que o resto do sistema vai conhecer. Trocar o arquivo por Postgres ou
 * SQLite depois é escrever outra implementação do mesmo objeto; nenhum chamador
 * muda. O caminho do arquivo é PARÂMETRO pelo mesmo motivo que o `fetch` do
 * adaptador da OpenAI é parâmetro: teste que escreve no arquivo de produção não
 * é teste, é acidente.
 *
 * ── Escrita: arquivo temporário e renomeação ─────────────────────────────
 *
 * Um `writeFile` direto sobre o arquivo bom trunca ANTES de escrever. Se o
 * processo morrer no meio — e `next dev` reinicia sozinho o tempo todo — o que
 * sobra é meia biblioteca, ou zero byte. Escrever ao lado e renomear em cima é
 * atômico no sistema de arquivos: ou o arquivo antigo inteiro, ou o novo
 * inteiro, nunca um terço de cada.
 *
 * ── A busca é de texto, e ela sabe que é ─────────────────────────────────
 *
 * Sem embeddings, sem índice invertido: normaliza acento e caixa, quebra em
 * termos e conta quantos aparecem. Procurar "dor" não encontra "problema do
 * cliente", e isso é limitação conhecida — ver a lista de pendências no README.
 * O que ela faz bem é o caso que o produto precisa hoje: filtrar por categoria e
 * achar pelo assunto que alguém escreveu.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  validarReferencia,
  type Categoria,
  type Referencia,
  type TipoDeReferencia,
} from './tipos';

/** O arquivo de produção — os dados semeados desta fase. */
export const CAMINHO_PADRAO = join(process.cwd(), 'lib/diagnostico/referencias/dados/referencias.json');

export interface FiltroDeBusca {
  /** Texto livre: casa com título, assunto, autor e `quando_aplicar`. */
  texto?: string;
  categoria?: Categoria;
  tipo?: TipoDeReferencia;
  /** Teto de resultados. Ausente = todos. */
  limite?: number;
}

export interface ResultadoDaBusca {
  referencia: Referencia;
  /** Quantos termos da consulta apareceram. É o critério de ordenação. */
  termosEncontrados: number;
}

/**
 * Tira acento e caixa.
 *
 * `NFD` separa a letra do acento e o `replace` joga fora a marca combinante —
 * é o que faz "execução" e "execucao" casarem. Sem isto, metade das buscas em
 * português falha por causa de uma cedilha.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Os termos de uma consulta: palavras de 2+ letras, sem repetição. */
export function termosDe(consulta: string): string[] {
  return [
    ...new Set(
      normalizar(consulta)
        .split(/[^a-z0-9]+/)
        .filter((termo) => termo.length >= 2),
    ),
  ];
}

/** O texto que a busca varre numa referência. */
function corpoDeBusca(referencia: Referencia): string {
  return normalizar(
    [referencia.titulo, referencia.assunto, referencia.autor, referencia.quando_aplicar].join(' '),
  );
}

export interface Biblioteca {
  listar(): Promise<Referencia[]>;
  obter(id: string): Promise<Referencia | undefined>;
  criar(referencia: Referencia): Promise<Referencia>;
  atualizar(id: string, mudancas: Partial<Omit<Referencia, 'id'>>): Promise<Referencia>;
  apagar(id: string): Promise<boolean>;
  buscar(filtro: FiltroDeBusca): Promise<ResultadoDaBusca[]>;
  porCategoria(categoria: Categoria): Promise<Referencia[]>;
}

export class ErroDaBiblioteca extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDaBiblioteca';
  }
}

export function abrirBiblioteca(caminho: string = CAMINHO_PADRAO): Biblioteca {
  /**
   * Lê do disco a cada operação, em vez de guardar em memória.
   *
   * A biblioteca tem dezenas de linhas, não milhares, e o custo de reler é
   * irrelevante perto do custo de um cache que desatualiza: com `next dev`
   * recarregando módulos e mais de um processo possível, um estado em memória
   * seria a fonte de um "salvei e sumiu" difícil de reproduzir.
   */
  async function ler(): Promise<Referencia[]> {
    let cru: string;
    try {
      cru = await readFile(caminho, 'utf8');
    } catch (erro) {
      // Biblioteca que ainda não existe é uma biblioteca vazia, não um erro:
      // é o estado de quem acabou de clonar o repositório.
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw erro;
    }

    let dados: unknown;
    try {
      dados = JSON.parse(cru);
    } catch {
      throw new ErroDaBiblioteca(`${caminho} não é JSON válido.`);
    }
    if (!Array.isArray(dados)) {
      throw new ErroDaBiblioteca(`${caminho} precisa conter uma LISTA de referências.`);
    }

    return dados.map((item, indice) => {
      const check = validarReferencia(item);
      if (!check.ok) {
        // Falha alto, com a posição. Aceitar a linha inválida em silêncio faria
        // a biblioteca "perder" uma fonte sem ninguém notar.
        throw new ErroDaBiblioteca(
          `referência inválida na posição ${indice} de ${caminho}: ${check.erros.join(' ')}`,
        );
      }
      return check.valor;
    });
  }

  async function gravar(referencias: Referencia[]): Promise<void> {
    await mkdir(dirname(caminho), { recursive: true });
    const temporario = `${caminho}.tmp`;
    await writeFile(temporario, `${JSON.stringify(referencias, null, 2)}\n`, 'utf8');
    await rename(temporario, caminho);
  }

  return {
    listar: ler,

    async obter(id) {
      return (await ler()).find((referencia) => referencia.id === id);
    },

    async criar(referencia) {
      const check = validarReferencia(referencia);
      if (!check.ok) {
        throw new ErroDaBiblioteca(`referência inválida: ${check.erros.join(' ')}`);
      }
      const todas = await ler();
      if (todas.some((existente) => existente.id === check.valor.id)) {
        throw new ErroDaBiblioteca(`já existe uma referência com o id "${check.valor.id}".`);
      }
      await gravar([...todas, check.valor]);
      return check.valor;
    },

    async atualizar(id, mudancas) {
      const todas = await ler();
      const indice = todas.findIndex((referencia) => referencia.id === id);
      if (indice === -1) {
        throw new ErroDaBiblioteca(`não há referência com o id "${id}".`);
      }
      // O id não muda por atualização: ele é o que a rastreabilidade guardou
      // dentro de um insight já emitido, e trocá-lo quebraria a citação.
      const proposta = { ...todas[indice]!, ...mudancas, id };
      const check = validarReferencia(proposta);
      if (!check.ok) {
        throw new ErroDaBiblioteca(`atualização inválida: ${check.erros.join(' ')}`);
      }
      const proximas = [...todas];
      proximas[indice] = check.valor;
      await gravar(proximas);
      return check.valor;
    },

    async apagar(id) {
      const todas = await ler();
      const restantes = todas.filter((referencia) => referencia.id !== id);
      if (restantes.length === todas.length) return false;
      await gravar(restantes);
      return true;
    },

    async buscar(filtro) {
      const termos = filtro.texto ? termosDe(filtro.texto) : [];

      const resultados = (await ler())
        .filter((referencia) => !filtro.categoria || referencia.categoria === filtro.categoria)
        .filter((referencia) => !filtro.tipo || referencia.tipo === filtro.tipo)
        .map((referencia) => {
          const corpo = corpoDeBusca(referencia);
          return {
            referencia,
            termosEncontrados: termos.filter((termo) => corpo.includes(termo)).length,
          };
        })
        // Com texto na consulta, quem não casou com termo nenhum sai. Sem
        // texto, a busca é só o filtro e todos ficam.
        .filter((resultado) => termos.length === 0 || resultado.termosEncontrados > 0)
        .sort((a, b) => {
          if (b.termosEncontrados !== a.termosEncontrados) {
            return b.termosEncontrados - a.termosEncontrados;
          }
          // Empate resolvido pela data, da mais nova para a mais velha. Sem
          // este segundo critério a ordem seria a do arquivo, que é acidente.
          return b.referencia.data.localeCompare(a.referencia.data);
        });

      return filtro.limite === undefined ? resultados : resultados.slice(0, filtro.limite);
    },

    async porCategoria(categoria) {
      return (await ler()).filter((referencia) => referencia.categoria === categoria);
    },
  };
}
