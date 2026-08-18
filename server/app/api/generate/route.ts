import { NextResponse, type NextRequest } from 'next/server';
import { DOCUMENT_TYPES, generateDocument, isDocumentType } from '@/lib/generateDocument';
import { corsHeaders, maxTranscriptChars, rejectIfUnauthorized } from '@/lib/apiGuard';
import { activeDataPolicyWarning } from '@/lib/ai';

/**
 * Sem isto, o Vercel mata a função no teto padrão da plataforma — bem menos
 * que o necessário. Uma Ata completa é de 20 a 30 chamadas de modelo (9
 * Pensante + laço do Auditor + 9 Escritor).
 *
 * 300 É O TETO DURO DO PLANO HOBBY, confirmado por deploy real falhando com
 * "maxDuration between 1 and 300 for plan hobby" ao tentar 600 (17/08/2026).
 * Não é conservador por escolha — é o máximo que este plano aceita.
 *
 * E 300 PROVAVELMENTE NÃO BASTA. A medição mais recente na configuração
 * ATIVA (`docs/medicao-2026-08-16-longa/`, Pensante em `gemini-3.5-flash` com
 * `thinkingLevel: HIGH`) levou 202s para CINCO das nove seções — a cota
 * diária acabou antes de fechar o documento inteiro. Extrapolando de forma
 * linear, nove seções ficam por volta de 360s. Ou seja: no plano Hobby, uma
 * Ata completa de verdade tem boa chance de estourar o teto de função MESMO
 * no valor máximo permitido — isso é limite de plataforma, não bug daqui.
 *
 * Duas saídas, nenhuma delas é "só mudar este número":
 * 1. Upgrade pro plano Pro/Enterprise da Vercel (permite mais que 300s,
 *    valor exato não verificado — confira no dashboard antes de assumir).
 * 2. Tornar a geração assíncrona (job em background + polling, ou streaming
 *    seção a seção) em vez de uma chamada síncrona só. Redesenho de
 *    arquitetura, não ajuste de configuração — não fiz isso agora.
 */
export const maxDuration = 300;

/**
 * CORS permissivo por design: a extensão chama esta rota a partir de
 * `chrome-extension://<id>`, e esse id muda entre modo dev (unpacked) e
 * produção (Chrome Web Store) — não dá pra fixar um valor só. Por isso
 * refletimos de volta qualquer Origin que comece com "chrome-extension://".
 *
 * O que segura o abuso agora não é o CORS e sim o segredo compartilhado no
 * header `x-docciti-key`, validado abaixo. Motivação e limites da tranca:
 * `lib/apiGuard.ts`.
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
