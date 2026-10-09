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
 */
import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders } from '@/lib/apiGuard';
import { autenticar } from '@/lib/identidade/rota';
import { apagarItem, gravarItem } from '@/lib/conector/escrita';
import { TIPOS_DE_ITEM, type ItemPorTipo, type TipoDeItem } from '@/lib/conector/tipos';
import {
  TIPO_HISTORICO,
  apagarHistorico,
  gravarHistorico,
  validarHistorico,
  type HistoricoDoDocumento,
} from '@/lib/conector/historico';

/** Itens por requisição. O cliente fatia; ver o cabeçalho. */
const MAX_POR_LOTE = 50;
/** Teto do corpo, como segunda barreira: 50 reuniões longas ainda são muito. */
const MAX_CORPO_BYTES = 8 * 1024 * 1024;

export function OPTIONS(request: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  });
}

function ehTipo(v: unknown): v is TipoDeItem {
  return typeof v === 'string' && (TIPOS_DE_ITEM as readonly string[]).includes(v);
}

type Entrada =
  | { tipo: TipoDeItem; item: ItemPorTipo[TipoDeItem] }
  | { tipo: typeof TIPO_HISTORICO; item: HistoricoDoDocumento };

/** O que a rota recusou sem derrubar o lote: o cliente registra e segue. */
interface Recusado {
  tipo: string;
  id: string;
  motivo: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const headers = corsHeaders(request.headers.get('origin'));
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
    if (e.tipo !== TIPO_HISTORICO && !ehTipo(e.tipo)) {
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
    entradas.push({ tipo: e.tipo as TipoDeItem, item: e.item as ItemPorTipo[TipoDeItem] });
  }

  const remocoes: { tipo: TipoDeItem | typeof TIPO_HISTORICO; id: string }[] = [];
  for (const bruto of apagadosBrutos) {
    const a = bruto as { tipo?: unknown; id?: unknown };
    if ((a.tipo !== TIPO_HISTORICO && !ehTipo(a.tipo)) || typeof a.id !== 'string') {
      return NextResponse.json(
        { error: 'Cada apagado precisa de `tipo` e `id`.' },
        { status: 400, headers },
      );
    }
    remocoes.push({ tipo: a.tipo as TipoDeItem | typeof TIPO_HISTORICO, id: a.id });
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
  let gravados = 0;
  try {
    for (const entrada of entradas) {
      if (entrada.tipo === TIPO_HISTORICO) await gravarHistorico(auth.pessoaId, entrada.item);
      else await gravarItem(auth.pessoaId, entrada.tipo, entrada.item);
      gravados += 1;
    }
    for (const { tipo, id } of remocoes) {
      if (tipo === TIPO_HISTORICO) await apagarHistorico(auth.pessoaId, id);
      else await apagarItem(auth.pessoaId, tipo, id);
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
    { gravados, apagados: remocoes.length, ...(recusados.length > 0 ? { recusados } : {}) },
    { status: 200, headers },
  );
}
