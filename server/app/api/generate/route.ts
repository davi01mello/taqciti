import { NextResponse, type NextRequest } from 'next/server';
import { DOCUMENT_TYPES, generateDocument, isDocumentType } from '@/lib/generateDocument';
import { corsHeaders, maxTranscriptChars, rejectIfUnauthorized } from '@/lib/apiGuard';
import { activeDataPolicyWarning } from '@/lib/ai';

/**
 * INERTE NO HOST ATUAL. `maxDuration` é diretiva da Vercel: o Next a compila
 * em configuração de função serverless, e num host que roda o app como
 * processo Node de vida longa — que é o caso do Railway, produção desde
 * 08/2026 — ela não limita nada. Fica como porta de volta, não como proteção
 * ativa. Ver `docs/deploy.md`, seções 5 e 8.
 *
 * O que o valor significa QUANDO vale: 300 é o teto duro do plano Hobby,
 * confirmado por deploy real falhando com "maxDuration between 1 and 300 for
 * plan hobby" ao tentar 600 (17/08/2026). Não é conservador por escolha.
 *
 * E lá 300 provavelmente não bastaria. Uma Ata completa é de 20 a 30 chamadas
 * de modelo (9 Pensante + laço do Auditor + 9 Escritor); a medição mais
 * recente na configuração ATIVA (`docs/medicao-2026-08-16-longa/`, Pensante em
 * `gemini-3.5-flash` com `thinkingLevel: HIGH`) levou 202s para CINCO das nove
 * seções — a cota diária acabou antes de fechar o documento. Extrapolando
 * linearmente, nove seções ficam por volta de 360s.
 *
 * Era esse o maior risco aberto do projeto, e ele saiu de cena junto com a
 * Vercel: nem plano Pro nem redesenho assíncrono são necessários hoje. O que
 * continua SEM MEDIÇÃO é quanto o proxy do host atual tolera de resposta lenta
 * — o teto de função sumiu, o de rede nunca foi medido.
 */
export const maxDuration = 300;

/**
 * CORS permissivo por design, e mais permissivo do que este comentário já
 * disse: `corsHeaders` reflete QUALQUER origem, não só `chrome-extension://`.
 * A extensão chama daqui de dois contextos diferentes — de uma página própria
 * dela (origem `chrome-extension://<id>`, que ainda por cima muda entre
 * unpacked e Web Store) e de dentro do content script, que carrega a origem da
 * PÁGINA e roda em `<all_urls>`. Não há lista que cubra isso.
 *
 * O que segura o abuso não é o CORS e sim o segredo compartilhado no header
 * `x-docciti-key`, validado abaixo. Motivação e limites da tranca — incluindo
 * por que o CORS aqui não defende nada: `lib/apiGuard.ts`.
 */

export function OPTIONS(request: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const headers = corsHeaders(request.headers.get('origin'));

  const unauthorized = rejectIfUnauthorized(request, headers);
  if (unauthorized) return unauthorized;

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

  const { transcript, title, date, documentType, sintetica } = body as Record<string, unknown>;

  if (typeof transcript !== 'string' || transcript.trim().length === 0) {
    return NextResponse.json(
      { error: '"transcript" é obrigatório e precisa ser uma string não vazia.' },
      { status: 400, headers },
    );
  }

  // Recusar antes de mandar pro modelo: uma transcrição gigante não é um
  // caso de uso, é uma conta cara e uma espera longa.
  const limit = maxTranscriptChars();
  if (transcript.length > limit) {
    return NextResponse.json(
      {
        error:
          `"transcript" tem ${transcript.length} caracteres e o limite é ${limit}. ` +
          'Gere o documento a partir de um recorte menor da reunião.',
      },
      { status: 413, headers },
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
  if (!isDocumentType(documentType)) {
    return NextResponse.json(
      { error: `"documentType" é obrigatório e precisa ser um de: ${DOCUMENT_TYPES.join(', ')}.` },
      { status: 400, headers },
    );
  }

  /**
   * Trava de política de dados.
   *
   * Enquanto esta rota devolvia stub, ela não mandava nada para provedor
   * nenhum e a trava não fazia falta. Agora ela roda a rede de agentes, e uma
   * chave de free tier manda TUDO que passa por ela para treinamento do
   * provedor, com revisão humana.
   *
   * O contrato de `/api/generate` fica intacto onde importa: com chave paga
   * (`DOCCITI_DATA_POLICY` não definida) nada muda, e a extensão não precisa
   * saber que este campo existe. A recusa só acontece na configuração de
   * desenvolvimento, que é exatamente onde uma gravação real de reunião não
   * pode entrar.
   */
  const aviso = activeDataPolicyWarning();
  if (aviso && sintetica !== true) {
    return NextResponse.json(
      {
        error:
          'A configuração ativa envia o conteúdo para treinamento do provedor, com ' +
          'possível revisão humana. Só transcrição sintética é aceita — declare ' +
          '"sintetica": true no corpo. Com chave paga esta trava não existe.',
        aviso,
      },
      { status: 400, headers },
    );
  }

  const result = await generateDocument({ transcript, title, date, documentType });
  return NextResponse.json(result, { status: 200, headers });
}
