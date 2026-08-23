/**
 * Tranca mínima do endpoint. NÃO é autenticação de verdade — é uma tranca
 * contra uso acidental e varredura.
 *
 * Enquanto /api/generate devolvia stub, o CORS permissivo era risco aceito e
 * documentado. A partir do momento em que existe uma chave de API atrás da
 * rota, cada requisição custa dinheiro e qualquer um que descubra a URL
 * gasta a cota de outra pessoa. O que atende ou recusa é o SEGREDO
 * COMPARTILHADO (`rejectIfUnauthorized`), somado ao teto de
 * `maxTranscriptChars` — nunca o CORS, pelo motivo detalhado em
 * `corsHeaders`.
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

/**
 * Reflete QUALQUER origem — e isto não afrouxa a tranca.
 *
 * Um `fetch` disparado de dentro de um content script carrega a origem da
 * PÁGINA para fins de CORS, não a da extensão (`chrome-extension://` só é a
 * origem de chamadas feitas de dentro de uma página própria da extensão, tipo
 * `document/index.html`). Sem `Access-Control-Allow-Origin` de volta, o
 * navegador bloqueia o POST antes de sair, e a extensão nunca vê um 401/200 —
 * só um `fetch` que lança.
 *
 * A tentação, daí, é listar as origens permitidas. Ela não funciona aqui, por
 * duas razões independentes:
 *
 *   1. **O painel roda em toda página.** O content script é declarado para
 *      `<all_urls>` (ver `manifest.config.ts`), e o "Gerar Documento" do
 *      `MeetingScreen` é alcançável pelo histórico em QUALQUER aba, não só na
 *      do Meet — é literalmente o que `src/content/standalone.tsx` existe para
 *      fazer. A lista precisaria conter a internet inteira. Com
 *      `https://meet.google.com` sozinho, gerar documento funcionava na aba do
 *      Meet e falhava em todas as outras, com a MESMA mensagem de "servidor
 *      fora do ar" — que manda quem for investigar para o lugar errado.
 *
 *   2. **CORS não defende esta rota de nada.** É uma regra que o NAVEGADOR
 *      aplica a páginas. `curl`, um script de servidor ou um bot ignoram o
 *      cabeçalho por completo — verificado: um POST sem `Origin` nenhum chega
 *      ao handler e é recusado pelo segredo, não pelo CORS. O único ataque que
 *      uma lista de origens impediria é uma página web usando o navegador de
 *      quem a visita, com uma chave que já viaja pública dentro do bundle.
 *
 * Quem segura o abuso é `rejectIfUnauthorized` e o teto de
 * `maxTranscriptChars`. O cabeçalho deste arquivo já dizia isso; o código é
 * que tinha parado de admitir.
 *
 * Sem `Access-Control-Allow-Credentials` de propósito: não há cookie nem
 * sessão nesta rota, e refletir a origem COM credenciais seria outra conversa.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, ${SHARED_KEY_HEADER}`,
    Vary: 'Origin',
  };
  if (origin) {
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
