/**
 * A extensão espelha o acervo aqui.
 *
 * Um POST leva um lote de itens já no formato do conector
 * (`lib/conector/tipos.ts`) e uma lista do que foi apagado. Tudo é upsert,
 * então reenviar é inofensivo — é o que permite ao cliente ser burro e
 * simplesmente mandar o que mudou desde a última vez, sem levar em conta o
 * que chegou.
 *
 *   curl -X POST https://<servidor>/api/sync \
 *     -H "Authorization: Bearer $TOKEN_DO_GOOGLE" \
 *     -H "Content-Type: application/json" \
 *     -d '{"itens":[{"tipo":"reuniao","item":{...}}],"apagados":[]}'
 *
 * ── Por que o lote é limitado ─────────────────────────────────────────────
 *
 * A primeira sincronização de quem já usa o TaqCiti há meses pode ser
 * centenas de reuniões. Sem teto, ela vira uma requisição de dezenas de
 * megabytes que estoura memória, tempo de resposta e o limite do proxy — e
 * falha INTEIRA, para recomeçar do zero na tentativa seguinte. Com teto, o
 * cliente manda em pedaços e cada pedaço que chega fica.
 *
 * ── A volta: GET ──────────────────────────────────────────────────────────
 *
 * Outra máquina da mesma conta traz o acervo de volta com
 * GET /api/sync?desde=<seq>: a cópia fiel de tudo que mudou depois do cursor,
 * em páginas, com lápide para o que foi apagado (copia.ts). A resposta traz
 * proximo (o cursor para a chamada seguinte) e im. É pessoa-a-pessoa: o
 * pessoa_id vem do token, nunca de parâmetro.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders } from '@/lib/apiGuard';
import { autenticar } from '@/lib/identidade/rota';
import { apagarItem, gravarItem } from '@/lib/conector/escrita';
import { TIPOS_DE_ITEM, type ItemPorTipo, type TipoDeItem } from '@/lib/conector/tipos';
import { TIPO_COPIA, gravarCopia, lerCopias, tamanhoDaCopia, validarCopia, type CopiaRecebida } from '@/lib/conector/copia';
import { TIPO_PRINT, apagarPrint, gravarPrint, validarPrint, type PrintRecebido } from '@/lib/conector/prints';
import { bancoCheio, contarItens, cotaDaPessoaBytes, purgarLapides, tamanhoAtual, usoDaPessoa } from '@/lib/conector/cota';
import { MAX_ID, maxItensPorTipo, validarProjecao } from '@/lib/conector/projecoes';
import {
  TIPO_HISTORICO,
  apagarHistorico,
  gravarHistorico,
  tamanhoDoHistorico,
  validarHistorico,
  type HistoricoDoDocumento,
} from '@/lib/conector/historico';

/**
 * Itens por requisição. O cliente fatia; ver o cabeçalho.
 *
 * 100 e não 50 porque cada reunião, documento, conversa ou nota viaja em DOIS
 * itens: a projeção do conector e a cópia fiel (copia.ts).
 */
const MAX_POR_LOTE = 100;
/** Teto do corpo, como segunda barreira: 50 reuniões longas ainda são muito. */
const MAX_CORPO_BYTES = 8 * 1024 * 1024;

const METODOS = 'GET, POST, OPTIONS';

export function OPTIONS(request: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin'), METODOS),
  });
}

function ehTipo(v: unknown): v is TipoDeItem {
  return typeof v === 'string' && (TIPOS_DE_ITEM as readonly string[]).includes(v);
}

type Entrada =
  | { tipo: TipoDeItem; item: ItemPorTipo[TipoDeItem] }
  | { tipo: typeof TIPO_HISTORICO; item: HistoricoDoDocumento }
  | { tipo: typeof TIPO_COPIA; item: CopiaRecebida }
  | { tipo: typeof TIPO_PRINT; item: PrintRecebido };

