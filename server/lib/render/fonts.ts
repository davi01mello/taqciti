/**
 * Barlow embutida no PDF — a fonte do documento, por decisão do autor.
 *
 * ── É uma divergência DELIBERADA do modelo ───────────────────────────────
 *
 * `public/assets-docs/ata-de-reuniao/example.pdf` usa Arial. Todo o resto
 * deste render persegue o modelo medida por medida; a fonte é o ponto em que
 * ele foi sobreposto de propósito. Se um dia alguém comparar os dois lado a
 * lado e estranhar, é isto: não é regressão, é escolha.
 *
 * ── Por que EMBUTIR o arquivo, e não pedir a fonte pelo nome ─────────────
 *
 * Barlow não é uma das 14 fontes padrão do PDF nem vem instalada em Windows,
 * macOS ou na maioria dos leitores. Um PDF que apenas PEDE "Barlow" abre com
 * o que o leitor tiver no lugar — e o documento chega ao cliente com outra
 * cara, sem ninguém perceber do lado de cá. Embutido, o arquivo carrega a
 * fonte consigo e é idêntico em qualquer máquina. O `pdfkit` ainda faz
 * subconjunto, então só entram os glifos usados.
 *
 * ── Licença ──────────────────────────────────────────────────────────────
 *
 * Barlow é SIL Open Font License 1.1, que PERMITE embutir em documento e
 * redistribuir, e EXIGE que a licença acompanhe o arquivo da fonte. Por isso
 * `assets/fonts/OFL.txt` está versionado ao lado dos `.ttf` — não é
 * documentação opcional, é a condição de uso. Não apague.
 *
 * Origem: `github.com/google/fonts`, diretório `ofl/barlow` (projeto
 * upstream: `github.com/jpt/barlow`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Nomes com que as fontes são registradas no `pdfkit`. Use SEMPRE estas
 *  constantes em vez da string solta: um `doc.font('Barlow')` com erro de
 *  digitação não falha, o `pdfkit` cai numa fonte padrão e o documento sai
 *  com a fonte errada em silêncio. */
export const FONTE_REGULAR = 'Barlow';
export const FONTE_NEGRITO = 'Barlow-Bold';

const ARQUIVOS: Record<string, string> = {
  [FONTE_REGULAR]: 'Barlow-Regular.ttf',
  [FONTE_NEGRITO]: 'Barlow-Bold.ttf',
};

const cache = new Map<string, Buffer>();

function lerFonte(nome: string): Buffer {
  const emCache = cache.get(nome);
  if (emCache) return emCache;

  const caminho = join(process.cwd(), 'lib', 'render', 'assets', 'fonts', ARQUIVOS[nome]!);
  let buffer: Buffer;
  try {
    buffer = readFileSync(caminho);
  } catch (error) {
    // Falha ALTO, pelo mesmo motivo da marca: sem o arquivo o `pdfkit`
    // desenharia com Helvetica e o documento sairia com a fonte errada sem
    // erro nenhum — defeito que só aparece com o PDF já na mão de alguém.
    throw new Error(
      `Fonte ${nome} não encontrada em ${caminho}. Causa: ${(error as Error).message}`,
    );
  }
  cache.set(nome, buffer);
  return buffer;
}

/** Registra Barlow no documento. Chame ANTES do primeiro `doc.font(...)`. */
export function registrarFontes(doc: PDFKit.PDFDocument): void {
  doc.registerFont(FONTE_REGULAR, lerFonte(FONTE_REGULAR));
  doc.registerFont(FONTE_NEGRITO, lerFonte(FONTE_NEGRITO));
}

/** Pro teste conferir que o arquivo embutido é mesmo Barlow. */
export function fonteBuffer(nome: string): Buffer {
  return lerFonte(nome);
}
