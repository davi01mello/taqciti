/**
 * A busca do conector. É a porta de entrada, e ela foi desenhada para que a
 * SEGUNDA chamada seja barata.
 *
 * ── O que um resultado precisa carregar ───────────────────────────────────
 *
 * Uma busca que devolve só "achei na reunião X" obriga a próxima chamada a
 * ler a reunião X inteira para descobrir onde. Duas chamadas, e a segunda
 * custa a transcrição toda — exatamente o que o orçamento existe para evitar.
 *
 * Por isso todo acerto carrega `posicao`: o índice da fala (reunião), da
 * mensagem (conversa) ou o deslocamento em caracteres (documento, nota) onde
 * o termo apareceu. A IA pede `conteudo(id, de: posicao)` e cai em cima do
 * trecho, sem ler nada em volta que não pediu.
 *
 * ── Por que não é busca do banco ──────────────────────────────────────────
 *
 * Postgres tem busca textual boa, e um dia ela entra aqui. Hoje não entra por
 * dois motivos: o acervo de um usuário é pequeno (dezenas de reuniões, não
 * milhões), e a busca precisa rodar contra o acervo de MEMÓRIA nos testes —
 * que é onde a disciplina de contexto é de fato verificada. Ranquear em
 * TypeScript mantém o mesmo resultado nos dois, e o dia em que o acervo
 * crescer a ponto de isto doer, a assinatura de `buscar` não muda.
 */
import { ORCAMENTO, achatar, cortar } from './orcamento';
import type {
  Acervo,
  ConversaDoAcervo,
  DocumentoDoAcervo,
  IdDoConector,
  NotaDoAcervo,
  ReuniaoDoAcervo,
  TipoDeItem,
} from './tipos';
import { TIPOS_DE_ITEM, comporId } from './tipos';

export interface Acerto {
  id: IdDoConector;
  tipo: TipoDeItem;
  titulo: string;
  /** ISO 8601, só a data — hora não ajuda a escolher um resultado. */
  data: string;
  /** O texto em volta do termo, já cortado no teto. */
  trecho: string;
  /**
   * Onde o termo está, no sistema de coordenadas do tipo:
   * reunião → índice da fala; conversa → índice da mensagem;
   * documento e nota → deslocamento em caracteres.
   *
   * É este número que vai em `conteudo(id, de: …)`.
   */
  posicao: number;
  /** Quanto o item casou. Só serve para ordenar; não tem unidade. */
  relevancia: number;
}

/**
 * Tira acento e caixa.
 *
 * Obrigatório, não cosmético: a transcrição vem do Meet com acentuação certa
 * e quem pergunta digita "reuniao" e "orcamento" tanto quanto "reunião" e
 * "orçamento". Sem dobrar os dois lados, metade das buscas legítimas volta
 * vazia — e uma busca vazia manda a IA ler tudo, que é o pior caso.
 */
