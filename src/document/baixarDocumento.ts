/**
 * Baixa o documento como arquivo.
 *
 * ── PDF é o caminho padrão ───────────────────────────────────────────────
 *
 * Funciona SEM nenhuma configuração — não depende de cliente OAuth
 * registrado, de Drive API ativada nem de consentimento. O servidor já
 * devolve o PDF pronto (`server/lib/render/pdf.ts`, irmão do HTML, saído do
 * mesmo `documentData`); baixar é só decodificar e salvar, sem passo manual
 * nenhum depois.
 *
 * ── HTML é o fallback ───────────────────────────────────────────────────
 *
 * Existe pra quando o servidor não mandou `pdf` (versão antiga, ou a geração
 * do PDF falhou daquela vez) e pro caminho OAuth direto ao Google Docs
 * (`criarGoogleDoc`), que precisa de HTML — é o que o conversor do Drive
 * (`files.create`) entende, preservando cabeçalho, lista e negrito. Markdown
 * chegaria ao Docs como texto cru, com `##` e `**` à vista.
 */

/** O que o Windows recusa em nome de arquivo. Espaço e travessão NÃO entram
 *  na lista: eles são o formato de nome que a especificação pede. */
const PROIBIDOS_NO_NOME = /[<>:"/\\|?*]/g;

/** Caracteres de controle, que alguns sistemas de arquivo também recusam. */
const CONTROLE = /[\u0000-\u001f\u007f]/g;

/**
 * Dispara o download de um Blob já pronto.
 *
 * Blob + `<a download>` em vez de `chrome.downloads`: a API de downloads
 * exigiria a permissão homônima, que aparece na tela de instalação como
 * "Gerenciar seus downloads" — aviso desproporcional para salvar um arquivo
 * que o próprio usuário acabou de pedir. O caminho do blob funciona nos dois
 * contextos onde o botão vive (página da extensão e painel injetado na aba).
 */
function dispararDownload(blob: Blob, nomeComExtensao: string): void {
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = nomeComExtensao;
  // Fora da árvore visível: o clique programático funciona sem o elemento
  // estar pintado, e anexá-lo ao body do Meet mexeria no DOM de uma página de
  // terceiro sem necessidade.
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  link.remove();

  // O objeto fica vivo até ser revogado, e revogar cedo demais cancela o
  // download em andamento. Dez segundos depois do clique é folgado e não vaza.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Baixa o conteúdo EDITÁVEL de um documento guardado.
 *
 * `.md` porque é markdown o que a geração devolve em `content` e o que o
 * editor edita — e é o texto editado que precisa sair no arquivo. Baixar o
 * HTML guardado ao lado entregaria a versão de ANTES da edição, que é
 * exatamente o modo de falhar que o requisito nomeia ("o download contém a
 * versão salva").
 */
export function baixarComoTexto(
  conteudo: string,
  nomeSemExtensao: string,
  extensao: 'md' | 'txt' = 'md',
): void {
  const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' });
  dispararDownload(blob, `${sanitizarNomeDeArquivo(nomeSemExtensao)}.${extensao}`);
}

export function baixarComoHtml(html: string, nomeSemExtensao: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  dispararDownload(blob, `${sanitizarNomeDeArquivo(nomeSemExtensao)}.html`);
}

/**
 * Baixa o PDF que o servidor já devolveu pronto.
 *
 * `pdfBase64` vem de `GerarDocumento` como base64 (a rota é JSON, não pode
 * mandar binário cru) — decodifica com `atob` (disponível nos dois contextos
 * onde este arquivo roda, página da extensão e content script) e converte
 * pra bytes antes de virar Blob.
 */
export function baixarComoPdf(pdfBase64: string, nomeSemExtensao: string): void {
  const binario = atob(pdfBase64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);

  const blob = new Blob([bytes], { type: 'application/pdf' });
  dispararDownload(blob, `${sanitizarNomeDeArquivo(nomeSemExtensao)}.pdf`);
}

/** Baixa o DOCX (Word) que o servidor devolveu em base64. */
export function baixarComoDocx(docxBase64: string, nomeSemExtensao: string): void {
  const binario = atob(docxBase64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);

  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  dispararDownload(blob, `${sanitizarNomeDeArquivo(nomeSemExtensao)}.docx`);
}

/**
 * Tira o que o sistema de arquivos recusa.
 *
 * O nome vem de `nomeDoArquivo`, que monta "Ata de Reunião — {projeto} —
 * {data}" a partir de texto que veio de uma reunião real. Uma barra no nome do
 * projeto faria o download salvar com nome truncado, ou falhar em silêncio.
 */
export function sanitizarNomeDeArquivo(nome: string): string {
  const limpo = nome
    .replace(PROIBIDOS_NO_NOME, '')
    .replace(CONTROLE, '')
    .replace(/\s+/g, ' ')
    // Ponto final some: o Windows descarta pontos no fim, e o arquivo sai com
    // nome diferente do que a extensão pediu.
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 150)
    .trim();

  return limpo || 'documento';
}
