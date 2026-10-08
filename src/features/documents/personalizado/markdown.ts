/**
 * A árvore como texto, para a seção "Documentos" listar e abrir o documento
 * como qualquer outro. É uma VISTA: a fonte de verdade continua sendo a árvore
 * (e o PDF sai dela, no servidor). Editar este texto não altera a árvore.
 */
import type { ArvoreDoDocumento, Bloco } from './tipos';

function blocoEmMarkdown(bloco: Bloco): string | null {
  switch (bloco.tipo) {
    case 'capa':
      return [`# ${bloco.titulo}`, ...(bloco.subtitulo ? ['', `_${bloco.subtitulo}_`] : [])].join('\n');
    case 'titulo':
      return `${'#'.repeat(Math.min(3, bloco.nivel) + 1)} ${bloco.texto}`;
    case 'paragrafo':
      return bloco.texto;
    case 'lista':
      return bloco.itens.map((item, i) => (bloco.ordenada ? `${i + 1}. ${item}` : `- ${item}`)).join('\n');
    case 'quebra_de_secao':
      return '---';
    default:
      // Tabela, imagem etc. não são geradas ainda: não inventa representação.
      return null;
  }
}

export function arvoreParaMarkdown(arvore: ArvoreDoDocumento): string {
  return arvore.blocos
    .map(blocoEmMarkdown)
    .filter((trecho): trecho is string => trecho !== null)
    .join('\n\n');
}
