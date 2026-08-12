/**
 * Este arquivo passou a rodar de verdade. Antes era um script que dependia
 * de `node lib/templates/templates.test.ts` resolver import ESM sem
 * extensão — o que não acontece, então ele nunca executou. Com nove seções
 * na Ata, id ou order duplicado deixou de ser hipótese remota.
 *
 * `validateTemplates` continua função pura e exportada: quem quiser checar
 * um template montado em runtime (Fase 5) usa a mesma função.
 */
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from './index';
import type { DocumentTemplate } from './types';

export function validateTemplates(templates: Record<string, DocumentTemplate>): string[] {
  const errors: string[] = [];
  for (const [documentType, template] of Object.entries(templates)) {
    const seenIds = new Set<string>();
    const seenOrders = new Set<number>();
    for (const section of template.sections) {
      if (seenIds.has(section.id)) {
        errors.push(`${documentType}: id de seção duplicado "${section.id}"`);
      }
      seenIds.add(section.id);

      if (seenOrders.has(section.order)) {
        errors.push(`${documentType}: order de seção repetido ${section.order}`);
      }
      seenOrders.add(section.order);
    }
  }
  return errors;
}

describe('validateTemplates', () => {
  it('não acha id nem order duplicado nos templates reais', () => {
    expect(validateTemplates(TEMPLATES)).toEqual([]);
  });

  it('pega id duplicado', () => {
    const errors = validateTemplates({
      falso: {
        documentType: 'ata',
        label: 'Falso',
        sections: [
          { ...stubSection, id: 'mesmo', order: 1 },
          { ...stubSection, id: 'mesmo', order: 2 },
        ],
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('id de seção duplicado');
  });

  it('pega order duplicado', () => {
    const errors = validateTemplates({
      falso: {
        documentType: 'ata',
        label: 'Falso',
        sections: [
          { ...stubSection, id: 'a', order: 1 },
          { ...stubSection, id: 'b', order: 1 },
        ],
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('order de seção repetido');
  });
});

describe('template da Ata', () => {
  it('tem as nove seções da especificação, em ordem contínua de 1 a 9', () => {
    const orders = TEMPLATES.ata.sections.map((section) => section.order).sort((a, b) => a - b);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('Participantes e Decisões são as seções de auditoria estrita', () => {
    // O Auditor da Fase 4 roda somente em `audit: 'strict'`. Se esta lista
    // mudar sem querer, o Auditor deixa de rodar onde inventar custa caro.
    const strict = TEMPLATES.ata.sections
      .filter((section) => section.audit === 'strict')
      .map((section) => section.id)
      .sort();
    expect(strict).toEqual(['decisoes', 'participantes']);
  });

  it('toda seção obrigatória sem askWhenMissing degrada em silêncio de propósito', () => {
    // Não é falha: é o contrato de `askWhenMissing` vazio. O teste existe
    // pra que a escolha seja consciente e não um esquecimento.
    const silenciosas = TEMPLATES.ata.sections
      .filter((section) => section.required && section.askWhenMissing.length === 0)
      .map((section) => section.id);
    expect(silenciosas).toEqual(['topico_geral', 'topicos_discutidos', 'decisoes', 'conclusao']);
  });

  it('só Outcomes e Outputs somem quando vazios', () => {
    const omitiveis = TEMPLATES.ata.sections
      .filter((section) => section.omitWhenEmpty)
      .map((section) => section.id)
      .sort();
    expect(omitiveis).toEqual(['outcomes', 'outputs']);
  });
});

const stubSection = {
  id: 'stub',
  title: 'Stub',
  order: 1,
  required: false,
  needs: [],
  guidance: '',
  audit: 'none' as const,
  askWhenMissing: [],
  omitWhenEmpty: false,
};