export function dobrar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Os termos da consulta, sem ruído. */
function termosDe(consulta: string): string[] {
  return dobrar(consulta)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Um pedaço de texto pesquisável, com a coordenada de onde ele começa.
 *
 * Todo tipo é reduzido a uma lista disto, e daí para frente a busca não sabe
 * mais se está olhando uma reunião ou um documento — o que mantém o
 * ranqueamento idêntico entre as coleções.
 */
interface Pedaco {
  texto: string;
  posicao: number;
}

function pedacosDaReuniao(r: ReuniaoDoAcervo): Pedaco[] {
  return r.falas.map((f, i) => ({
    texto: f.falante ? `${f.falante}: ${f.texto}` : f.texto,
    posicao: i,
  }));
}

function pedacosDaConversa(c: ConversaDoAcervo): Pedaco[] {
  return c.mensagens.map((m, i) => ({ texto: m.texto, posicao: i }));
}

/**
 * Texto corrido vira pedaços por parágrafo, com o deslocamento acumulado.
 *
 * Parágrafo, e não frase: é a unidade que a pessoa reconhece ao reabrir o
 * documento, e é a mesma que `conteudo` usa para fatiar — as duas coordenadas
 * precisam falar a mesma língua, senão `de: posicao` cai no lugar errado.
 */
function pedacosDoTexto(texto: string): Pedaco[] {
  const pedacos: Pedaco[] = [];
  let posicao = 0;
  for (const paragrafo of texto.split(/\n{2,}/)) {
    if (paragrafo.trim()) pedacos.push({ texto: paragrafo, posicao });
    // +2 pela quebra dupla que o split consumiu.
    posicao += paragrafo.length + 2;
  }
  return pedacos;
}

/**
 * Prefixo de PALAVRA, não pedaço de palavra.
 *
 * A primeira versão usava `indexOf`, e isso é substring em qualquer posição:
 * procurar por "ana" casava com "semana" e "planejar". Num acervo de
 * reuniões, onde metade dos termos úteis é nome de gente, esse é o modo de
 * falhar mais provável que existe — e ele não falha alto, só enche o
 * resultado de lixo bem ranqueado.
 *
 * `\b` antes do termo resolve, e resolve DUAS coisas: a busca fica correta, e
 * a semântica passa a ser a mesma de um `tsquery` com `:*`. É isso que
 * permite a um acervo sobre banco usar o índice de texto como peneira sem
 * descartar nada que este ranqueamento aceitaria.
 *
 * Os termos vêm de `termosDe`, que só deixa passar `[a-z0-9]` — por isso não
 * há escape de regex aqui; não há o que escapar.
 */
function regexDoTermo(termo: string): RegExp {
  return new RegExp(`\\b${termo}`, 'g');
}

function contar(texto: string, termos: string[]): number {
  const dobrado = dobrar(texto);
  let total = 0;
  for (const termo of termos) {
    total += (dobrado.match(regexDoTermo(termo)) ?? []).length;
  }
  return total;
}

/** O pedaço que mais casou, e o quanto. */
function melhorPedaco(
  pedacos: Pedaco[],
  termos: string[],
): { pedaco: Pedaco; acertos: number } | null {
  let melhor: { pedaco: Pedaco; acertos: number } | null = null;
  for (const pedaco of pedacos) {
    const acertos = contar(pedaco.texto, termos);
    if (acertos > 0 && (!melhor || acertos > melhor.acertos)) {
      melhor = { pedaco, acertos };
    }
  }
  return melhor;
}

/**
 * O trecho em volta do termo — centrado nele, não do começo do pedaço.
 *
 * Começar do início do parágrafo devolveria, numa fala longa, os primeiros
 * 260 caracteres de algo cujo termo está no fim: o trecho não mostraria o que
 * a busca encontrou, que é a única coisa que ele precisa mostrar.
 */
function trechoEmVolta(texto: string, termos: string[]): string {
  const achatado = achatar(texto);
  if (achatado.length <= ORCAMENTO.trecho) return achatado;

  const dobrado = dobrar(achatado);
  let onde = -1;
  for (const termo of termos) {
    // Mesma regra de `contar`: prefixo de palavra. Se as duas divergissem, o
    // trecho poderia ser centrado num casamento que o ranqueamento ignorou.
    const achou = regexDoTermo(termo).exec(dobrado)?.index ?? -1;
    if (achou !== -1 && (onde === -1 || achou < onde)) onde = achou;
  }
  if (onde === -1) return cortar(achatado, ORCAMENTO.trecho);

  const folga = Math.floor((ORCAMENTO.trecho - 20) / 2);
  const comeco = Math.max(0, onde - folga);
  const janela = achatado.slice(comeco, comeco + ORCAMENTO.trecho - 2);
  return (comeco > 0 ? '…' : '') + cortar(janela, ORCAMENTO.trecho - 2);
}

function soData(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Peso por casamento no TÍTULO.
 *
 * Um acerto no título vale mais do que um no corpo — quem procura "retro de
 * agosto" quer a reunião chamada assim, não as trinta em que alguém disse
 * "retro". Três é o bastante para o título ganhar de um punhado de menções
 * sem afogar um corpo que casou muitas vezes.
 */
const PESO_DO_TITULO = 3;

interface Candidato {
  id: IdDoConector;
  tipo: TipoDeItem;
  titulo: string;
  data: string;
  pedacos: Pedaco[];
}

function candidatoDaReuniao(r: ReuniaoDoAcervo): Candidato {
  return {
    id: comporId('reuniao', r.id),
    tipo: 'reuniao',
    titulo: r.titulo,
    data: soData(r.inicioMs),
    pedacos: pedacosDaReuniao(r),
  };
}

function candidatoDoDocumento(d: DocumentoDoAcervo): Candidato {
  return {
    id: comporId('documento', d.id),
    tipo: 'documento',
    titulo: d.titulo,
    data: soData(d.criadoMs),
    pedacos: pedacosDoTexto(d.texto),
  };
}

function candidatoDaConversa(c: ConversaDoAcervo): Candidato {
  return {
    id: comporId('conversa', c.id),
    tipo: 'conversa',
    titulo: c.titulo,
    data: soData(c.criadaMs),
    pedacos: pedacosDaConversa(c),
  };
}

function candidatoDaNota(n: NotaDoAcervo): Candidato {
  return {
    id: comporId('nota', n.id),
    tipo: 'nota',
    titulo: `Notas — ${n.reuniaoTitulo}`,
    data: soData(n.atualizadaMs),
    pedacos: pedacosDoTexto(n.texto),
  };
}

/**
 * Pede ao acervo a peneira grossa e monta os candidatos.
 *
 * Os termos vão junto porque é com eles que um acervo sobre banco descarta o
 * que não tem chance, por índice, antes de materializar JSONB nenhum. O
 * acervo de memória ignora os termos e devolve tudo — as duas coisas cumprem
 * o mesmo contrato, e o ranqueamento abaixo é idêntico nos dois casos.
 */
async function candidatos(
  acervo: Acervo,
  tipos: readonly TipoDeItem[],
  termos: readonly string[],
): Promise<Candidato[]> {
  const saida: Candidato[] = [];
  for (const tipo of tipos) {
    switch (tipo) {
      case 'reuniao':
        for (const r of await acervo.procurar('reuniao', termos)) {
          saida.push(candidatoDaReuniao(r));
        }
        break;
      case 'documento':
        for (const d of await acervo.procurar('documento', termos)) {
          saida.push(candidatoDoDocumento(d));
        }
        break;
      case 'conversa':
        for (const c of await acervo.procurar('conversa', termos)) {
          saida.push(candidatoDaConversa(c));
        }
        break;
      case 'nota':
        for (const n of await acervo.procurar('nota', termos)) {
          saida.push(candidatoDaNota(n));
        }
        break;
    }
  }
  return saida;
}

export interface PedidoDeBusca {
  consulta: string;
  tipos?: readonly TipoDeItem[];
  limite?: number;
}

/**
 * Busca em tudo (ou nos tipos pedidos) e devolve acertos ordenados.
 *
 * Consulta sem termo aproveitável devolve vazio em vez de tudo. Parece
 * antipático, e é de propósito: "devolver tudo" é o caminho exato pelo qual a
 * janela de contexto acaba. Quem quer enumerar tem `listar`, que é paginado.
 */
export async function buscar(
  acervo: Acervo,
  pedido: PedidoDeBusca,
): Promise<Acerto[]> {
  const termos = termosDe(pedido.consulta);
  if (termos.length === 0) return [];

  const tipos = pedido.tipos?.length ? pedido.tipos : TIPOS_DE_ITEM;
  const limite = Math.min(pedido.limite ?? ORCAMENTO.hits, ORCAMENTO.hits);

  const acertos: Acerto[] = [];
  for (const c of await candidatos(acervo, tipos, termos)) {
    const noTitulo = contar(c.titulo, termos) * PESO_DO_TITULO;
    const melhor = melhorPedaco(c.pedacos, termos);
    const relevancia = noTitulo + (melhor?.acertos ?? 0);
    if (relevancia === 0) continue;

    // Casou só no título: o trecho vira o começo do item, que é a melhor
    // orientação disponível quando o corpo não tem o termo.
    const base = melhor?.pedaco ?? c.pedacos[0];
    acertos.push({
      id: c.id,
      tipo: c.tipo,
      titulo: c.titulo,
      data: c.data,
      trecho: base ? trechoEmVolta(base.texto, termos) : '(sem conteúdo)',
      posicao: base?.posicao ?? 0,
      relevancia,
    });
  }

  // Empate desfeito pela data, mais recente primeiro: entre dois acertos
  // igualmente bons, o de ontem quase sempre é o procurado.
  acertos.sort((a, b) => b.relevancia - a.relevancia || b.data.localeCompare(a.data));
  return acertos.slice(0, limite);
}
