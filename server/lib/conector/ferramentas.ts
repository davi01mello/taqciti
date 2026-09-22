/**
 * As ferramentas que o conector expõe, e a ordem em que elas querem ser
 * usadas.
 *
 * ── A progressão é o projeto ──────────────────────────────────────────────
 *
 *   buscar  →  ler  →  conteudo
 *   achar      situar   trazer o pedaço certo
 *
 * São quatro ferramentas (com `listar` ao lado de `buscar`) e não uma, porque
 * cada degrau custa uma ordem de grandeza a mais de contexto:
 *
 *   buscar    ~2 mil caracteres   doze trechos de doze itens
 *   listar    ~2 mil caracteres   vinte e cinco títulos, zero conteúdo
 *   ler       ~1,4 mil            um item: metadados e orientação
 *   conteudo  ~8 mil              uma FATIA do corpo, nunca o corpo
 *
 * Uma ferramenta só — `dame_a_reuniao(id)` — colapsaria isso no degrau mais
 * caro e o tornaria o único: toda pergunta, por menor que fosse, custaria a
 * transcrição inteira. Com a escada, "quem ficou de fazer o deploy?" custa
 * uma busca e uma fatia de quarenta falas.
 *
 * Os textos de `DESCRICOES` são parte do mecanismo, não documentação: é por
 * eles que o modelo aprende a escada. Cada um diz o que a ferramenta devolve,
 * quanto ela custa e qual é o próximo passo. Mudá-los muda o comportamento.
 *
 * ── E se o modelo insistir em pedir tudo ──────────────────────────────────
 *
 * Ele não consegue. `quantidade` é limitada por `Math.min` contra o teto, não
 * validada contra ele — pedir 10.000 falas devolve 40 e um `proximo`. O teto
 * não é uma regra que se possa violar; é o tamanho do balde.
 */
import { ORCAMENTO, type Resposta, achatar, aplicarTeto, cortar } from './orcamento';
import { type Acerto, buscar as buscarNoAcervo } from './busca';
import type {
  Acervo,
  ConversaDoAcervo,
  DocumentoDoAcervo,
  IndicePorTipo,
  ItemDoAcervo,
  NotaDoAcervo,
  ReuniaoDoAcervo,
  TipoDeItem,
} from './tipos';
import { TIPOS_DE_ITEM, comporId, separarId } from './tipos';

/**
 * Erro que o USUÁRIO da ferramenta causou — id inventado, tipo inexistente.
 *
 * Separado de um erro de verdade porque o destino é outro: isto vira um
 * resultado de ferramenta com `isError`, que o modelo lê e corrige sozinho na
 * chamada seguinte. Um 500 de JSON-RPC ele não lê — só quebra.
 */
export class ErroDeUso extends Error {}

// --------------------------------------------------------------- descrições

export const DESCRICOES = {
  buscar:
    'Procura um termo em TODO o acervo (reuniões, documentos, conversas e notas) e ' +
    'devolve até 12 trechos curtos, cada um com o id do item e a POSIÇÃO exata do ' +
    'acerto. Comece sempre por aqui. Use a `posicao` devolvida como `de` em ' +
    '`conteudo` para ler direto o trecho certo, sem carregar o item inteiro.',
  listar:
    'Enumera os itens de um tipo, do mais recente para o mais antigo, com título, ' +
    'data e um resumo de tamanho — SEM nenhum conteúdo. Use para saber o que existe ' +
    'quando não há termo para buscar. Paginado: no máximo 25 por vez.',
  ler:
    'Abre UM item pelo id: metadados, estrutura e as primeiras linhas para orientação. ' +
    'Não traz o corpo. Serve para decidir se vale ler o conteúdo e qual faixa pedir.',
  conteudo:
    'Traz uma FATIA do corpo de um item — nunca o corpo inteiro. Em reuniões e ' +
    'conversas a fatia é contada em falas/mensagens (máx. 40); em documentos e notas, ' +
    'em caracteres (máx. 8000). A resposta diz `total`, `mostrando` e `proximo`: ' +
    'para continuar, chame de novo com `de` = `proximo`.',
} as const;

// ------------------------------------------------------------------ buscar

export interface PedidoBuscar {
  consulta: string;
  tipos?: readonly string[];
  limite?: number;
}

function validarTipos(tipos: readonly string[] | undefined): TipoDeItem[] | undefined {
  if (!tipos?.length) return undefined;
  const invalidos = tipos.filter((t) => !(TIPOS_DE_ITEM as readonly string[]).includes(t));
  if (invalidos.length) {
    throw new ErroDeUso(
      `Tipo desconhecido: ${invalidos.join(', ')}. Os válidos são ${TIPOS_DE_ITEM.join(', ')}.`,
    );
  }
  return tipos as TipoDeItem[];
}

