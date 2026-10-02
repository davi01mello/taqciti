/**
 * O catálogo de documentos da extensão (`src/features/documents/catalogo.ts`)
 * é quem a interface e o Taq leem; os templates daqui são quem o pipeline de
 * geração usa. Os dois descrevem os MESMOS tipos, e este teste é o que impede
 * que divirjam em silêncio: seção nova num lado sem o outro quebra aqui.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGO_DE_DOCUMENTOS } from '../../../src/features/documents/catalogo';
import { TEMPLATES } from './index';

describe('catálogo de documentos × templates do servidor', () => {
  for (const tipo of CATALOGO_DE_DOCUMENTOS) {
    it(`${tipo.id}: mesmas seções, títulos e ordem`, () => {
      const template = TEMPLATES[tipo.id];
      expect(tipo.nome).toBe(template.label);
      expect(tipo.tituloDoDocumento).toBe(template.documentTitle);
      const doServidor = [...template.sections]
        .sort((a, b) => a.order - b.order)
        .map((s) => ({ id: s.id, titulo: s.title, obrigatoria: s.required }));
      expect(tipo.estrutura.map((s) => ({ id: s.id, titulo: s.titulo, obrigatoria: s.obrigatoria }))).toEqual(
        doServidor,
      );
      for (const campo of tipo.campos) {
        expect(tipo.estrutura.map((s) => s.id)).toContain(campo.secao);
      }
    });
  }
});
