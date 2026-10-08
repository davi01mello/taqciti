/**
 * Contratos da execução de um documento personalizado: o que cada etapa
 * recebe e devolve. Guardam decisões operacionais, evidências e resultados —
 * nunca o raciocínio privado do modelo.
 */
import { z } from 'zod';
import { referenciaDeFonteSchema } from './contentTree';

export const FORMATOS_DE_SAIDA = ['pdf', 'docx'] as const;

export const documentBriefSchema = z.object({
  finalidade: z.string().min(1),
  publico: z.string().optional(),
  pedido: z.string().min(1),
  /** Ids de reuniões/documentos que a pessoa escolheu ou o contexto já fixou.
   *  Fonte fora desta lista não entra: o cliente A não vaza no cliente B. */
  fontesSelecionadas: z.array(z.string().min(1)),
  idioma: z.literal('pt-BR').default('pt-BR'),
  formatos: z.array(z.enum(FORMATOS_DE_SAIDA)).min(1),
  extensao: z
    .object({
      paginas: z.number().int().positive(),
      /** `firme` = limite; `aproximada` = preferência. */
      tipo: z.enum(['firme', 'aproximada']),
      /** A contagem inclui capa e anexos? Ausente = perguntar se importar. */
      incluiCapa: z.boolean().optional(),
    })
    .optional(),
  perfilId: z.string().min(1).default('citi'),
  variante: z.string().min(1).default('padrao'),
  /** Perguntas que ainda impedem o resultado. Vazio = pode começar. */
  camposPendentes: z.array(z.string().min(1)).default([]),
});
export type DocumentBrief = z.infer<typeof documentBriefSchema>;

export const documentPlanSchema = z.object({
  titulo: z.string().min(1),
  /** Estrutura proposta em palavras ("relatório de diagnóstico"); não precisa
   *  existir um template com esse nome. */
  estrutura: z.string().min(1),
  secoes: z
    .array(
      z.object({
        id: z.string().min(1),
        titulo: z.string().min(1),
        finalidade: z.string().min(1),
        componentes: z.array(z.string().min(1)),
        fontesPrevistas: z.array(z.string().min(1)).default([]),
      }),
    )
    .min(1),
  limitacoesConhecidas: z.array(z.string()).default([]),
});
export type DocumentPlan = z.infer<typeof documentPlanSchema>;

export const renderManifestSchema = z.object({
  revisaoDoConteudo: z.number().int().min(0),
  perfilId: z.string().min(1),
  perfilVersao: z.number().int().positive(),
  perfilEstado: z.enum(['provisorio', 'validado']),
  rendererVersao: z.string().min(1),
  ativosEFontes: z.array(z.string().min(1)),
  formatos: z.array(
    z.object({
      formato: z.enum(FORMATOS_DE_SAIDA),
      /** SHA-256 do arquivo gerado. */
      hash: z.string().length(64),
    }),
  ),
  /** Medido na renderização — nunca estimado. Ausente se não renderizou. */
  paginas: z.number().int().positive().optional(),
});
export type RenderManifest = z.infer<typeof renderManifestSchema>;

export const problemaDeQualidadeSchema = z.object({
  tipo: z.enum(['estrutural', 'sustentacao', 'visual']),
  blockId: z.string().optional(),
  pagina: z.number().int().positive().optional(),
  descricao: z.string().min(1),
});

export type ProblemaDeQualidade = z.infer<typeof problemaDeQualidadeSchema>;

export const qualityReportSchema = z.object({
  problemas: z.array(problemaDeQualidadeSchema),
  /** O que foi de fato conferido. "Conferido" só vale para o que está aqui. */
  verificacoesRealizadas: z.array(z.string().min(1)),
  /** O que NÃO foi possível conferir, dito às claras. */
  limitacoes: z.array(z.string()),
  fontesCitadas: z.array(referenciaDeFonteSchema).default([]),
});
export type QualityReport = z.infer<typeof qualityReportSchema>;

/** Estados de um documento, todos vindos de operações reais. */
export const ESTADOS_DO_DOCUMENTO = [
  'rascunho_de_conteudo',
  'gerando',
  'renderizando',
  'em_revisao',
  'pronto',
  'falhou',
  'cancelado',
  'desatualizado',
] as const;
export type EstadoDoDocumento = (typeof ESTADOS_DO_DOCUMENTO)[number];

/**
 * "Pronto para baixar" exige o artefato real E que ele seja da revisão
 * corrente — nunca PDF antigo com DOCX novo.
 */
export function prontoParaBaixar(
  manifesto: RenderManifest | undefined,
  revisaoAtual: number,
  formato: (typeof FORMATOS_DE_SAIDA)[number],
): boolean {
  return (
    !!manifesto &&
    manifesto.revisaoDoConteudo === revisaoAtual &&
    manifesto.formatos.some((f) => f.formato === formato)
  );
}
