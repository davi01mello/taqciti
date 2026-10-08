import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { contentTreeSchema, type ContentTree } from '../contentTree';
import { PERFIL_CITI_PROVISORIO, resolverVariante } from '../perfil';
import { compilarDocumento, ErroDeCompilacao } from './index';
import { compilarDocx, familiaDoDocx } from './docx';

const arvore = (extra: unknown[] = []): ContentTree =>
  contentTreeSchema.parse({
    revisao: 4,
    titulo: 'Proposta Aurora',
    blocos: [
      { tipo: 'capa', blockId: 'capa', titulo: 'Proposta de modernização', subtitulo: 'Diagnóstico', cliente: 'Aurora', autor: 'CITi', data: '08/10/2026' },
      { tipo: 'titulo', blockId: 't1', nivel: 1, texto: 'Contexto' },
      { tipo: 'paragrafo', blockId: 'p1', texto: 'O **gargalo** está na integração.' },
      { tipo: 'titulo', blockId: 't2', nivel: 2, texto: 'Detalhes' },
      { tipo: 'lista', blockId: 'l1', itens: ['Primeiro', 'Segundo'] },
      { tipo: 'lista', blockId: 'l2', ordenada: true, itens: ['Validar', 'Estimar'] },
      { tipo: 'lista', blockId: 'l3', ordenada: true, itens: ['Outra lista', 'Reinicia a contagem'] },
      {
        tipo: 'tabela',
        blockId: 'tab',
        cabecalho: ['Item', 'Valor'],
        linhas: Array.from({ length: 60 }, (_, i) => [`Item ${i + 1}`, `R$ ${(i + 1) * 100}`]),
        legenda: 'Fonte: reunião.',
      },
      { tipo: 'quebra_de_secao', blockId: 'q' },
      { tipo: 'paragrafo', blockId: 'p2', texto: 'Depois da quebra.' },
      ...extra,
    ],
  });

async function xmlDe(buffer: Buffer, arquivo: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const entrada = zip.file(arquivo);
  if (!entrada) throw new Error(`${arquivo} não está no DOCX`);
  return entrada.async('string');
}

