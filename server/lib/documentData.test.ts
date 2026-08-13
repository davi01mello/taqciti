import { describe, expect, it } from 'vitest';
import { SECTION_DATA_SPECS, specForSection, type DocumentData } from './documentData';
import { TEMPLATES } from './templates';
import type { SectionSpec } from './templates/types';

const sectionById = (id: string): SectionSpec =>
  TEMPLATES.ata.sections.find((s) => s.id === id)!;

describe('cobertura do registro', () => {
  it('toda seção da Ata tem spec própria', () => {
    // Seção da Ata caindo no genérico produziria dados sem estrutura, e o
    // Escritor não teria o que redigir.
    for (const section of TEMPLATES.ata.sections) {
      expect(SECTION_DATA_SPECS[section.id], section.id).toBeDefined();
    }
  });

  it('seção de template placeholder cai no genérico, sem quebrar', () => {
    // x1, daily, planning e review continuam funcionando — a especificação
    // pede exatamente isso enquanto os templates deles forem placeholder.
    for (const type of ['x1', 'daily', 'planning', 'review'] as const) {
      for (const section of TEMPLATES[type].sections) {
        expect(() => specForSection(section)).not.toThrow();
        expect(SECTION_DATA_SPECS[section.id]).toBeUndefined();
      }
    }
  });

  it('toda seção strict produz afirmações auditáveis', () => {
    // Esta é a direção que importa: seção `strict` sem `claims()` faria o
    // Auditor rodar sem nada para conferir, e a seção passaria como aprovada
    // sem ter sido olhada.
    //
    // A recíproca NÃO vale de propósito. `claims()` descreve o que PODE ser
    // auditado; quem decide se audita é o `audit` do template, lido por
    // `runSection`. Fazer os dois espelharem duplicaria a mesma decisão em
    // dois lugares — e é assim que eles divergem.
    const data: DocumentData = {
      participants: [{ name: 'X', roleSource: 'unknown', statementIds: [] }],
      decisions: [{ text: 'D', evidence: 'E', confidence: 'high', statementIds: [] }],
    };

    for (const section of TEMPLATES.ata.sections.filter((s) => s.audit === 'strict')) {
      expect(specForSection(section).claims(data, section.id).length, section.id).toBeGreaterThan(0);
    }
  });
});

describe('participantes', () => {
  const spec = specForSection(sectionById('participantes'));

  it('cargo ausente vira roleSource unknown, não "desconhecido" como texto', () => {
    const data: DocumentData = {};
    spec.merge(data, { participants: [{ name: 'João', statementIds: ['st-001'] }] }, 'participantes');
    expect(data.participants![0]).toMatchObject({ name: 'João', roleSource: 'unknown' });
    expect(data.participants![0]!.role).toBeUndefined();
  });

  it('a afirmação auditável inclui o cargo quando há cargo', () => {
    // Auditar só o nome deixaria o cargo passar sem conferência, e cargo
    // inventado é o erro que a Ata mais precisa evitar.
    const data: DocumentData = {};
    spec.merge(
      data,
      { participants: [{ name: 'Maria', role: 'Gerente de Dados', roleSource: 'meeting', statementIds: ['st-002'] }] },
      'participantes',
    );
    const claim = spec.claims(data, 'participantes')[0]!;
    expect(claim.text).toContain('Maria');
    expect(claim.text).toContain('Gerente de Dados');
    expect(claim.statementIds).toEqual(['st-002']);
  });

  it('drop remove exatamente a afirmação rejeitada', () => {
    const data: DocumentData = {};
    spec.merge(
      data,
      {
        participants: [
          { name: 'A', roleSource: 'unknown', statementIds: [] },
          { name: 'B', roleSource: 'unknown', statementIds: [] },
          { name: 'C', roleSource: 'unknown', statementIds: [] },
        ],
      },
      'participantes',
    );
    spec.drop(data, new Set(['participants[1]']), 'participantes');
    expect(data.participants!.map((p) => p.name)).toEqual(['A', 'C']);
  });
});

describe('decisões', () => {
  const spec = specForSection(sectionById('decisoes'));

  it('a afirmação auditável diz explicitamente que foi DECIDIDO', () => {
    // O Auditor precisa julgar "isto foi decidido?", não "isto foi dito?".
    // Sem essa palavra, uma proposta bem argumentada passa.
    const data: DocumentData = {};
    spec.merge(
      data,
      { decisions: [{ text: 'Adiar a entrega', evidence: 'Ana concordou', confidence: 'high', statementIds: ['st-009'] }] },
      'decisoes',
    );
    const claim = spec.claims(data, 'decisoes')[0]!;
    expect(claim.text).toContain('DECIDIDO');
    expect(claim.text).toContain('Adiar a entrega');
    expect(claim.text).toContain('Ana concordou');
  });

  it('drop esvazia a lista quando tudo foi rejeitado', () => {
    const data: DocumentData = {};
    spec.merge(
      data,
      { decisions: [{ text: 'D1', evidence: 'E', confidence: 'low', statementIds: [] }] },
      'decisoes',
    );
    spec.drop(data, new Set(['decisions[0]']), 'decisoes');
    expect(data.decisions).toEqual([]);
  });
});

describe('genérico (templates placeholder)', () => {
  const spec = specForSection(TEMPLATES.x1.sections[0]!);

  it('guarda os itens por id de seção', () => {
    const data: DocumentData = {};
    spec.merge(data, { items: [{ text: 'algo', statementIds: ['st-001'] }] }, 'documento');
    expect(data.generic!.documento).toHaveLength(1);
  });

  it('claims e drop usam caminho com o id da seção', () => {
    const data: DocumentData = {};
    spec.merge(data, { items: [{ text: 'a', statementIds: [] }, { text: 'b', statementIds: [] }] }, 'documento');
    expect(spec.claims(data, 'documento')[0]!.path).toBe('generic.documento[0]');
    spec.drop(data, new Set(['generic.documento[0]']), 'documento');
    expect(data.generic!.documento.map((i) => i.text)).toEqual(['b']);
  });
});

describe('identificação e assinatura', () => {
  it('campo ausente permanece ausente — nunca vira string vazia', () => {
    // Campo vazio pareceria preenchido e não geraria lacuna; ausência é o
    // que faz a pergunta ao usuário existir.
    const data: DocumentData = {};
    specForSection(sectionById('identificacao')).merge(data, { date: '' }, 'identificacao');
    expect(data.metadata!.date).toBeUndefined();
  });

  it('nenhuma das duas produz afirmação auditável', () => {
    const data: DocumentData = { metadata: { date: '13/08/2026' }, signature: { name: 'X' } };
    expect(specForSection(sectionById('identificacao')).claims(data, 'identificacao')).toEqual([]);
    expect(specForSection(sectionById('assinatura')).claims(data, 'assinatura')).toEqual([]);
  });
});
