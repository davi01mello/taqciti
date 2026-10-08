/**
 * Espelho, do lado da extensão, do contrato de `/api/documentos/*` — o servidor
 * é a fonte (`server/lib/documentos/contentTree.ts` e `contratos.ts`). Repetido
 * aqui, e não importado, porque a extensão não alcança arquivo de `server/`; o
 * que a extensão lê da árvore é pouco, e o resto passa por ela sem ser
 * interpretado.
 */

export type ClassificacaoDoBloco = 'fato' | 'recomendacao' | 'pendencia';

export interface ReferenciaDeFonte {
  fonteId: string;
  trecho?: string;
}

interface BlocoBase {
  blockId: string;
  fontes: ReferenciaDeFonte[];
  classificacao?: ClassificacaoDoBloco;
  origem: 'agente' | 'pessoa';
}

export type Bloco =
  | (BlocoBase & {
      tipo: 'capa';
      variante: string;
      titulo: string;
      subtitulo?: string;
      autor?: string;
      cliente?: string;
      data?: string;
    })
  | (BlocoBase & { tipo: 'titulo'; nivel: 1 | 2 | 3; texto: string })
  | (BlocoBase & { tipo: 'paragrafo'; texto: string })
  | (BlocoBase & { tipo: 'lista'; ordenada: boolean; itens: string[] })
  | (BlocoBase & { tipo: 'quebra_de_secao' })
  | (BlocoBase & { tipo: 'tabela'; cabecalho: string[]; linhas: string[][]; legenda?: string })
  // Os demais tipos existem no servidor e ainda não são montados por ele.
  | (BlocoBase & { tipo: 'imagem' | 'referencia' | 'sumario' });

export interface LacunaDoDocumento {
  blockId?: string;
  campo: string;
  pergunta: string;
}

export interface ArvoreDoDocumento {
  /** A revisão do conteúdo. Toda gravação a sobe. */
  revisao: number;
  titulo: string;
  blocos: Bloco[];
  lacunas: LacunaDoDocumento[];
}

export interface ManifestoDeRender {
  revisaoDoConteudo: number;
  perfilId: string;
  perfilVersao: number;
  perfilEstado: 'provisorio' | 'validado';
  rendererVersao: string;
  ativosEFontes: string[];
  formatos: { formato: 'pdf' | 'docx'; hash: string }[];
  paginas?: number;
}

export interface ProblemaDeQualidade {
  tipo: 'estrutural' | 'sustentacao' | 'visual';
  blockId?: string;
  pagina?: number;
  descricao: string;
}

export interface RelatorioDeQualidade {
  problemas: ProblemaDeQualidade[];
  verificacoesRealizadas: string[];
  limitacoes: string[];
}

export interface FonteDoDocumento {
  id: string;
  titulo: string;
  texto: string;
}

export interface PedidoDeGeracao {
  pedido: string;
  fontes: FonteDoDocumento[];
  capa?: { cliente?: string; autor?: string; data?: string };
  extensao?: { paginas: number; tipo: 'firme' | 'aproximada'; incluiCapa?: boolean };
  orientacoesEditoriais?: string[];
  variante?: string;
}

export interface PedidoDeEdicao {
  arvore: ArvoreDoDocumento;
  revisaoEsperada: number;
  pedido: string;
  fontes: FonteDoDocumento[];
  escopo?: string[];
  variante?: string;
}

/** O que as rotas de geração e edição devolvem, com o PDF em base64. */
export interface ResultadoDoServidor {
  arvore: ArvoreDoDocumento;
  pdf: string;
  manifesto: ManifestoDeRender;
  relatorio: RelatorioDeQualidade;
  avisos: string[];
  lacunas: LacunaDoDocumento[];
  /** Só na edição. */
  aplicadas?: number;
  recusadas?: string[];
  observacao?: string;
}
