import { describe, expect, it } from 'vitest';
import { contentTreeSchema } from '../contentTree';
import { compilarPdf } from './index';
import { inspecionarLayout, novoRegistro } from './inspecao';

const limites = { topo: 70, base: 770 }; // 700 pt de corpo

const com = (paginas: Array<[number, number, string]>) => {
  const registro = novoRegistro();
  for (const [indice, fimY, ultimo] of paginas) registro.paginas.set(indice, { fimY, ultimo, blocos: 1 });
  return registro;
};

describe('inspecionarLayout', () => {
  it('documento normal: nada a apontar', () => {
    const r = com([[1, 760, 'paragrafo'], [2, 760, 'lista'], [3, 500, 'paragrafo']]);
    expect(inspecionarLayout(r, 4, limites)).toEqual([]);
  });

  it('a capa (página 1) fica fora da inspeção', () => {
    const r = com([[0, 70, 'titulo'], [1, 700, 'paragrafo']]);
    expect(inspecionarLayout(r, 2, limites)).toEqual([]);
  });

  it('título no pé da página é apontado, com o número da página', () => {
    const r = com([[1, 740, 'titulo'], [2, 500, 'paragrafo']]);
    const [achado] = inspecionarLayout(r, 3, limites);
    expect(achado).toMatchObject({ tipo: 'visual', pagina: 2 });
    expect(achado!.descricao).toContain('termina num título');
  });

  it('página quase vazia no meio é apontada; a última curta só quando há mais de duas páginas', () => {
    const meio = com([[1, 80, 'paragrafo'], [2, 600, 'paragrafo'], [3, 90, 'paragrafo']]);
    const achados = inspecionarLayout(meio, 4, limites).map((a) => a.descricao);
    expect(achados.some((d) => d.includes('A página 2 está quase vazia'))).toBe(true);
    expect(achados.some((d) => d.includes('A última página (4)'))).toBe(true);

    // Documento de duas páginas com uma sobra curta: é normal, não avisa.
    const curto = com([[1, 90, 'paragrafo']]);
    expect(inspecionarLayout(curto, 2, limites)).toEqual([]);
  });

  it('as medidas ficam dentro de 0–100%', () => {
    const r = com([[1, 5000, 'paragrafo'], [2, -10, 'paragrafo']]);
    const achados = inspecionarLayout(r, 4, limites);
    expect(achados.length).toBeGreaterThan(0);
    for (const achado of achados) {
      for (const m of achado.descricao.matchAll(/(\d{1,4})%/g)) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(0);
        expect(Number(m[1])).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('inspeção no compilador', { timeout: 30_000 }, () => {
  const paragrafo = (id: string, texto = 'Texto curto.') => ({ tipo: 'paragrafo' as const, blockId: id, texto });

  for (const variante of ['ata', 'editorial']) {
    it(`${variante}: páginas separadas por quebras de seção com pouco conteúdo viram achados`, async () => {
      const arvore = contentTreeSchema.parse({
        revisao: 1,
        titulo: 'T',
        blocos: [
          { tipo: 'capa', blockId: 'capa', titulo: 'T' },
          paragrafo('a'),
          { tipo: 'quebra_de_secao', blockId: 'q1' },
          paragrafo('b'),
          { tipo: 'quebra_de_secao', blockId: 'q2' },
          paragrafo('c'),
        ],
      });
      const r = await compilarPdf(arvore, { variante });
      expect(r.manifesto.paginas).toBe(4);
      const descricoes = r.inspecao.map((a) => a.descricao).join(' | ');
      expect(descricoes).toContain('quase vazia');
      expect(descricoes).toContain('última página');
      expect(r.inspecao.every((a) => a.tipo === 'visual' && typeof a.pagina === 'number')).toBe(true);
    });

    it(`${variante}: um documento preenchido não gera achados`, async () => {
      const longo = Array.from({ length: 30 }, (_, i) =>
        paragrafo(`p${i}`, 'Um parágrafo com texto suficiente para ocupar bem a página, repetido várias vezes. '.repeat(8)),
      );
      const arvore = contentTreeSchema.parse({
        revisao: 1,
        titulo: 'T',
        blocos: [{ tipo: 'capa', blockId: 'capa', titulo: 'T' }, ...longo],
      });
      const r = await compilarPdf(arvore, { variante });
      // Só a última página pode ser curta; as do meio estão cheias.
      expect(r.inspecao.filter((a) => a.descricao.includes('quase vazia'))).toEqual([]);
    });
  }
});
