import { NextResponse, type NextRequest } from 'next/server';
import { generateDocument } from '@/lib/generateDocument';

/**
 * CORS permissivo por design NESTA FASE: a extensão chama esta rota a partir
 * de `chrome-extension://<id>`, e esse id muda entre modo dev (unpacked) e
 * produção (Chrome Web Store) — não dá pra fixar um valor só. Por isso
 * refletimos de volta qualquer Origin que comece com "chrome-extension://",
 * em vez de checar contra um id específico.
 *
 * RISCO CONHECIDO, não corrigido de propósito nesta fase (ver README.md):
 * isto aceita QUALQUER extensão Chrome, não só o TaqCITi — não há
 * autenticação nenhuma ainda. Fica para quando a chave de API real entrar.
 */
function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
  if (origin && origin.startsWith('chrome-extension://')) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function OPTIONS(request: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin');
  const headers = corsHeaders(origin);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Corpo da requisição precisa ser JSON válido.' },
      { status: 400, headers },
    );
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { error: 'Corpo da requisição precisa ser um objeto JSON.' },
      { status: 400, headers },
    );
  }

  const { transcript, title, date } = body as Record<string, unknown>;

  if (typeof transcript !== 'string' || transcript.trim().length === 0) {
    return NextResponse.json(
      { error: '"transcript" é obrigatório e precisa ser uma string não vazia.' },
      { status: 400, headers },
    );
  }
  if (title !== undefined && typeof title !== 'string') {
    return NextResponse.json(
      { error: '"title", quando enviado, precisa ser uma string.' },
      { status: 400, headers },
    );
  }
  if (date !== undefined && typeof date !== 'string') {
    return NextResponse.json(
      { error: '"date", quando enviado, precisa ser uma string.' },
      { status: 400, headers },
    );
  }

  const result = generateDocument({ transcript, title, date });
  return NextResponse.json(result, { status: 200, headers });
}
