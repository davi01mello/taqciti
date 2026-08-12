/**
 * Tranca mínima do endpoint. NÃO é autenticação de verdade — é uma tranca
 * contra uso acidental e varredura.
 *
 * Enquanto /api/generate devolvia stub, o CORS permissivo era risco aceito e
 * documentado. A partir do momento em que existe uma chave de API atrás da
 * rota, cada requisição custa dinheiro e qualquer um que descubra a URL
 * gasta a cota de outra pessoa. O CORS continua refletindo qualquer origem
 * `chrome-extension://` (o id muda entre dev e Web Store, não dá pra fixar);
 * o que mudou é que agora refletir a origem não basta pra ser atendido.
 *
 * Limite honesto: o segredo viaja dentro do bundle da extensão, então quem
 * abrir o pacote acha. Isso é aceitável para o que ele defende — impedir que
 * um scanner ou uma extensão qualquer torre a cota — e não para tratar o
 * chamador como confiável. Autenticação real (por usuário, com rotação)
 * continua sendo trabalho de uma fase futura.
 */
import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

export const SHARED_KEY_HEADER = 'x-docciti-key';

/** Teto por requisição. Transcrição acima disso é recusada com erro claro,
 *  em vez de virar uma conta cara e uma espera longa. */
const DEFAULT_MAX_TRANSCRIPT_CHARS = 400_000;

export function maxTranscriptChars(): number {
  const raw = process.env.DOCCITI_MAX_TRANSCRIPT_CHARS;
  if (!raw?.trim()) return DEFAULT_MAX_TRANSCRIPT_CHARS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `DOCCITI_MAX_TRANSCRIPT_CHARS="${raw}" precisa ser um inteiro positivo de caracteres.`,
    );
  }
  return parsed;
}

/** Comparação de tempo constante, pra não vazar o segredo byte a byte. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual exige mesmo tamanho; comparar o tamanho antes vaza só o
  // comprimento, que não é o segredo.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, ${SHARED_KEY_HEADER}`,
    Vary: 'Origin',
  };
  if (origin && origin.startsWith('chrome-extension://')) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/**
 * Devolve uma resposta de erro quando a requisição não passa, e `null`
 * quando passa. Falha FECHADA se o segredo não estiver configurado: com
 * chave de API atrás da rota, "sem segredo definido" não pode significar
 * "aberto pra todo mundo".
 */
export function rejectIfUnauthorized(
  request: NextRequest,
  headers: Record<string, string>,
): NextResponse | null {
  const expected = process.env.DOCCITI_SHARED_KEY?.trim();
  if (!expected) {
    return NextResponse.json(
      {
        error:
          'Servidor sem DOCCITI_SHARED_KEY configurada. Defina-a em server/.env.local ' +
          '(ver server/.env.example) antes de usar esta rota.',
      },
      { status: 500, headers },
    );
  }

  const provided = request.headers.get(SHARED_KEY_HEADER);
  if (!provided || !secretsMatch(provided, expected)) {
    return NextResponse.json(
      { error: `Header ${SHARED_KEY_HEADER} ausente ou inválido.` },
      { status: 401, headers },
    );
  }

  return null;
}
