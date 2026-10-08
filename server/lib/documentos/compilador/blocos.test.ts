/**
 * Sumário, imagem e referência: os três blocos que fecham o catálogo.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { contentTreeSchema, validarArvore } from '../contentTree';
import { PERFIL_CITI_PROVISORIO, resolverVariante } from '../perfil';
import { compilarDocumento, compilarPdf, ErroDeCompilacao } from './index';
import { ajustarImagem, bufferDoAtivo, dimensoesDaImagem, tipoDaImagem } from './imagens';
import { compilarDocx } from './docx';
import { entradasDoSumario } from './sumario';

const SECAO = 'Um parágrafo com texto suficiente para ocupar bem a página, repetido várias vezes. '.repeat(10);

function comSumario(secoes = 6, comImagem = false) {
  const blocos: unknown[] = [
    { tipo: 'capa', blockId: 'capa', titulo: 'Relatório' },
    { tipo: 'sumario', blockId: 'sum' },
  ];
  for (let i = 1; i <= secoes; i++) {
    blocos.push({ tipo: 'titulo', blockId: `t${i}`, nivel: 1, texto: `Seção ${i}` });
    blocos.push({ tipo: 'titulo', blockId: `s${i}`, nivel: 2, texto: `Detalhe ${i}` });
    for (let j = 0; j < 5; j++) blocos.push({ tipo: 'paragrafo', blockId: `p${i}-${j}`, texto: SECAO });
    if (comImagem && i === 2) {
      blocos.push({ tipo: 'imagem', blockId: 'img', ativoId: 'forma-3d-1', textoAlternativo: 'Forma 3D institucional', legenda: 'Arte institucional.' });
    }
    blocos.push({ tipo: 'referencia', blockId: `r${i}`, texto: `Referência ${i}: **reunião** de 0${i}/10.` });
  }
  return contentTreeSchema.parse({ revisao: 1, titulo: 'Relatório', blocos });
}

describe('sumário', { timeout: 60_000 }, () => {
  it('entradas: títulos de nível 1 e 2, na ordem; o nível 3 fica de fora', () => {
    const arvore = contentTreeSchema.parse({
      revisao: 1,
      titulo: 'x',
      blocos: [
        { tipo: 'titulo', blockId: 'a', nivel: 1, texto: 'A **forte**' },
        { tipo: 'titulo', blockId: 'b', nivel: 3, texto: 'B' },
        { tipo: 'titulo', blockId: 'c', nivel: 2, texto: 'C' },
      ],
    });
    expect(entradasDoSumario(arvore)).toEqual([
      { blockId: 'a', nivel: 1, texto: 'A forte' },
      { blockId: 'c', nivel: 2, texto: 'C' },
    ]);
  });

  for (const variante of ['ata', 'editorial']) {
    it(`${variante}: o número impresso é a página em que o título caiu, e a paginação não se move`, async () => {
      const r = await compilarPdf(comSumario(6), { variante });
      const paginas = new Map(r.titulos.map((t) => [t.blockId, t.pagina]));
      // O sumário está na página 2; o primeiro título só pode estar depois dele.
      expect(paginas.get('t1')!).toBeGreaterThanOrEqual(2);
      // A ordem física segue a do documento.
      const ordem = ['t1', 't2', 't3', 't4', 't5', 't6'].map((id) => paginas.get(id)!);
      expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
      expect(ordem[5]!).toBeGreaterThan(ordem[0]!);
      // A segunda passada não deslocou nada: sem aviso de paginação.
      expect(r.avisos.join(' ')).not.toContain('paginação mudou');
      // O que vem depois do sumário flui pela largura toda: 6 seções de 5 parágrafos
      // cabem em poucas páginas (coluna espremida chegou a gerar 70).
      expect(r.manifesto.paginas!).toBeLessThan(16);

      const pasta = process.env.DOCUMENTOS_AMOSTRAS;
      if (pasta) {
        mkdirSync(pasta, { recursive: true });
        writeFileSync(join(pasta, `sumario-${variante}.pdf`), r.pdf);
      }
    });
  }

  it('com sumário, o documento tem as mesmas páginas que teria sem o número (duas passadas, mesmo espaço)', async () => {
    const com = await compilarPdf(comSumario(5), { variante: 'editorial' });
    const sem = await compilarPdf(
      contentTreeSchema.parse({
        ...comSumario(5),
        blocos: comSumario(5).blocos.map((b) => (b.tipo === 'sumario' ? { ...b, tipo: 'sumario' } : b)),
      }),
      { variante: 'editorial' },
    );
    expect(com.manifesto.paginas).toBe(sem.manifesto.paginas);
  });

  it('só um sumário, e depois da capa', () => {
    const duplo = contentTreeSchema.parse({
      revisao: 1,
      titulo: 'x',
      blocos: [{ tipo: 'sumario', blockId: 'a' }, { tipo: 'sumario', blockId: 'b' }],
    });
    const problemas = validarArvore(duplo).map((p) => p.problema);
    expect(problemas).toContain('O documento só pode ter um sumário.');
    expect(problemas).toContain('O sumário vem depois da capa.');
  });
});

describe('imagem', { timeout: 60_000 }, () => {
  it('lê as dimensões de PNG e JPEG do cabeçalho do arquivo', () => {
    const variante = resolverVariante(PERFIL_CITI_PROVISORIO, 'editorial');
    const png = bufferDoAtivo(variante, 'forma-3d-1')!;
    const jpg = bufferDoAtivo(variante, 'fundo-capa')!;
    expect(tipoDaImagem(png)).toBe('png');
    expect(tipoDaImagem(jpg)).toBe('jpg');
    expect(dimensoesDaImagem(png)).toEqual({ largura: 900, altura: 900 });
    expect(dimensoesDaImagem(jpg).altura).toBeGreaterThan(dimensoesDaImagem(jpg).largura);
    expect(() => dimensoesDaImagem(Buffer.from('não é imagem'))).toThrow(/PNG e JPEG/);
  });

  it('cabe na caixa mantendo a proporção, e nunca amplia', () => {
    expect(ajustarImagem({ largura: 900, altura: 900 }, { larguraMax: 400, alturaMax: 300 })).toEqual({ largura: 300, altura: 300 });
    expect(ajustarImagem({ largura: 100, altura: 50 }, { larguraMax: 400, alturaMax: 300 })).toEqual({ largura: 100, altura: 50 });
  });

  it('só ativo aprovado do perfil: ativo desconhecido ou de outra variante é recusado', async () => {
    const arvore = (ativoId: string) =>
      contentTreeSchema.parse({
        revisao: 1,
        titulo: 'x',
        blocos: [{ tipo: 'imagem', blockId: 'i', ativoId, textoAlternativo: 'x' }],
      });
    await expect(compilarPdf(arvore('qualquer-coisa'), { variante: 'editorial' })).rejects.toBeInstanceOf(ErroDeCompilacao);
    // "forma-3d-1" é da variante editorial: a Ata não a tem.
    await expect(compilarPdf(arvore('forma-3d-1'), { variante: 'ata' })).rejects.toThrow(/ativo que o perfil não tem/);
    // A marca preta é da Ata e é aprovada lá.
    const ok = await compilarPdf(arvore('marca-preta'), { variante: 'ata' });
    expect(ok.manifesto.ativosEFontes).toContain('marca-preta');
  });
});

describe('os três blocos juntos', { timeout: 60_000 }, () => {
  for (const variante of ['ata', 'editorial']) {
    it(`${variante}: documento com sumário, imagem e referências compila e registra o ativo usado`, async () => {
      // A Ata não tem a forma 3D: usa a marca.
      const arvore = variante === 'ata'
        ? contentTreeSchema.parse({
            ...comSumario(3),
            blocos: [
              ...comSumario(3).blocos,
              { tipo: 'imagem', blockId: 'img', ativoId: 'marca-preta', textoAlternativo: 'Marca', legenda: 'Marca CITi.', fontes: [], origem: 'agente' },
            ],
          })
        : comSumario(3, true);
      const r = await compilarPdf(arvore, { variante });
      expect(r.pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(r.manifesto.ativosEFontes).toContain(variante === 'ata' ? 'marca-preta' : 'forma-3d-1');
    });
  }

  it('DOCX: sumário vira campo do Word (atualizado ao abrir), imagem e referência são nativas', async () => {
    const { docx } = await compilarDocx(comSumario(3, true), resolverVariante(PERFIL_CITI_PROVISORIO, 'editorial'));
    const zip = await JSZip.loadAsync(docx);
    const doc = await zip.file('word/document.xml')!.async('string');
    expect(doc).toContain('TOC \\h');
    expect(doc).toContain('<w:drawing>');
    expect(doc).toContain('Forma 3D institucional');
    expect(doc).toContain('Arte institucional.');
    expect(doc).toContain('Referência 1');
    const configuracoes = await zip.file('word/settings.xml')!.async('string');
    expect(configuracoes).toContain('<w:updateFields/>');
    // O arquivo de imagem foi embutido no pacote.
    expect(Object.keys(zip.files).some((n) => n.startsWith('word/media/'))).toBe(true);
  });

  it('DOCX sem sumário não pede atualização de campos', async () => {
    const arvore = contentTreeSchema.parse({ revisao: 1, titulo: 'x', blocos: [{ tipo: 'paragrafo', blockId: 'p', texto: 'oi' }] });
    const { docx } = await compilarDocx(arvore, resolverVariante(PERFIL_CITI_PROVISORIO, 'ata'));
    const zip = await JSZip.loadAsync(docx);
    const configuracoes = await zip.file('word/settings.xml')!.async('string');
    expect(configuracoes).toContain('<w:updateFields w:val="false"/>');
  });

  it('compilarDocumento entrega PDF e DOCX de um documento com os três blocos', async () => {
    const r = await compilarDocumento(comSumario(3, true), { variante: 'editorial', formatos: ['pdf', 'docx'] });
    expect(r.manifesto.formatos.map((f) => f.formato)).toEqual(['pdf', 'docx']);
    expect(r.manifesto.revisaoDoConteudo).toBe(1);
  });
});
