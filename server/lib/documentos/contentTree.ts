/**
 * ContentTree — a árvore semântica do documento. É a fonte de verdade: DOCX,
 * PDF e preview saem dela, e uma revisão pelo chat vira um patch sobre blockIds.
 *
 * O redator entrega PAPÉIS ("título de seção"), nunca medidas. O compilador
 * resolve o papel num estilo do perfil. Não existe bloco de HTML/OOXML livre:
 * o conjunto de tipos abaixo é o catálogo do que o produto sabe montar, e
 * pedir outro tipo é erro de validação, não improviso.
 *
 * Campo ausente é aceito de propósito (`lacunas`): a saída estruturada pode
 * ter erro factual, e forçar preenchimento convida a inventar.
 */
import { z } from 'zod';
import { PAPEIS_DE_ESTILO } from './perfil';

/** Fato sustentado, recomendação do agente, ou pendência. Recomendação nunca
 *  é decisão aprovada. */
export const CLASSIFICACOES = ['fato', 'recomendacao', 'pendencia'] as const;

export const referenciaDeFonteSchema = z.object({
  /** Id da reunião ou documento de origem. */
  fonteId: z.string().min(1),
  /** Citação literal ou âncora, quando houver. Fica no painel privado. */
  trecho: z.string().optional(),
});
export type ReferenciaDeFonte = z.infer<typeof referenciaDeFonteSchema>;

const base = {
  blockId: z.string().min(1),
  papel: z.enum(PAPEIS_DE_ESTILO).optional(),
  fontes: z.array(referenciaDeFonteSchema).default([]),
  classificacao: z.enum(CLASSIFICACOES).optional(),
  /** Origem da última edição: o agente ou uma pessoa. Edição humana sobrevive
   *  a uma nova solicitação. */
  origem: z.enum(['agente', 'pessoa']).default('agente'),
};

export const LAYOUT_HINTS = ['normal', 'compacto', 'quebra_antes', 'manter_junto'] as const;
const layoutHint = z.enum(LAYOUT_HINTS).optional();

export const blocoSchema = z.discriminatedUnion('tipo', [
  z.object({
    ...base,
    tipo: z.literal('capa'),
    variante: z.string().min(1).default('padrao'),
    titulo: z.string().min(1),
    subtitulo: z.string().optional(),
    autor: z.string().optional(),
    cliente: z.string().optional(),
    data: z.string().optional(),
  }),
  z.object({
    ...base,
    tipo: z.literal('titulo'),
    nivel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    texto: z.string().min(1),
    layout: layoutHint,
  }),
  z.object({ ...base, tipo: z.literal('paragrafo'), texto: z.string().min(1), layout: layoutHint }),
  z.object({
    ...base,
    tipo: z.literal('lista'),
    ordenada: z.boolean().default(false),
    itens: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    ...base,
    tipo: z.literal('tabela'),
    cabecalho: z.array(z.string().min(1)).min(1),
    linhas: z.array(z.array(z.string())).min(1),
    legenda: z.string().optional(),
    layout: layoutHint,
  }),
  z.object({
    ...base,
    tipo: z.literal('imagem'),
    ativoId: z.string().min(1),
    legenda: z.string().optional(),
    /** Obrigatório: imagem sem texto alternativo é defeito de acessibilidade. */
    textoAlternativo: z.string().min(1),
  }),
  z.object({ ...base, tipo: z.literal('referencia'), texto: z.string().min(1) }),
  z.object({ ...base, tipo: z.literal('quebra_de_secao') }),
  z.object({ ...base, tipo: z.literal('sumario') }),
]);
export type Bloco = z.infer<typeof blocoSchema>;
export type TipoDeBloco = Bloco['tipo'];

export const lacunaSchema = z.object({
  /** Bloco afetado, ou ausente quando a lacuna é do documento todo. */
  blockId: z.string().optional(),
  campo: z.string().min(1),
  pergunta: z.string().min(1),
});
export type LacunaDoDocumento = z.infer<typeof lacunaSchema>;