describe('compilarDocx', { timeout: 30_000 }, () => {
  for (const id of ['ata', 'editorial']) {
    it(`${id}: gera um DOCX válido com os blocos como elementos nativos do Word`, async () => {
      const variante = resolverVariante(PERFIL_CITI_PROVISORIO, id);
      const { docx } = await compilarDocx(arvore(), variante);

      // Um ZIP de verdade (PK) com as partes do pacote.
      expect(docx.subarray(0, 2).toString()).toBe('PK');
      const doc = await xmlDe(docx, 'word/document.xml');

      expect(doc).toContain('Proposta de modernização');
      expect(doc).toContain('Aurora · CITi');
      expect(doc).toContain('08/10/2026');
      // Títulos com estilo de título (editáveis no Word), não texto solto.
      expect(doc).toContain('w:pStyle w:val="Heading1"');
      expect(doc).toContain('w:pStyle w:val="Heading2"');
      // O negrito inline virou run em negrito.
      expect(doc).toMatch(/<w:b\/>[\s\S]{0,200}gargalo/);
      // Listas com numeração de verdade; a segunda ordenada reinicia (outra instância).
      expect(doc).toContain('w:numPr');
      const numeros = new Set([...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]));
      expect(numeros.size).toBeGreaterThanOrEqual(3);
      // Tabela com cabeçalho que se repete e linhas que não partem entre páginas.
      expect(doc).toContain('<w:tblHeader');
      expect(doc).toContain('<w:cantSplit');
      expect(doc).toContain('Fonte: reunião.');
      // Quebra de seção do pedido.
      expect(doc).toContain('w:pageBreakBefore');

      const estilos = await xmlDe(docx, 'word/styles.xml');
      expect(estilos).toContain('Heading1');
      expect(estilos).toContain('Barlow');

      const pasta = process.env.DOCUMENTOS_AMOSTRAS;
      if (pasta) {
        mkdirSync(pasta, { recursive: true });
        writeFileSync(join(pasta, `${id}.docx`), docx);
      }
    });
  }

  it('o cabeçalho e o rodapé trazem o título e o número da página', async () => {
    const { docx } = await compilarDocx(arvore(), resolverVariante(PERFIL_CITI_PROVISORIO, 'editorial'));
    const zip = await JSZip.loadAsync(docx);
    const partes = await Promise.all(
      Object.keys(zip.files)
        .filter((n) => /word\/(header|footer)\d*\.xml/.test(n))
        .map((n) => zip.file(n)!.async('string')),
    );
    const todos = partes.join('\n');
    expect(todos).toContain('PROPOSTA AURORA');
    expect(todos).toContain('CITi · Proposta Aurora');
    expect(todos).toContain('PAGE');
  });

  it('avisa as limitações do formato: fonte instalada e capa sem a arte', async () => {
    const { avisos } = await compilarDocx(arvore(), resolverVariante(PERFIL_CITI_PROVISORIO, 'editorial'));
    expect(avisos.join(' ')).toContain('Barlow');
    expect(avisos.join(' ')).toContain('sem a arte de fundo');
  });

  it('linha de tabela irregular não derruba o arquivo', async () => {
    const irregular = contentTreeSchema.parse({
      revisao: 1,
      titulo: 'x',
      blocos: [{ tipo: 'tabela', blockId: 't', cabecalho: ['a', 'b'], linhas: [['1'], ['1', '2', '3']] }],
    });
    const { docx } = await compilarDocx(irregular, resolverVariante(PERFIL_CITI_PROVISORIO, 'ata'));
    expect(docx.subarray(0, 2).toString()).toBe('PK');
  });

  it('a família do DOCX segue as substituições autorizadas do perfil', () => {
    expect(familiaDoDocx('Neue Haas Display Medium')).toBe('Barlow');
    expect(familiaDoDocx('Monoespaçada')).toBe('JetBrains Mono');
    expect(familiaDoDocx('Barlow-Bold')).toBe('Barlow');
  });
});

describe('compilarDocumento', { timeout: 30_000 }, () => {
  it('PDF e DOCX saem da mesma revisão, num manifesto só, com os dois hashes', async () => {
    const r = await compilarDocumento(arvore(), { variante: 'editorial', formatos: ['pdf', 'docx'] });
    expect(r.pdf?.subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.docx?.subarray(0, 2).toString()).toBe('PK');
    expect(r.manifesto.revisaoDoConteudo).toBe(4);
    expect(r.manifesto.formatos.map((f) => f.formato)).toEqual(['pdf', 'docx']);
    expect(r.manifesto.formatos.every((f) => f.hash.length === 64)).toBe(true);
    expect(r.manifesto.paginas).toBeGreaterThanOrEqual(3);
  });

  it('só DOCX: lista só o DOCX e não inventa contagem de páginas', async () => {
    const r = await compilarDocumento(arvore(), { variante: 'ata', formatos: ['docx'] });
    expect(r.pdf).toBeUndefined();
    expect(r.manifesto.formatos.map((f) => f.formato)).toEqual(['docx']);
    expect(r.manifesto.paginas).toBeUndefined();
  });

  it('as mesmas recusas do PDF valem para o DOCX; sem formato é erro', async () => {
    const imagem = contentTreeSchema.parse({
      revisao: 0,
      titulo: 'x',
      blocos: [{ tipo: 'imagem', blockId: 'i', ativoId: 'a', textoAlternativo: 'x' }],
    });
    await expect(compilarDocumento(imagem, { formatos: ['docx'] })).rejects.toBeInstanceOf(ErroDeCompilacao);
    await expect(compilarDocumento(arvore(), { formatos: [] })).rejects.toThrow(/Nenhum formato/);
  });
});
