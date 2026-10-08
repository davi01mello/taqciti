/**
 * Perfil de identidade documental — o "padrão CITi" como DADO versionado, não
 * como constantes espalhadas pelo renderizador.
 *
 * Cada regra carrega a PROVENIÊNCIA: `explicita` (está num manual/template
 * aprovado), `observada` (medida num documento de exemplo) ou `inferida`
 * (precisa de confirmação). Um perfil só é `validado` quando uma pessoa
 * responsável o confirma; até lá a interface deve dizer que é provisório e
 * nenhum documento pode alegar fidelidade ao padrão oficial.
 *
 * O perfil tem VARIANTES visuais (a Ata e o X1 têm uma cara; um material
 * editorial como a apostila tem outra) e cada variante diz o que precisa para
 * ser aplicada: fontes e ativos. O que está `ausente` vira diagnóstico, nunca
 * substituição silenciosa.
 *
 * Nada aqui é deduzido do nome "CITi", e a identidade do aplicativo TaqCiti
 * não entra.
 */
import { z } from 'zod';
import {
  ENTRELINHA,
  TAMANHO_CORPO_PT,
  TAMANHO_ITEM_PT,
  TAMANHO_RODAPE_PT,
  TAMANHO_SECAO_PT,
  TAMANHO_SUBTITULO_CAPA_PT,
  TAMANHO_TITULO_PT,
  TINTA,
  COR_SUBTITULO_CAPA,
  GAP_PARAGRAFO_PT,
} from '../render/typography';
import { FONTE_NEGRITO, FONTE_REGULAR } from '../render/fonts';
import { MARCA_CAPA_LARGURA_PT } from '../render/brand';
import { RODAPE } from '../render/html';

export const PROVENIENCIAS = ['explicita', 'observada', 'inferida'] as const;
export const OBRIGATORIEDADES = ['obrigatoria', 'adaptavel', 'opcional'] as const;

/** De onde vem uma regra e quem a sustenta. */
export const provenienciaSchema = z.object({
  tipo: z.enum(PROVENIENCIAS),
  /** Arquivo ou documento que mostra a regra. */
  referencia: z.string().min(1),
});
export type Proveniencia = z.infer<typeof provenienciaSchema>;

/** Um valor do perfil + o que o sustenta + o quanto ele obriga. */
function regra<T extends z.ZodTypeAny>(valor: T) {
  return z.object({
    valor,
    proveniencia: provenienciaSchema,
    obrigatoriedade: z.enum(OBRIGATORIEDADES),
  });
}

/** Papéis de estilo que o redator pode pedir. O compilador resolve cada um
 *  para um estilo aprovado — o modelo nunca escolhe tamanho, cor ou margem. */
export const PAPEIS_DE_ESTILO = [
  'titulo_documento',
  'subtitulo_capa',
  'titulo_secao',
  'subtitulo_secao',
  'corpo',
  'item_lista',
  'rotulo',
  'legenda',
  'rodape',
  'rotulo_tecnico',
  'tabela_cabecalho',
  'tabela_celula',
  'destaque_titulo',
  'destaque_corpo',
] as const;
export type PapelDeEstilo = (typeof PAPEIS_DE_ESTILO)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const estiloSchema = z.object({
  fonte: z.string().min(1),
  tamanhoPt: z.number().positive(),
  cor: hex,
  /** Distância entre linhas, em múltiplos do tamanho. */
  entrelinha: z.number().positive(),
  espacoDepoisPt: z.number().min(0),
});
export type EstiloDoPerfil = z.infer<typeof estiloSchema>;