export const contentTreeSchema = z.object({
  /** Revisão esperada na gravação — controle de concorrência. */
  revisao: z.number().int().min(0),
  titulo: z.string().min(1),
  blocos: z.array(blocoSchema),
  lacunas: z.array(lacunaSchema).default([]),
});
export type ContentTree = z.infer<typeof contentTreeSchema>;

/** Tipos de bloco que o compilador atual sabe montar. Um tipo do schema fora
 *  desta lista é aceito como dado, mas o catálogo técnico NÃO o promete. */
export const TIPOS_COMPILAVEIS: readonly TipoDeBloco[] = [
  'capa',
  'titulo',
  'paragrafo',
  'lista',
  'tabela',
  'imagem',
  'referencia',
  'sumario',
  'quebra_de_secao',
];

export interface ProblemaDaArvore {
  blockId?: string;
  problema: string;
}

/**
 * Validação estrutural, sem modelo: ids duplicados, capa fora do começo ou
 * repetida, tipo que o compilador ainda não monta, fato sem fonte.
 */
export function validarArvore(arvore: ContentTree): ProblemaDaArvore[] {
  const problemas: ProblemaDaArvore[] = [];
  const vistos = new Set<string>();
  let sumarios = 0;
  arvore.blocos.forEach((bloco, indice) => {
    if (vistos.has(bloco.blockId)) {
      problemas.push({ blockId: bloco.blockId, problema: 'blockId duplicado.' });
    }
    vistos.add(bloco.blockId);

    if (bloco.tipo === 'sumario') {
      sumarios += 1;
      if (sumarios > 1) {
        problemas.push({ blockId: bloco.blockId, problema: 'O documento só pode ter um sumário.' });
      }
      if (indice === 0) {
        problemas.push({ blockId: bloco.blockId, problema: 'O sumário vem depois da capa.' });
      }
    }
    if (bloco.tipo === 'capa' && indice !== 0) {
      problemas.push({ blockId: bloco.blockId, problema: 'A capa só pode ser o primeiro bloco.' });
    }
    if (!TIPOS_COMPILAVEIS.includes(bloco.tipo)) {
      problemas.push({
        blockId: bloco.blockId,
        problema: `O bloco "${bloco.tipo}" ainda não é suportado pelo compilador.`,
      });
    }
    if (bloco.classificacao === 'fato' && bloco.fontes.length === 0) {
      problemas.push({ blockId: bloco.blockId, problema: 'Fato sem fonte registrada.' });
    }
  });
  return problemas;
}

/** Aplica um patch limitado a blocos (por id), exigindo a revisão esperada. */
export type PatchDeBlocos =
  | { op: 'substituir'; blockId: string; bloco: Bloco }
  | { op: 'remover'; blockId: string }
  | { op: 'inserir_depois'; blockId: string | null; bloco: Bloco };

export class ConflitoDeRevisao extends Error {
  constructor(
    readonly esperada: number,
    readonly atual: number,
  ) {
    super(`Revisão esperada ${esperada}, mas o documento está na ${atual}.`);
  }
}

export function aplicarPatch(
  arvore: ContentTree,
  revisaoEsperada: number,
  patches: readonly PatchDeBlocos[],
): ContentTree {
  if (arvore.revisao !== revisaoEsperada) {
    throw new ConflitoDeRevisao(revisaoEsperada, arvore.revisao);
  }
  let blocos = [...arvore.blocos];
  for (const patch of patches) {
    const indice = patch.op === 'inserir_depois' && patch.blockId === null
      ? -1
      : blocos.findIndex((b) => b.blockId === patch.blockId);
    if (indice === -1 && !(patch.op === 'inserir_depois' && patch.blockId === null)) {
      throw new Error(`Bloco "${patch.blockId}" não existe nesta revisão.`);
    }
    if (patch.op === 'substituir') blocos[indice] = patch.bloco;
    else if (patch.op === 'remover') blocos = blocos.filter((_, i) => i !== indice);
    else blocos.splice(indice + 1, 0, patch.bloco);
  }
  return { ...arvore, blocos, revisao: arvore.revisao + 1 };
}
