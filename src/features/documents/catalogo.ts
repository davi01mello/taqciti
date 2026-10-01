/**
 * O CATÁLOGO de documentos do TaqCiti — a fonte única dos tipos que existem.
 *
 * Dois tipos, os mesmos que têm modelo de verdade no servidor
 * (`server/lib/templates/ata.ts` e `x1.ts`). A estrutura abaixo espelha as
 * seções daqueles modelos — ids, títulos e ordem — e um teste do servidor
 * (`server/lib/templates/catalogo.test.ts`) falha se os dois divergirem.
 *
 * Quem lê daqui:
 *   - a tela "Gerar documento" (`home/GerarDocumento.tsx`): os botões de tipo;
 *   - o Taq (`features/taq/ferramentas.ts`): as opções que ele oferece, a
 *     estrutura que `create_document` aplica e os campos que ele pergunta.
 *
 * Dados puros, sem dependência nenhuma, de propósito: o servidor importa este
 * arquivo no teste de consistência, e ele não pode puxar a extensão junto.
 *
 * Tipo fora daqui não existe no TaqCiti. O Taq não converte um pedido de
 * "relatório" ou "proposta" num destes em silêncio — ele explica e oferece um
 * texto para levar ao Claude (ver `prepare_external_brief`).
 */

export type IdDoTipoDeDocumento = 'ata' | 'x1';

export interface SecaoDoModelo {
  id: string;
  titulo: string;
  /** Sem conteúdo nas fontes: `true` = aparece como "A confirmar"; `false` = some. */
  obrigatoria: boolean;
  /** O que a seção pede das fontes. */
  precisa: string[];
}

export interface CampoDoDocumento {
  id: string;
  rotulo: string;
  /** Em que seção o campo aparece. */
  secao: string;
  /**
   * `true` = sem ele o documento não é gerado: o Taq pergunta. `false` = sem
   * ele, o campo sai como "Não informado" e entra nas pendências.
   */
  indispensavel: boolean;
  /** A pergunta que o Taq faz quando o campo indispensável falta. */
  pergunta: string;
}

export interface TipoDeDocumento {
  id: IdDoTipoDeDocumento;
  nome: string;
  /** Uma frase — é o que aparece ao lado da opção. */
  finalidade: string;
  /** Título do documento renderizado (o mesmo `documentTitle` do servidor). */
  tituloDoDocumento: string;
  /** Nomes com que a pessoa costuma pedir este tipo. Sem acento, minúsculas. */
  apelidos: string[];
  estrutura: SecaoDoModelo[];
  campos: CampoDoDocumento[];
}

export const CATALOGO_DE_DOCUMENTOS: readonly TipoDeDocumento[] = [
  {
    id: 'ata',
    nome: 'Ata de Reunião',
    finalidade:
      'Registra o fechamento de uma reunião: participantes, tópicos, decisões e conclusão, para as pessoas envolvidas revisarem.',
    tituloDoDocumento: 'Ata de reunião',
    apelidos: ['ata', 'ata de reuniao', 'ata da reuniao'],
    estrutura: [
      {
        id: 'identificacao',
        titulo: 'Identificação',
        obrigatoria: true,
        precisa: ['data da reunião', 'nome do projeto'],
      },
      {
        id: 'topico_geral',
        titulo: 'Tópico geral',
        obrigatoria: true,
        precisa: ['tema central', 'estado geral do assunto'],
      },
      {
        id: 'participantes',
        titulo: 'Participantes e cargos',
        obrigatoria: true,
        precisa: ['quem participou', 'cargo ou papel de cada um'],
      },
      {
        id: 'topicos_discutidos',
        titulo: 'Tópicos discutidos',
        obrigatoria: true,
        precisa: ['assuntos tratados, na ordem'],
      },
      {
        id: 'decisoes',
        titulo: 'Decisões tomadas',
        obrigatoria: true,
        precisa: ['decisões confirmadas (não propostas)'],
      },
      {
        id: 'outcomes',
        titulo: 'Outcomes da reunião',
        obrigatoria: false,
        precisa: ['alinhamentos e entendimentos compartilhados'],
      },
      {
        id: 'outputs',
        titulo: 'Outputs da reunião',
        obrigatoria: false,
        precisa: ['artefatos e resultados concretos'],
      },
      {
        id: 'conclusao',
        titulo: 'Conclusão',
        obrigatoria: true,
        precisa: ['situação atual, andamento e foco imediato'],
      },
      {
        id: 'assinatura',
        titulo: 'Assinatura',
        obrigatoria: true,
        precisa: ['nome e cargo de quem assina'],
      },
    ],
    campos: [
      {
        id: 'projeto',
        rotulo: 'Projeto',
        secao: 'identificacao',
        indispensavel: true,
        pergunta: 'Qual é o nome do projeto desta ata?',
      },
      {
        id: 'assinatura_nome',
        rotulo: 'Assinado por',
        secao: 'assinatura',
        indispensavel: false,
        pergunta: 'Qual nome deve assinar a ata?',
      },
      {
        id: 'assinatura_cargo',
        rotulo: 'Cargo de quem assina',
        secao: 'assinatura',
        indispensavel: false,
        pergunta: 'Qual é o cargo de quem assina?',
      },
    ],
  },
  {
    id: 'x1',
    nome: 'Doc Conversa (X1)',
    finalidade:
      'Registra uma conversa individual (1:1 ou entrevista) como pares de pergunta e resposta, na ordem em que aconteceram.',
    tituloDoDocumento: 'Doc de Conversa 1:1 — X1',
    apelidos: [
      'x1',
      'doc conversa',
      'conversa 1:1',
      '1:1',
      'um a um',
      'conversa individual',
      'entrevista',
    ],
    estrutura: [
      {
        id: 'perguntas_respostas',
        titulo: 'Perguntas e respostas',
        obrigatoria: true,
        precisa: ['cada pergunta do entrevistador', 'a resposta a cada pergunta'],
      },
    ],
    campos: [
      {
        id: 'entrevistado',
        rotulo: 'Entrevistado',
        secao: 'perguntas_respostas',
        indispensavel: false,
        pergunta: 'Quem é a pessoa entrevistada?',
      },
    ],
  },
];

export function tipoDeDocumento(id: string): TipoDeDocumento | undefined {
  return CATALOGO_DE_DOCUMENTOS.find((t) => t.id === id);
}

export const IDS_DE_TIPO = CATALOGO_DE_DOCUMENTOS.map((t) => t.id) as [
  IdDoTipoDeDocumento,
  ...IdDoTipoDeDocumento[],
];