const fonteSchema = z.object({
  familia: z.string().min(1),
  peso: z.enum(['leve', 'regular', 'medio', 'negrito', 'italico']),
  /** Nome registrado no renderizador, quando o projeto tem o arquivo. */
  nomeNoRenderizador: z.string().min(1).optional(),
  /** `ausente` = não há arquivo utilizável no projeto: gera diagnóstico. */
  disponibilidade: z.enum(['presente', 'ausente']),
  /** Arquivo da fonte no projeto, quando presente. */
  arquivo: z.string().min(1).optional(),
  /** Só preenchido quando alguém AUTORIZOU uma substituição. */
  substituicaoAutorizada: z.string().min(1).optional(),
  /** Quem autorizou a substituição, e quando. */
  autorizacao: z.string().min(1).optional(),
  proveniencia: provenienciaSchema,
});

const ativoSchema = z.object({
  id: z.string().min(1),
  descricao: z.string().min(1),
  disponibilidade: z.enum(['presente', 'ausente']),
  /** Onde está o arquivo, quando presente. */
  arquivo: z.string().min(1).optional(),
});

/** Peças recorrentes que a variante sabe montar. */
const componenteSchema = z.object({
  id: z.string().min(1),
  descricao: z.string().min(1),
  proveniencia: provenienciaSchema,
});

const varianteSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1),
  uso: z.string().min(1),
  pagina: z.object({
    tamanho: regra(z.literal('A4')),
    margemPt: regra(z.number().positive()),
  }),
  cores: z.record(z.string(), regra(hex)),
  fontes: z.array(fonteSchema),
  ativos: z.array(ativoSchema),
  estilos: z.record(z.enum(PAPEIS_DE_ESTILO), regra(estiloSchema)),
  componentes: z.array(componenteSchema),
  rodape: regra(z.array(z.string())),
});
export type VarianteVisual = z.infer<typeof varianteSchema>;

export const perfilSchema = z.object({
  id: z.string().min(1),
  /** Cresce a cada mudança de regra; o RenderManifest grava esta versão. */
  versao: z.number().int().positive(),
  nome: z.string().min(1),
  estado: z.enum(['provisorio', 'validado']),
  /** Quem validou, e quando. Presente se e somente se `estado === 'validado'`. */
  validacao: z.object({ por: z.string().min(1), em: z.string().min(1) }).optional(),
  /** Ressalvas que a interface deve poder mostrar. */
  observacoes: z.array(z.string()),
  /** A primeira é a padrão. */
  variantes: z.array(varianteSchema).min(1),
  editorial: z.object({
    idioma: z.literal('pt-BR'),
    /** Orientações verificáveis para o redator e o revisor. Vazio = nenhuma
     *  preferência institucional foi fornecida (e nenhuma é inventada). */
    orientacoes: z.array(z.string()),
  }),
});
export type PerfilDocumental = z.infer<typeof perfilSchema>;

/**
 * Regras que o perfil exige e o que falta: um perfil "validado" sem validador
 * é inconsistente, e um provisório não pode carregar validação.
 */
export function problemasDoPerfil(perfil: PerfilDocumental): string[] {
  const problemas: string[] = [];
  if (perfil.estado === 'validado' && !perfil.validacao) {
    problemas.push('Perfil marcado como validado sem registro de quem validou.');
  }
  if (perfil.estado === 'provisorio' && perfil.validacao) {
    problemas.push('Perfil provisório não pode carregar registro de validação.');
  }
  const ids = new Set<string>();
  for (const variante of perfil.variantes) {
    if (ids.has(variante.id)) problemas.push(`Variante "${variante.id}" duplicada.`);
    ids.add(variante.id);
  }
  return problemas;
}

/** Algo que impede aplicar uma variante como aprovada. */
export interface DiagnosticoDeVariante {
  tipo: 'fonte_ausente' | 'ativo_ausente';
  item: string;
  /** Existe substituição autorizada? Se sim, pode seguir — dizendo qual. */
  substituicao?: string;
}

/**
 * O que falta para a variante sair fiel ao perfil. Fonte ausente SEM
 * substituição autorizada, e ativo ausente, são pendências reais: quem monta o
 * documento avisa a pessoa em vez de trocar a tipografia por conta própria.
 */
