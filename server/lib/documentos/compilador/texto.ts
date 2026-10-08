/**
 * Texto com ênfase mínima: `**negrito**`. É o único recurso inline que o
 * redator tem — nada de HTML, nada de estilo livre. Marcação sem par fecha no
 * fim do texto em vez de vazar para o resto do documento.
 */
export interface Segmento {
  texto: string;
  negrito: boolean;
}

export function segmentos(texto: string): Segmento[] {
  const partes = texto.split('**');
  const saida: Segmento[] = [];
  partes.forEach((parte, indice) => {
    if (parte) saida.push({ texto: parte, negrito: indice % 2 === 1 });
  });
  return saida.length > 0 ? saida : [{ texto: '', negrito: false }];
}

/** O texto como o leitor o vê, sem a marcação. Serve para medir. */
export function textoPlano(texto: string): string {
  return segmentos(texto)
    .map((s) => s.texto)
    .join('');
}

/**
 * Escreve o texto no cursor atual alternando regular e negrito. `opcoes` vale
 * para todos os segmentos (largura, entrelinha, alinhamento).
 */
export function escreverRico(
  doc: PDFKit.PDFDocument,
  texto: string,
  fonteRegular: string,
  fonteNegrito: string,
  opcoes: PDFKit.Mixins.TextOptions = {},
): void {
  const lista = segmentos(texto);
  lista.forEach((segmento, indice) => {
    doc.font(segmento.negrito ? fonteNegrito : fonteRegular);
    doc.text(segmento.texto, {
      ...opcoes,
      continued: indice < lista.length - 1,
    });
  });
}
