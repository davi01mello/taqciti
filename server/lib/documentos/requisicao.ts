/**
 * Contrato HTTP dos documentos personalizados: o que as rotas aceitam e como
 * cada falha vira status. Mora fora das rotas para ser testado sem subir o
 * Next.
 */
import { z } from 'zod';
import { contentTreeSchema, ConflitoDeRevisao } from './contentTree';
import { ErroDeCompilacao } from './compilador';
import { OverloadedError, RateLimitError } from '../ai/types';
import { ErroDeGeracao, type ResultadoDaEdicao, type ResultadoDoDocumento } from './gerar';

const fonteSchema = z.object({
  id: z.string().min(1),
  titulo: z.string().default(''),
  texto: z.string(),
});

const comum = {
  pedido: z.string().min(1, '"pedido" é obrigatório.'),
  fontes: z.array(fonteSchema).min(1, 'Envie ao menos uma fonte.'),
  variante: z.string().min(1).optional(),
  /** Declara que o conteúdo é sintético — ver a trava de política de dados. */
  sintetica: z.boolean().optional(),
};

export const corpoDeGeracaoSchema = z.object({
  ...comum,
  capa: z
    .object({
      cliente: z.string().optional(),
      autor: z.string().optional(),
      data: z.string().optional(),
    })
    .optional(),
  extensao: z
    .object({
      paginas: z.number().int().positive(),
      tipo: z.enum(['firme', 'aproximada']),
      incluiCapa: z.boolean().optional(),
    })
    .optional(),
  orientacoesEditoriais: z.array(z.string()).optional(),
});

export const corpoDeEdicaoSchema = z.object({
  ...comum,
  // Alterar o título da capa não precisa de fonte nenhuma; conteúdo novo que
  // afirma fato continua exigindo citação, e sem fonte ele simplesmente cai.
  fontes: z.array(fonteSchema),
  arvore: contentTreeSchema,
  revisaoEsperada: z.number().int().min(0),
  escopo: z.array(z.string().min(1)).optional(),
});

/** Soma dos caracteres das fontes — é o que o modelo vai ler. */
export const totalDeCaracteres = (fontes: readonly { texto: string }[]): number =>
  fontes.reduce((soma, f) => soma + f.texto.length, 0);

/** A primeira mensagem de erro do zod, legível. */
export function mensagemDeValidacao(erro: z.ZodError): string {
  const primeiro = erro.issues[0];
  if (!primeiro) return 'Corpo da requisição inválido.';
  const onde = primeiro.path.length > 0 ? `"${primeiro.path.join('.')}": ` : '';
  return `${onde}${primeiro.message}`;
}

/** Erro conhecido → status e mensagem. `null` = desconhecido: a rota decide. */
export function erroConhecido(erro: unknown): { status: number; error: string } | null {
  if (erro instanceof ConflitoDeRevisao) {
    return {
      status: 409,
      error: `${erro.message} O documento mudou desde que você o abriu; recarregue a versão atual.`,
    };
  }
  if (erro instanceof ErroDeGeracao || erro instanceof ErroDeCompilacao) {
    return { status: 422, error: erro.message };
  }
  // O provedor de IA, dito como é: cota ou sobrecarga. Quem usa precisa saber que
  // não é erro dele nem do documento — e se espera ou não.
  if (erro instanceof RateLimitError) {
    return {
      status: 429,
      error: erro.perDay
        ? 'O provedor de IA atingiu a cota do dia. O documento só pode ser gerado ou alterado quando ela reabrir.'
        : 'O provedor de IA está com muitas chamadas agora. Tente de novo em um minuto.',
    };
  }
  if (erro instanceof OverloadedError) {
    return { status: 503, error: 'O provedor de IA está sobrecarregado. Tente de novo em instantes.' };
  }
  return null;
}

/** O resultado como vai pela rede: o PDF em base64, como `/api/answers` faz. */
export function serializarResultado(r: ResultadoDoDocumento | ResultadoDaEdicao) {
  const { pdf, usage: _usage, ...resto } = r;
  return { ...resto, pdf: pdf.toString('base64') };
}