export function diagnosticarVariante(variante: VarianteVisual): DiagnosticoDeVariante[] {
  const itens: DiagnosticoDeVariante[] = [];
  for (const fonte of variante.fontes) {
    if (fonte.disponibilidade === 'presente') continue;
    itens.push({
      tipo: 'fonte_ausente',
      item: `${fonte.familia} (${fonte.peso})`,
      ...(fonte.substituicaoAutorizada ? { substituicao: fonte.substituicaoAutorizada } : {}),
    });
  }
  for (const ativo of variante.ativos) {
    if (ativo.disponibilidade === 'ausente') {
      itens.push({ tipo: 'ativo_ausente', item: ativo.descricao });
    }
  }
  return itens;
}

/** Só o que NÃO tem saída autorizada bloqueia a aplicação aprovada. */
export function varianteAplicavel(variante: VarianteVisual): boolean {
  return diagnosticarVariante(variante).every((d) => d.substituicao !== undefined);
}

// ---------------------------------------------------------------------------
// Variante "ata" — o que o renderizador da Ata já mede de example.pdf
// ---------------------------------------------------------------------------

const OBSERVADA_NA_ATA: Proveniencia = {
  tipo: 'observada',
  referencia: 'example.pdf (modelo da Ata), medido em server/lib/render/typography.ts',
};

const regraObservada = <T>(valor: T, proveniencia: Proveniencia, obrigatoriedade = 'obrigatoria' as const) => ({
  valor,
  proveniencia,
  obrigatoriedade,
});

const estiloDaAta = (fonte: string, tamanhoPt: number, cor: string, espacoDepoisPt: number) =>
  regraObservada(
    { fonte, tamanhoPt, cor, entrelinha: ENTRELINHA, espacoDepoisPt },
    OBSERVADA_NA_ATA,
  );

const VARIANTE_ATA: VarianteVisual = {
  id: 'ata',
  nome: 'Ata e conversa (modelo da Ata)',
  uso: 'Ata de reunião, Doc de conversa X1 e Resumo completo.',
  pagina: {
    tamanho: regraObservada('A4' as const, OBSERVADA_NA_ATA),
    margemPt: regraObservada(72, OBSERVADA_NA_ATA),
  },
  cores: {
    tinta: regraObservada(TINTA, OBSERVADA_NA_ATA),
    subtituloDaCapa: regraObservada(COR_SUBTITULO_CAPA, OBSERVADA_NA_ATA),
  },
  fontes: [
    {
      familia: 'Barlow',
      peso: 'regular',
      nomeNoRenderizador: FONTE_REGULAR,
      disponibilidade: 'presente',
      proveniencia: { tipo: 'observada', referencia: 'fonte embutida no modelo da Ata' },
    },
    {
      familia: 'Barlow',
      peso: 'negrito',
      nomeNoRenderizador: FONTE_NEGRITO,
      disponibilidade: 'presente',
      proveniencia: { tipo: 'observada', referencia: 'fonte embutida no modelo da Ata' },
    },
  ],
  ativos: [
    {
      id: 'marca-preta',
      descricao: 'Marca CITi preta',
      disponibilidade: 'presente',
      arquivo: 'server/lib/render/assets/citi-preto.png',
    },
  ],
  estilos: {
    titulo_documento: estiloDaAta(FONTE_NEGRITO, TAMANHO_TITULO_PT, TINTA, 0),
    subtitulo_capa: estiloDaAta(FONTE_NEGRITO, TAMANHO_SUBTITULO_CAPA_PT, COR_SUBTITULO_CAPA, 0),
    titulo_secao: estiloDaAta(FONTE_NEGRITO, TAMANHO_SECAO_PT, TINTA, 6),
    subtitulo_secao: estiloDaAta(FONTE_NEGRITO, TAMANHO_CORPO_PT, TINTA, 6),
    corpo: estiloDaAta(FONTE_REGULAR, TAMANHO_CORPO_PT, TINTA, GAP_PARAGRAFO_PT),
    item_lista: estiloDaAta(FONTE_REGULAR, TAMANHO_ITEM_PT, TINTA, 6),
    rotulo: estiloDaAta(FONTE_NEGRITO, TAMANHO_CORPO_PT, TINTA, GAP_PARAGRAFO_PT),
    rotulo_tecnico: estiloDaAta(FONTE_NEGRITO, TAMANHO_CORPO_PT, TINTA, 6),
    tabela_cabecalho: estiloDaAta(FONTE_NEGRITO, TAMANHO_ITEM_PT, TINTA, 0),
    tabela_celula: estiloDaAta(FONTE_REGULAR, TAMANHO_ITEM_PT, TINTA, 0),
    destaque_titulo: estiloDaAta(FONTE_NEGRITO, TAMANHO_CORPO_PT, TINTA, 6),
    destaque_corpo: estiloDaAta(FONTE_REGULAR, TAMANHO_CORPO_PT, TINTA, 6),
    // Estes papéis não existem no modelo da Ata: herdam corpo/item, e é inferência.
    legenda: {
      ...estiloDaAta(FONTE_REGULAR, TAMANHO_ITEM_PT, TINTA, 6),
      proveniencia: {
        tipo: 'inferida',
        referencia: 'não há legenda no modelo da Ata; confirmar com o responsável',
      },
      obrigatoriedade: 'adaptavel',
    },
    rodape: estiloDaAta(FONTE_REGULAR, TAMANHO_RODAPE_PT, TINTA, 0),
  },
  componentes: [
    {
      id: 'capa_com_grafico',
      descricao: `Capa com marca preta centralizada (${MARCA_CAPA_LARGURA_PT} pt), título e subtítulo centralizados e gráfico na faixa de baixo.`,
      proveniencia: OBSERVADA_NA_ATA,
    },
    {
      id: 'rodape_institucional',
      descricao: 'Rodapé de duas linhas, com filete cinza acima, em toda página interna.',
      proveniencia: OBSERVADA_NA_ATA,
    },
  ],
  rodape: regraObservada(RODAPE, OBSERVADA_NA_ATA),
};