export async function ferramentaBuscar(
  acervo: Acervo,
  pedido: PedidoBuscar,
): Promise<Resposta<Acerto>> {
  if (!pedido.consulta?.trim()) {
    throw new ErroDeUso(
      'Informe `consulta`. Para enumerar sem termo de busca, use `listar`, que é paginado.',
    );
  }
  const acertos = await buscarNoAcervo(acervo, {
    consulta: pedido.consulta,
    tipos: validarTipos(pedido.tipos),
    limite: pedido.limite,
  });
  return aplicarTeto({
    itens: acertos,
    total: acertos.length,
    mostrando: acertos.length,
    ...(acertos.length === 0
      ? {
          aviso:
            'Nada casou. Tente menos palavras ou um sinônimo — a busca casa por ' +
            'prefixo e ignora acentos, mas não conhece sinônimos.',
        }
      : {}),
  });
}

// ------------------------------------------------------------------ listar

export interface EntradaDoIndice {
  id: string;
  tipo: TipoDeItem;
  titulo: string;
  data: string;
  /** Uma linha de tamanho: o que esperar se pedir o conteúdo. */
  resumo: string;
}

function minutos(segundos: number): string {
  const m = Math.round(segundos / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

function plural(n: number, um: string, muitos: string): string {
  return `${n} ${n === 1 ? um : muitos}`;
}

function soData(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function entradaDaReuniao(r: IndicePorTipo['reuniao']): EntradaDoIndice {
  return {
    id: comporId('reuniao', r.id),
    tipo: 'reuniao',
    titulo: r.titulo,
    data: soData(r.inicioMs),
    resumo: [
      plural(r.falas, 'fala', 'falas'),
      plural(r.participantes, 'participante', 'participantes'),
      minutos(r.duracaoSegundos),
    ].join(' · '),
  };
}

function entradaDoDocumento(d: IndicePorTipo['documento']): EntradaDoIndice {
  return {
    id: comporId('documento', d.id),
    tipo: 'documento',
    titulo: d.titulo,
    data: soData(d.criadoMs),
    resumo: [d.tipoGerado ?? 'documento', plural(d.caracteres, 'caractere', 'caracteres')].join(
      ' · ',
    ),
  };
}

function entradaDaConversa(c: IndicePorTipo['conversa']): EntradaDoIndice {
  return {
    id: comporId('conversa', c.id),
    tipo: 'conversa',
    titulo: c.titulo,
    data: soData(c.criadaMs),
    resumo: plural(c.mensagens, 'mensagem', 'mensagens'),
  };
}

function entradaDaNota(n: IndicePorTipo['nota']): EntradaDoIndice {
  return {
    id: comporId('nota', n.id),
    tipo: 'nota',
    titulo: `Notas — ${n.reuniaoTitulo}`,
    data: soData(n.atualizadaMs),
    resumo: [
      plural(n.caracteres, 'caractere', 'caracteres'),
      plural(n.marcacoes, 'marcação', 'marcações'),
      plural(n.prints, 'print', 'prints'),
    ].join(' · '),
  };
}

export interface PedidoListar {
  tipo: string;
  de?: number;
  quantidade?: number;
}

export async function ferramentaListar(
  acervo: Acervo,
  pedido: PedidoListar,
): Promise<Resposta<EntradaDoIndice>> {
  const [tipo] = validarTipos([pedido.tipo]) ?? [];
  if (!tipo) throw new ErroDeUso(`Informe \`tipo\`: ${TIPOS_DE_ITEM.join(', ')}.`);

  const todos = await acervo.indice(tipo);
  const entradas = todos.map((linha) => {
    switch (tipo) {
      case 'reuniao':
        return entradaDaReuniao(linha as IndicePorTipo['reuniao']);
      case 'documento':
        return entradaDoDocumento(linha as IndicePorTipo['documento']);
      case 'conversa':
        return entradaDaConversa(linha as IndicePorTipo['conversa']);
      default:
        return entradaDaNota(linha as IndicePorTipo['nota']);
    }
  });
  entradas.sort((a, b) => b.data.localeCompare(a.data));

  const de = Math.max(0, pedido.de ?? 0);
  const quantidade = Math.min(pedido.quantidade ?? ORCAMENTO.pagina, ORCAMENTO.pagina);
  const pagina = entradas.slice(de, de + quantidade);
  const fim = de + pagina.length;

  return aplicarTeto({
    itens: pagina,
    total: entradas.length,
    mostrando: pagina.length,
    ...(fim < entradas.length ? { proximo: fim } : {}),
  });
}

// --------------------------------------------------------------------- ler

export interface Envelope {
  id: string;
  tipo: TipoDeItem;
  titulo: string;
  data: string;
  /** Pares legíveis. Varia por tipo — é o que `ler` existe para mostrar. */
  sobre: Record<string, string>;
  /** As primeiras linhas, só para orientar. Não é o conteúdo. */
  abertura: string;
  /** Em que unidade `conteudo` fatia este item, e quanto existe ao todo. */
  corpo: { unidade: 'falas' | 'mensagens' | 'caracteres'; total: number };
  /** A chamada exata que traz o começo do corpo. */
  comoLer: string;
}

async function acharItem(
  acervo: Acervo,
  idComposto: string,
): Promise<{ tipo: TipoDeItem; item: ItemDoAcervo }> {
  const partes = separarId(idComposto);
  if (!partes) {
    throw new ErroDeUso(
      `\`${idComposto}\` não é um id válido. O formato é "tipo:id" — por exemplo ` +
        `"reuniao:abc-123". Use \`buscar\` ou \`listar\` para obter ids reais.`,
    );
  }
  const item = await acervo.obter(partes.tipo, partes.id);
  if (!item) {
    throw new ErroDeUso(
      `Nada encontrado com o id \`${idComposto}\`. Ele pode ter sido apagado; ` +
        `confirme com \`listar\` ou \`buscar\`.`,
    );
  }
  return { tipo: partes.tipo, item };
}

function envelopeDaReuniao(r: ReuniaoDoAcervo): Envelope {
  const falantes = [...new Set(r.falas.map((f) => f.falante).filter(Boolean))] as string[];
  return {
    id: comporId('reuniao', r.id),
    tipo: 'reuniao',
    titulo: r.titulo,
    data: soData(r.inicioMs),
    sobre: {
      duração: minutos(r.duracaoSegundos),
      participantes: r.participantes.join(', ') || '(nenhum registrado)',
      // Quem FALOU é diferente de quem estava presente, e a diferença costuma
      // ser a resposta de "quem não se manifestou?".
      falaram: falantes.join(', ') || '(nenhum identificado)',
    },
    abertura: cortar(
      achatar(r.falas.slice(0, 5).map((f) => `${f.falante ?? '?'}: ${f.texto}`).join(' ')),
      ORCAMENTO.envelope,
    ),
    corpo: { unidade: 'falas', total: r.falas.length },
    comoLer: `conteudo(id: "${comporId('reuniao', r.id)}", de: 0)`,
  };
}

function envelopeDoDocumento(d: DocumentoDoAcervo): Envelope {
  return {
    id: comporId('documento', d.id),
    tipo: 'documento',
    titulo: d.titulo,
    data: soData(d.criadoMs),
    sobre: {
      tipo: d.tipoGerado ?? 'documento',
      atualizado: soData(d.atualizadoMs),
      ...(d.reuniaoId ? { daReunião: comporId('reuniao', d.reuniaoId) } : {}),
    },
    abertura: cortar(achatar(d.texto), ORCAMENTO.envelope),
    corpo: { unidade: 'caracteres', total: d.texto.length },
    comoLer: `conteudo(id: "${comporId('documento', d.id)}", de: 0)`,
  };
}

function envelopeDaConversa(c: ConversaDoAcervo): Envelope {
  return {
    id: comporId('conversa', c.id),
    tipo: 'conversa',
    titulo: c.titulo,
    data: soData(c.criadaMs),
    sobre: {
      atualizada: soData(c.atualizadaMs),
      ...(c.reuniaoId ? { sobreAReunião: comporId('reuniao', c.reuniaoId) } : {}),
    },
    abertura: cortar(
      achatar(c.mensagens.slice(0, 3).map((m) => `${m.autor}: ${m.texto}`).join(' ')),
      ORCAMENTO.envelope,
    ),
    corpo: { unidade: 'mensagens', total: c.mensagens.length },
    comoLer: `conteudo(id: "${comporId('conversa', c.id)}", de: 0)`,
  };
}

function envelopeDaNota(n: NotaDoAcervo): Envelope {
  const marcas = Object.entries(n.marcacoes)
    .map(([tipo, quantas]) => `${quantas} ${tipo}`)
    .join(', ');
  return {
    id: comporId('nota', n.id),
    tipo: 'nota',
    titulo: `Notas — ${n.reuniaoTitulo}`,
    data: soData(n.atualizadaMs),
    sobre: {
      daReunião: comporId('reuniao', n.reuniaoId),
      marcações: marcas || '(nenhuma)',
      // Dito explicitamente porque a alternativa é o modelo pedir a imagem e
      // receber um erro seco, sem entender que a recusa é de projeto.
      prints: `${n.prints} (as imagens não são expostas pelo conector)`,
    },
    abertura: cortar(achatar(n.texto), ORCAMENTO.envelope),
    corpo: { unidade: 'caracteres', total: n.texto.length },
    comoLer: `conteudo(id: "${comporId('nota', n.id)}", de: 0)`,
  };
}

export async function ferramentaLer(acervo: Acervo, id: string): Promise<Envelope> {
  const { tipo, item } = await acharItem(acervo, id);
  switch (tipo) {
    case 'reuniao':
      return envelopeDaReuniao(item as ReuniaoDoAcervo);
    case 'documento':
      return envelopeDoDocumento(item as DocumentoDoAcervo);
    case 'conversa':
      return envelopeDaConversa(item as ConversaDoAcervo);
    default:
      return envelopeDaNota(item as NotaDoAcervo);
  }
}

// ---------------------------------------------------------------- conteudo

export interface PedacoDeCorpo {
  /** A coordenada deste pedaço — índice da fala/mensagem, ou deslocamento. */
  em: number;
  /** Quem falou. Só em reuniões e conversas. */
  autor?: string;
  texto: string;
}

export interface Corpo extends Resposta<PedacoDeCorpo> {
  id: string;
  unidade: 'falas' | 'mensagens' | 'caracteres';
}

/**
 * Fatia uma lista (falas, mensagens) respeitando os DOIS tetos.
 *
 * Dois, porque um só não segura: quarenta falas de uma palavra cabem
 * folgadamente, e quarenta falas de um parágrafo cada estouram. O corte por
 * caractere é o que impede que o teto de itens vire uma promessa vazia.
 */
function fatiarLista(
  pedacos: PedacoDeCorpo[],
  de: number,
  quantidade: number,
): { fatia: PedacoDeCorpo[]; cortadoPorTamanho: boolean } {
  const teto = Math.min(quantidade, ORCAMENTO.falas);
  const candidatos = pedacos.slice(de, de + teto);
  const fatia: PedacoDeCorpo[] = [];
  let acumulado = 0;
  for (const p of candidatos) {
    acumulado += p.texto.length;
    if (acumulado > ORCAMENTO.fatia && fatia.length > 0) {
      return { fatia, cortadoPorTamanho: true };
    }
    fatia.push(p);
  }
  return { fatia, cortadoPorTamanho: false };
}

function corpoDeLista(
  id: string,
  unidade: 'falas' | 'mensagens',
  pedacos: PedacoDeCorpo[],
  de: number,
  quantidade: number,
): Corpo {
  const { fatia, cortadoPorTamanho } = fatiarLista(pedacos, de, quantidade);
  const fim = de + fatia.length;
  return {
    id,
    unidade,
    itens: fatia,
    total: pedacos.length,
    mostrando: fatia.length,
    ...(fim < pedacos.length ? { proximo: fim } : {}),
    ...(cortadoPorTamanho
      ? {
          aviso:
            `A fatia parou em ${fatia.length} ${unidade} para caber em ` +
            `${ORCAMENTO.fatia} caracteres. Continue com \`de\` = \`proximo\`.`,
        }
      : {}),
  };
}

function corpoDeTexto(id: string, texto: string, de: number): Corpo {
  const comeco = Math.max(0, Math.min(de, texto.length));
  const fatia = texto.slice(comeco, comeco + ORCAMENTO.fatia);
  const fim = comeco + fatia.length;
  return {
    id,
    unidade: 'caracteres',
    itens: fatia ? [{ em: comeco, texto: fatia }] : [],
    total: texto.length,
    mostrando: fatia.length,
    ...(fim < texto.length ? { proximo: fim } : {}),
  };
}

export interface PedidoConteudo {
  id: string;
  de?: number;
  quantidade?: number;
}

export async function ferramentaConteudo(
  acervo: Acervo,
  pedido: PedidoConteudo,
): Promise<Corpo> {
  const { tipo, item } = await acharItem(acervo, pedido.id);
  const de = Math.max(0, pedido.de ?? 0);
  const quantidade = pedido.quantidade ?? ORCAMENTO.falas;

  switch (tipo) {
    case 'reuniao': {
      const r = item as ReuniaoDoAcervo;
      const pedacos = r.falas.map<PedacoDeCorpo>((f, i) => ({
        em: i,
        ...(f.falante ? { autor: f.falante } : {}),
        texto: f.texto,
      }));
      return aplicarTeto(corpoDeLista(pedido.id, 'falas', pedacos, de, quantidade));
    }
    case 'conversa': {
      const c = item as ConversaDoAcervo;
      const pedacos = c.mensagens.map<PedacoDeCorpo>((m, i) => ({
        em: i,
        autor: m.autor,
        texto: m.texto,
      }));
      return aplicarTeto(corpoDeLista(pedido.id, 'mensagens', pedacos, de, quantidade));
    }
    case 'documento':
      return aplicarTeto(corpoDeTexto(pedido.id, (item as DocumentoDoAcervo).texto, de));
    default:
      return aplicarTeto(corpoDeTexto(pedido.id, (item as NotaDoAcervo).texto, de));
  }
}
