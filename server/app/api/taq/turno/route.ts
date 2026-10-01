/**
 * Um turno do Taq: UMA chamada ao modelo, com as ferramentas que a extensão
 * autorizou. O ciclo do agente roda na extensão — ver `lib/taq/contrato.ts`.
 *
 *   curl -X POST http://localhost:3000/api/taq/turno \
 *     -H "x-docciti-key: $DOCCITI_SHARED_KEY" -H "Content-Type: application/json" \
 *     -d '{"instrucoes":"taq-v1","mensagens":[{"papel":"pessoa","texto":"oi"}],
 *          "maxTokensDeSaida":512,"sintetica":true}'
 *
 * O cancelamento atravessa: fechar a conexão do lado da extensão aborta
 * `request.signal`, que chega ao SDK do provedor como `abortSignal`.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders, rejectIfUnauthorized } from '@/lib/apiGuard';
import { atenderTurno } from '@/lib/taq/atender';
import { adaptadorGemini } from '@/lib/taq/gemini';
import { adaptadorGroq } from '@/lib/taq/groq';

/** Um turno é uma chamada; 60 s cobre o modelo com folga no plano Hobby. */
export const maxDuration = 60;

export function OPTIONS(request: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const headers = corsHeaders(request.headers.get('origin'));
  const recusa = rejectIfUnauthorized(request, headers);
  if (recusa) return recusa;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json(
      { erro: { codigo: 'pedido_invalido', mensagem: 'Corpo precisa ser JSON.', transitorio: false } },
      { status: 400, headers },
    );
  }

  const { status, corpo: resposta } = await atenderTurno(corpo, {
    // `groq` é temporário — ver o cabeçalho de lib/taq/groq.ts.
    adaptadores: { google: adaptadorGemini, groq: adaptadorGroq },
    sinal: request.signal,
  });
  return NextResponse.json(resposta, { status, headers });
}