// ---------------------------------------------------------------------------
// Variante "editorial" — a Apostila Unit Economics (CITi Business School)
// ---------------------------------------------------------------------------

const APOSTILA: Proveniencia = {
  tipo: 'observada',
  referencia:
    'public/assets-docs/Apostila Unit Economics.pdf (medido nas páginas 1–4, 7, 10, 14 e 33)',
};

/** O mesmo tom de ressalva em tudo que não é medida direta do arquivo. */
const INFERIDA_DA_APOSTILA: Proveniencia = {
  tipo: 'inferida',
  referencia: 'Apostila Unit Economics.pdf — estimado pela imagem; confirmar',
};

const cor = (valor: string) => regraObservada(valor, APOSTILA);

/** `entrelinha` = passo entre linhas ÷ tamanho (corpo: 14,9 pt ÷ 9,7 pt). */
const estiloEditorial = (
  fonte: string,
  tamanhoPt: number,
  corDoTexto: string,
  entrelinha: number,
  espacoDepoisPt: number,
) => regraObservada({ fonte, tamanhoPt, cor: corDoTexto, entrelinha, espacoDepoisPt }, APOSTILA);

const NEUE_HAAS = 'Neue Haas Display';
const AUTORIZACAO = 'Autorizado pelo usuário do projeto em 08/10/2026.';

/** Ativo extraído da apostila (imagem embutida no PDF), com a mesma origem. */
const ativoExtraido = (id: string, descricao: string, arquivo: string) => ({
  id,
  descricao,
  disponibilidade: 'presente' as const,
  arquivo: `server/lib/documentos/assets/editorial/${arquivo}`,
});
const REF_FONTE: Proveniencia = {
  tipo: 'observada',
  referencia: 'fontes embutidas (subconjunto) na Apostila Unit Economics.pdf',
};

