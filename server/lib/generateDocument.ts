/**
 * ÚNICO lugar que decide "o que" o documento pós-reunião vira. Nesta fase é
 * um stub fixo, só pra provar que a transcrição chegou de verdade no
 * servidor (mostra a contagem de caracteres recebida). Quando a IA de
 * verdade entrar (fase futura, com chave de API), essa é a única função que
 * muda — a rota em app/api/generate/route.ts não precisa mudar nada.
 */
export interface GenerateDocumentInput {
  transcript: string;
  title?: string;
  date?: string;
}

export interface GenerateDocumentResult {
  title: string;
  content: string;
}

export function generateDocument(input: GenerateDocumentInput): GenerateDocumentResult {
  const title = input.title ? `Documento gerado — ${input.title}` : 'Documento gerado (teste)';

  const content = [
    '## Resumo da Reunião (documento de teste, IA ainda não plugada)',
    '',
    `Transcrição recebida com ${input.transcript.length} caracteres.`,
    input.date ? `Data informada: ${input.date}.` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return { title, content };
}
