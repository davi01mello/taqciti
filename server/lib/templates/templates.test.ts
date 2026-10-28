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
  it('tem onze seções, em ordem contínua de 1 a 11', () => {
    // Nove da especificação, menos a Conclusão, mais resumo executivo,
    // encaminhamentos e em aberto (28/10/2026, ver o topo de `ata.ts`).
    const orders = TEMPLATES.ata.sections.map((section) => section.order).sort((a, b) => a - b);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('o resumo executivo abre a Ata e substitui a Conclusão', () => {
    // A Conclusão era o mesmo resumo no fim do documento, sem auditoria; quem
    // lê para no começo.
    const ids = [...TEMPLATES.ata.sections].sort((a, b) => a.order - b.order).map((s) => s.id);
    expect(ids.indexOf('resumo_executivo')).toBe(1);
    expect(ids).not.toContain('conclusao');
  });

  it('as seções que afirmam fato da reunião são de auditoria estrita', () => {
    // O Auditor roda somente em `audit: 'strict'`. Se esta lista mudar sem
    // querer, ele deixa de rodar onde inventar custa caro. Outcomes e Outputs
    // entraram depois de uma geração real escrever "painel da diretoria" num
    // output — cada item é uma afirmação única, e conferi-lo é barato. Resumo
    // executivo, encaminhamentos (com dono e prazo) e em aberto, pelo mesmo
    // motivo: são o que quem faltou lê, e não podem trazer o que não foi dito.
    const strict = TEMPLATES.ata.sections
      .filter((section) => section.audit === 'strict')
      .map((section) => section.id)
      .sort();
    expect(strict).toEqual([
      'decisoes',
      'em_aberto',
      'encaminhamentos',
      'outcomes',
      'outputs',
      'participantes',
      'resumo_executivo',
    ]);
  });

  it('o Resumo: executivo, trechos por horário e pontos de atenção, todos conferidos', () => {
    const resumo = [...TEMPLATES.resumo.sections].sort((a, b) => a.order - b.order);
    expect(resumo.map((s) => s.id)).toEqual(['resumo_executivo', 'resumo_por_periodo', 'pontos_de_atencao']);
    expect(resumo.every((s) => s.audit === 'strict')).toBe(true);
  });

  it('Daily, Planning e Review também são conferidos', () => {
    for (const tipo of ['daily', 'planning', 'review'] as const) {
      expect(TEMPLATES[tipo].sections.map((s) => s.audit), tipo).toEqual(['strict']);
    }
  });

  it('toda seção obrigatória sem askWhenMissing degrada em silêncio de propósito', () => {
    // Não é falha: é o contrato de `askWhenMissing` vazio. O teste existe
    // pra que a escolha seja consciente e não um esquecimento.
    const silenciosas = TEMPLATES.ata.sections
      .filter((section) => section.required && section.askWhenMissing.length === 0)
      .map((section) => section.id);
    expect(silenciosas).toEqual(['resumo_executivo', 'topico_geral', 'topicos_discutidos', 'decisoes']);
  });

  it('o que pode não existir numa reunião some quando vazio', () => {
    // A Assinatura some sem nome de quem assina: não há fecho a imprimir, e a
    // pessoa não é perguntada por isso. Encaminhamentos e em aberto podem não
    // existir; o resumo executivo pode perder todas as frases na auditoria —
    // título sem nada embaixo seria pior que nenhum.
    const omitiveis = TEMPLATES.ata.sections
      .filter((section) => section.omitWhenEmpty)
      .map((section) => section.id)
      .sort();
    expect(omitiveis).toEqual(['assinatura', 'em_aberto', 'encaminhamentos', 'outcomes', 'outputs', 'resumo_executivo']);
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