const VARIANTE_EDITORIAL: VarianteVisual = {
  id: 'editorial',
  nome: 'Material editorial (apostila)',
  uso: 'Materiais de estudo e relatórios longos, com capa gráfica, sumário e destaques.',
  pagina: {
    tamanho: regraObservada('A4' as const, APOSTILA),
    margemPt: regraObservada(54, APOSTILA),
  },
  cores: {
    tinta: cor('#0B1424'),
    texto: cor('#1E2838'),
    textoSecundario: cor('#5A6576'),
    filete: cor('#DCE1E6'),
    verde: cor('#12957A'),
    verdeEscuro: cor('#0B6B57'),
    menta: cor('#5FE3C0'),
    fundoMenta: cor('#EAF4F0'),
    fundoTabelaListra: cor('#EEF2F4'),
    fundoTabelaSuave: cor('#F6F8F9'),
    fundoDestaqueEscuro: cor('#081021'),
    branco: cor('#FFFFFF'),
  },
  fontes: [
    ...(['leve', 'regular', 'italico', 'medio', 'negrito'] as const).map((peso) => ({
      familia: NEUE_HAAS,
      peso,
      disponibilidade: 'ausente' as const,
      // Fonte comercial, só embutida em subconjunto no PDF: sem arquivo
      // utilizável. A Barlow (já no projeto) cobre regular e negrito.
      substituicaoAutorizada: 'Barlow',
      autorizacao: AUTORIZACAO,
      proveniencia: REF_FONTE,
    })),
    {
      // Os rótulos técnicos (cabeçalho, "FÓRMULA", "MINI-EXERCÍCIO") usam uma
      // fonte monoespaçada que o PDF converteu em contorno: não dá para
      // descobrir qual é a partir do arquivo.
      familia: 'Monoespaçada (não identificada)',
      peso: 'regular',
      disponibilidade: 'ausente',
      substituicaoAutorizada: 'JetBrains Mono',
      autorizacao: AUTORIZACAO,
      proveniencia: {
        tipo: 'inferida',
        referencia: 'texto convertido em contorno na apostila; a mais próxima visualmente',
      },
    },
    {
      familia: 'JetBrains Mono',
      peso: 'regular',
      nomeNoRenderizador: 'JetBrainsMono',
      disponibilidade: 'presente',
      arquivo: 'server/lib/documentos/assets/editorial/fonts/JetBrainsMono-Regular.woff',
      proveniencia: { tipo: 'explicita', referencia: 'SIL Open Font License 1.1 (JetBrainsMono-OFL.txt)' },
    },
    {
      familia: 'JetBrains Mono',
      peso: 'negrito',
      nomeNoRenderizador: 'JetBrainsMono-Bold',
      disponibilidade: 'presente',
      arquivo: 'server/lib/documentos/assets/editorial/fonts/JetBrainsMono-Bold.woff',
      proveniencia: { tipo: 'explicita', referencia: 'SIL Open Font License 1.1 (JetBrainsMono-OFL.txt)' },
    },
  ],
  ativos: [
    ativoExtraido('fundo-capa', 'Fundo da capa (gradiente verde com grão)', 'fundo-capa.jpg'),
    ativoExtraido('fundo-parte', 'Fundo das aberturas de parte (arte em lâminas, azul e verde)', 'fundo-parte.jpg'),
    ...[1, 2, 3, 4].map((n) =>
      ativoExtraido(
        `fundo-abertura-${n}`,
        `Fundo do banner de abertura de capítulo, variação ${n} (gradiente com grão)`,
        `fundo-abertura-${n}.jpg`,
      ),
    ),
    ativoExtraido('forma-3d-1', 'Forma 3D cromada, com transparência (capa)', 'forma-3d-1.png'),
    ativoExtraido('forma-3d-2', 'Forma 3D cromada, segunda forma, com transparência', 'forma-3d-2.png'),
    ativoExtraido(
      'marca-branca',
      'Marca CITi em branco, para fundo escuro (a marca preta do projeto com o RGB trocado por branco)',
      'marca-branca.png',
    ),
  ],
  estilos: {
    // Capa: título 71,9 pt Medium em duas linhas coladas, subtítulo 18,7 pt Light.
    titulo_documento: estiloEditorial(`${NEUE_HAAS} Medium`, 71.9, '#FFFFFF', 0.92, 0),
    subtitulo_capa: estiloEditorial(`${NEUE_HAAS} Light`, 18.7, '#FFFFFF', 1.24, 0),
    // Título de nível 1 na página: 27 pt Medium (o Sumário usa 33 pt e "Três
    // ideias" 21 pt, então é regra adaptável). Nível 2: 15,7 pt Medium. O
    // banner de capítulo usa 45 pt Medium + 17,2 pt Light.
    titulo_secao: {
      ...estiloEditorial(`${NEUE_HAAS} Medium`, 27, '#0B1424', 1.15, 10),
      obrigatoriedade: 'adaptavel' as const,
    },
    subtitulo_secao: estiloEditorial(`${NEUE_HAAS} Medium`, 15.7, '#0B1424', 1.25, 8),
    corpo: estiloEditorial(`${NEUE_HAAS} Roman`, 9.7, '#1E2838', 1.54, 9),
    item_lista: estiloEditorial(`${NEUE_HAAS} Roman`, 9.7, '#1E2838', 1.54, 6),
    rotulo: estiloEditorial(`${NEUE_HAAS} Bold`, 9.7, '#1E2838', 1.54, 0),
    rotulo_tecnico: estiloEditorial('Monoespaçada', 7, '#5A6576', 1.4, 0),
    tabela_cabecalho: estiloEditorial('Monoespaçada', 7.5, '#FFFFFF', 1.4, 0),
    tabela_celula: estiloEditorial(`${NEUE_HAAS} Roman`, 9, '#1E2838', 1.5, 0),
    destaque_titulo: estiloEditorial('Monoespaçada', 7, '#5FE3C0', 1.4, 4),
    destaque_corpo: estiloEditorial(`${NEUE_HAAS} Medium`, 11.2, '#FFFFFF', 1.45, 0),
    legenda: {
      ...estiloEditorial(`${NEUE_HAAS} Roman`, 8.6, '#5A6576', 1.4, 4),
      proveniencia: INFERIDA_DA_APOSTILA,
      obrigatoriedade: 'adaptavel',
    },
    rodape: estiloEditorial(`${NEUE_HAAS} Medium`, 9, '#0B1424', 1.2, 0),
  },
  componentes: [
    {
      id: 'capa_gradiente',
      descricao:
        'Capa em página inteira sobre arte de gradiente escuro; marca branca no topo à esquerda; título grande e subtítulo à esquerda; filete curto, nome da área e legenda no pé.',
      proveniencia: APOSTILA,
    },
    {
      id: 'abertura_de_parte',
      descricao:
        'Página inteira sobre arte gráfica, com rótulo técnico, título grande, subtítulo e a lista dos capítulos da parte, com filetes.',
      proveniencia: APOSTILA,
    },
    {
      id: 'banner_de_capitulo',
      descricao: 'Faixa de arte no alto da primeira página do capítulo, com título e subtítulo em branco.',
      proveniencia: APOSTILA,
    },
    {
      id: 'sumario',
      descricao:
        'Título grande, entradas com filete, partes em destaque com rótulo técnico e capítulos numerados em verde, com a página à direita.',
      proveniencia: APOSTILA,
    },
    {
      id: 'cabecalho_corrente',
      descricao:
        'Rótulo técnico em caixa alta: nome do documento à esquerda e a parte/seção atual à direita, sobre um filete.',
      proveniencia: APOSTILA,
    },
    {
      id: 'rodape_numerado',
      descricao: 'Nome do documento em rótulo técnico à esquerda e número da página em negrito à direita.',
      proveniencia: APOSTILA,
    },
    {
      id: 'titulo_numerado',
      descricao: 'Título de seção com o número em verde, seguido do texto em tinta.',
      proveniencia: APOSTILA,
    },
    {
      id: 'destaque_formula',
      descricao: 'Caixa de cantos arredondados em azul quase preto, com rótulo técnico em menta e texto branco.',
      proveniencia: APOSTILA,
    },
    {
      id: 'destaque_exemplo',
      descricao: 'Caixa de cantos arredondados em fundo menta claro, com marcador verde e rótulo técnico.',
      proveniencia: APOSTILA,
    },
    {
      id: 'atividade_com_pauta',
      descricao:
        'Caixa com contorno verde e cantos arredondados, numeral grande em verde, rótulo técnico e linhas de pauta para resposta.',
      proveniencia: APOSTILA,
    },
    {
      id: 'tabela_listrada',
      descricao:
        'Cabeçalho em azul quase preto com rótulo técnico branco, linhas com filete, linhas de totais em negrito sobre fundo cinza claro e filete escuro no fim.',
      proveniencia: APOSTILA,
    },
    {
      id: 'lista_de_ideias',
      descricao: 'Itens com numeral grande em verde à esquerda e texto à direita, separados por filetes.',
      proveniencia: APOSTILA,
    },
    {
      id: 'lista_com_marcador',
      descricao: 'Marcador quadrado verde, com o termo inicial em negrito.',
      proveniencia: APOSTILA,
    },
  ],
  rodape: {
    valor: [],
    proveniencia: {
      tipo: 'observada',
      referencia: 'Apostila Unit Economics.pdf: o rodapé é "<documento> · <título>" + página',
    },
    obrigatoriedade: 'adaptavel',
  },
};