/** O que a rota recusou sem derrubar o lote: o cliente registra e segue. */
interface Recusado {
  tipo: string;
  id: string;
  motivo: string;
  /**
   * colecao:id, a chave que a extensão usa. Presente nas recusas TEMPORÁRIAS.
   */
  chave?: string;
  /**
   * 	rue quando recusar não é definitivo (cota cheia): o item volta a ser
   * tentado quando houver espaço, e a extensão NÃO o dá como enviado. Ausente
   * é recusa por formato — reenviar o mesmo item só o recusaria de novo.
   */
  temporario?: boolean;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const headers = corsHeaders(request.headers.get('origin'), METODOS);
  const auth = await autenticar(request, headers);
  if (!auth.ok) return auth.resposta;

  const tamanho = Number(request.headers.get('content-length') ?? 0);
  if (tamanho > MAX_CORPO_BYTES) {
    return NextResponse.json(
      { error: `Lote acima de ${MAX_CORPO_BYTES} bytes. Mande em pedaços menores.` },
      { status: 413, headers },
    );
  }

  let corpo: { itens?: unknown; apagados?: unknown };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: 'Corpo precisa ser JSON válido.' }, { status: 400, headers });
  }

  const itensBrutos = Array.isArray(corpo.itens) ? corpo.itens : [];
  const apagadosBrutos = Array.isArray(corpo.apagados) ? corpo.apagados : [];

  if (itensBrutos.length + apagadosBrutos.length > MAX_POR_LOTE) {
    return NextResponse.json(
      { error: `No máximo ${MAX_POR_LOTE} itens por lote.` },
      { status: 413, headers },
    );
  }

  const entradas: Entrada[] = [];
  const recusados: Recusado[] = [];
  for (const bruto of itensBrutos) {
    const e = bruto as { tipo?: unknown; item?: unknown };
    if (e.tipo !== TIPO_HISTORICO && e.tipo !== TIPO_COPIA && e.tipo !== TIPO_PRINT && !ehTipo(e.tipo)) {
      return NextResponse.json(
        { error: 'Cada item precisa de `tipo` conhecido e `item` objeto.' },
        { status: 400, headers },
      );
    }
    if (typeof e.item !== 'object' || e.item === null) {
      return NextResponse.json(
        { error: 'Cada item precisa de `tipo` conhecido e `item` objeto.' },
        { status: 400, headers },
      );
    }
    if (typeof (e.item as { id?: unknown }).id !== 'string') {
      return NextResponse.json({ error: 'Cada item precisa de `id`.' }, { status: 400, headers });
    }
    if (e.tipo === TIPO_HISTORICO) {
      // O corpo é uma árvore de documento aninhada: valida antes de gravar, e
      // um histórico torto é RECUSADO, não derruba os outros itens do lote.
      const v = validarHistorico(e.item);
      if (v.ok) entradas.push({ tipo: TIPO_HISTORICO, item: v.item });
      else recusados.push({ tipo: TIPO_HISTORICO, id: String((e.item as { id?: unknown }).id), motivo: v.motivo });
      continue;
    }
    if (e.tipo === TIPO_COPIA) {
      // Mesmo trato do histórico: corpo torto é recusado com motivo, e o resto do
      // lote segue. Reenviar o mesmo corpo só o recusaria de novo.
      const v = validarCopia(e.item);
      if (v.ok) entradas.push({ tipo: TIPO_COPIA, item: v.item });
      else recusados.push({ tipo: TIPO_COPIA, id: String((e.item as { id?: unknown }).id), motivo: v.motivo });
      continue;
    }
    if (e.tipo === TIPO_PRINT) {
      const v = validarPrint(e.item);
      if (v.ok) entradas.push({ tipo: TIPO_PRINT, item: v.item });
      else recusados.push({ tipo: TIPO_PRINT, id: String((e.item as { id?: unknown }).id), motivo: v.motivo });
      continue;
    }
    // As projeções do conector também passam por schema e teto (projecoes.ts):
    // antes entravam com um `as` e nada mais.
    const v = validarProjecao(e.tipo as TipoDeItem, e.item);
    if (v.ok) entradas.push({ tipo: e.tipo as TipoDeItem, item: v.item });
    else recusados.push({ tipo: String(e.tipo), id: String((e.item as { id?: unknown }).id).slice(0, MAX_ID), motivo: v.motivo });
  }

  const remocoes: { tipo: TipoDeItem | typeof TIPO_HISTORICO | typeof TIPO_PRINT; id: string }[] = [];
  for (const bruto of apagadosBrutos) {
    const a = bruto as { tipo?: unknown; id?: unknown };
    if (
      (a.tipo !== TIPO_HISTORICO && a.tipo !== TIPO_PRINT && !ehTipo(a.tipo)) ||
      typeof a.id !== 'string' ||
      a.id.length > MAX_ID
    ) {
      return NextResponse.json(
        { error: 'Cada apagado precisa de `tipo` e `id`.' },
        { status: 400, headers },
      );
    }
    remocoes.push({ tipo: a.tipo as TipoDeItem | typeof TIPO_HISTORICO | typeof TIPO_PRINT, id: a.id });
  }

  /*
   * Em sequência, e não em paralelo.
   *
   * O ganho de `Promise.all` aqui seria pequeno (o pool tem cinco conexões) e
   * o custo é concreto: com escritas concorrentes, uma falha no meio deixa um
   * conjunto imprevisível de itens gravados, e o cliente não teria como saber
   * onde recomeçar. Em sequência, `gravados` é exatamente quantos entraram, e
   * reenviar a partir dali é seguro porque tudo é upsert.
   */
  /*
   * A cota só é cobrada de quem enche o banco: cópias, prints e histórico. As
   * projeções do conector e as exclusões passam sempre — exclusão LIBERA espaço,
   * e recusá-la deixaria quem está cheio sem como sair.
   */
  const cobrados = entradas.some(
    (e) => e.tipo === TIPO_COPIA || e.tipo === TIPO_PRINT || e.tipo === TIPO_HISTORICO,
  );
  const projecoes = entradas.some((e) => ehTipo(e.tipo));
  const cota = cotaDaPessoaBytes();
  let uso = 0;
  let cheio = false;
  /** Por tipo de projeção: a pessoa já chegou ao teto de linhas? Medido uma vez por lote. */
  const tipoCheio = new Map<TipoDeItem, boolean>();

  let gravados = 0;
  try {
    /*
     * As exclusões ANTES das gravações, e o uso medido DEPOIS delas. Quem está
     * na cota apaga um print e manda outro no mesmo lote: se as gravações viessem
     * primeiro, o espaço do apagado ainda contaria e o novo seria recusado — para
     * entrar só meia hora depois, com a pausa da extensão.
     */
    for (const { tipo, id } of remocoes) {
      if (tipo === TIPO_HISTORICO) await apagarHistorico(auth.pessoaId, id);
      else if (tipo === TIPO_PRINT) await apagarPrint(auth.pessoaId, id);
      else await apagarItem(auth.pessoaId, tipo, id);
    }
    if (cobrados) {
      [uso, cheio] = await Promise.all([usoDaPessoa(auth.pessoaId), bancoCheio()]);
    } else if (projecoes) {
      cheio = await bancoCheio();
    }
    for (const entrada of entradas) {
      if (ehTipo(entrada.tipo)) {
        // Projeções não têm cota em bytes (a cópia fiel do mesmo item já é
        // cobrada), mas respeitam o disjuntor global e um teto de linhas por tipo.
        if (!tipoCheio.has(entrada.tipo)) {
          tipoCheio.set(entrada.tipo, (await contarItens(auth.pessoaId, entrada.tipo)) >= maxItensPorTipo());
        }
        const motivo = cheio
          ? 'cota-global: o banco do servidor está cheio; tente de novo mais tarde.'
          : tipoCheio.get(entrada.tipo)
            ? `cota: esta conta chegou a ${maxItensPorTipo()} itens do tipo ${entrada.tipo}.`
            : null;
        if (motivo) {
          recusados.push({ tipo: entrada.tipo, id: entrada.item.id, motivo, chave: `${entrada.tipo}:${entrada.item.id}`, temporario: true });
          continue;
        }
      }
      if (entrada.tipo === TIPO_COPIA || entrada.tipo === TIPO_PRINT || entrada.tipo === TIPO_HISTORICO) {
        const ident =
          entrada.tipo === TIPO_COPIA
            ? { tabela: 'copia_local' as const, chave: { colecao: entrada.item.colecao, id: entrada.item.id }, nome: `${entrada.item.colecao}:${entrada.item.id}`, tamanho: tamanhoDaCopia(entrada.item) }
            : entrada.tipo === TIPO_PRINT
              ? { tabela: 'print_local' as const, chave: { id: entrada.item.id }, nome: `print:${entrada.item.id}`, tamanho: entrada.item.bytes.length }
              : { tabela: 'historico_do_documento' as const, chave: { id: entrada.item.id }, nome: `historico:${entrada.item.id}`, tamanho: tamanhoDoHistorico(entrada.item) };
        // Numa edição só a DIFERENÇA conta: reescrever o mesmo documento não
        // pode ser barrado por quem está perto do teto.
        const delta = ident.tamanho - (await tamanhoAtual(ident.tabela, auth.pessoaId, ident.chave));
        const motivo =
          delta > 0 && cheio
            ? 'cota-global: o banco do servidor está cheio; tente de novo mais tarde.'
            : delta > 0 && uso + delta > cota
              ? `cota: o acervo desta conta chegou a ${Math.round(cota / 1024 / 1024)} MB; apague algo para liberar espaço.`
              : null;
        if (motivo) {
          recusados.push({ tipo: entrada.tipo, id: entrada.item.id, motivo, chave: ident.nome, temporario: true });
          continue;
        }
        uso += delta;
      }
      if (entrada.tipo === TIPO_HISTORICO) await gravarHistorico(auth.pessoaId, entrada.item);
      else if (entrada.tipo === TIPO_COPIA) await gravarCopia(auth.pessoaId, entrada.item);
      else if (entrada.tipo === TIPO_PRINT) await gravarPrint(auth.pessoaId, entrada.item);
      else await gravarItem(auth.pessoaId, entrada.tipo, entrada.item);
      gravados += 1;
    }
    // As lápides velhas saem aos poucos, de carona nas escritas — sem agendador.
    if ((gravados > 0 || remocoes.length > 0) && Math.random() < 0.1) {
      await purgarLapides(auth.pessoaId).catch((erro) => console.error('[api/sync] limpeza de lápides', erro));
    }
  } catch (erro) {
    console.error('[api/sync] falha ao gravar', erro);
    return NextResponse.json(
      {
        error: 'Falha ao gravar o lote.',
        // Quantos entraram ANTES da falha. O cliente reenvia a partir daqui —
        // ou reenvia tudo, que dá no mesmo porque é upsert.
        gravados,
      },
      { status: 500, headers },
    );
  }

  return NextResponse.json(
    {
      gravados,
      apagados: remocoes.length,
      ...(cobrados ? { uso: { bytes: uso, cota } } : {}),
      ...(recusados.length > 0 ? { recusados } : {}),
    },
    { status: 200, headers },
  );
}
export async function GET(request: NextRequest): Promise<NextResponse> {
  const headers = corsHeaders(request.headers.get('origin'), METODOS);
  const auth = await autenticar(request, headers);
  if (!auth.ok) return auth.resposta;

  const bruto = request.nextUrl.searchParams.get('desde');
  const desde = bruto === null || bruto === '' ? 0 : Number(bruto);
  if (!Number.isInteger(desde) || desde < 0) {
    return NextResponse.json({ error: '`desde` precisa ser um inteiro >= 0.' }, { status: 400, headers });
  }

  try {
    const pagina = await lerCopias(auth.pessoaId, desde);
    // `no-store`: a resposta é o acervo de UMA pessoa, e um cache no meio do
    // caminho serviria o de uma para a outra.
    return NextResponse.json(pagina, { status: 200, headers: { ...headers, 'Cache-Control': 'no-store' } });
  } catch (erro) {
    console.error('[api/sync] falha ao ler', erro);
    return NextResponse.json({ error: 'Falha ao ler o acervo.' }, { status: 500, headers });
  }
}