/**
 * O perfil provisório do CITi: duas variantes, ambas observadas em documentos
 * de exemplo e nenhuma validada. A variante editorial vem de UM documento, que
 * a pessoa indicou como referência de estilo visual — não de organização nem
 * de texto —, e uma referência isolada pode ser preferência individual.
 */
export const PERFIL_CITI_PROVISORIO: PerfilDocumental = {
  id: 'citi',
  versao: 2,
  nome: 'CITi (provisório)',
  estado: 'provisorio',
  observacoes: [
    'A variante "ata" vem do modelo da Ata (example.pdf).',
    'A variante "editorial" vem da Apostila Unit Economics, indicada como referência de ESTILO VISUAL; sua organização e redação não são norma do perfil.',
    'Nenhum manual de marca nem template aprovado foi fornecido; o perfil segue provisório até alguém responsável validar.',
    'As artes da variante editorial foram extraídas da própria apostila (a marca branca deriva da marca preta do projeto).',
    'A Neue Haas Display (comercial) não está no projeto: a substituição por Barlow foi autorizada e fica registrada. Os rótulos técnicos usam JetBrains Mono (OFL), a mais próxima da fonte convertida em contorno.',
  ],
  variantes: [VARIANTE_ATA, VARIANTE_EDITORIAL],
  editorial: { idioma: 'pt-BR', orientacoes: [] },
};

/** Resolve o perfil de uma versão. Hoje só existe o provisório. */
export function resolverPerfil(id = 'citi'): PerfilDocumental {
  if (id !== PERFIL_CITI_PROVISORIO.id) {
    throw new Error(`Perfil documental "${id}" não existe.`);
  }
  return PERFIL_CITI_PROVISORIO;
}

/** A variante pedida; sem pedido, a primeira. Variante inexistente falha. */
export function resolverVariante(perfil: PerfilDocumental, id?: string): VarianteVisual {
  if (!id) return perfil.variantes[0]!;
  const variante = perfil.variantes.find((v) => v.id === id);
  if (!variante) throw new Error(`Variante "${id}" não existe no perfil "${perfil.id}".`);
  return variante;
}
