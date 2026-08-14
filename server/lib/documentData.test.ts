import { describe, expect, it } from 'vitest';
import {
  SECTION_DATA_SPECS,
  specForSection,
  type DocumentData,
  type Locate,
} from './documentData';
import { createLocator } from './agents/anchoring';
import { TEMPLATES } from './templates';
import type { SectionSpec } from './templates/types';

const sectionById = (id: string): SectionSpec =>
  TEMPLATES.ata.sections.find((s) => s.id === id)!;

/**
 * Transcrição de apoio. Os testes localizam contra ela de verdade, com o
 * mesmo localizador do pipeline: um `locate` de mentira que aceitasse
 * qualquer string esconderia exatamente o defeito que a âncora existe para
 * pegar.
 */
const TRANSCRIPT = [
  'Maria, gerente de dados, abriu a reunião.',
  'João explicou o pipeline.',
  'Ana: Podemos avaliar desnormalizações depois dos testes.',
  'Carlos: Sobre o deploy de quinta, fechamos assim?',
  'Ana: Fechado, quinta.',
  'Carlos: Concordo.',
  'Ana: Então adiamos a entrega para sexta-feira.',
  'Carlos: De acordo, sexta.',
].join('\n');

const locator = (): Locate => createLocator(TRANSCRIPT).locate;

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
      participants: [{ name: 'X', roleSource: 'unknown', quotes: [] }],
      decisions: [
        {
          text: 'D',
          agreement: { quote: 'Concordo.', anchor: null },
          confidence: 'high',
          quotes: [],
        },
      ],
    };

    for (const section of TEMPLATES.ata.sections.filter((s) => s.audit === 'strict')) {
      expect(specForSection(section).claims(data, section.id).length, section.id).toBeGreaterThan(0);
    }
  });
});

describe('ancoragem das citações', () => {
  const spec = specForSection(sectionById('participantes'));

  it('citação literal vira âncora exata', () => {
    const data: DocumentData = {};
    spec.merge(
      data,
      { participants: [{ name: 'João', roleSource: 'unknown', quotes: ['João explicou o pipeline.'] }] },
      'participantes',
      locator(),
    );
    const anchor = data.participants![0]!.quotes[0]!.anchor!;
    expect(anchor.exact).toBe(true);
    expect(TRANSCRIPT.slice(anchor.start, anchor.end)).toBe('João explicou o pipeline.');
  });

  it('citação inexistente fica com anchor null e não sustenta a afirmação', () => {
    // É o caso que a compactação escondia: JSON válido, schema satisfeito,
    // citação que a transcrição nunca teve.
    const data: DocumentData = {};
    spec.merge(
      data,
      { participants: [{ name: 'Zé', roleSource: 'unknown', quotes: ['Zé apresentou o roadmap.'] }] },
      'participantes',
      locator(),
    );
    expect(data.participants![0]!.quotes[0]!.anchor).toBeNull();
    // A citação é PRESERVADA como veio — é a evidência do que o modelo alegou.
    expect(data.participants![0]!.quotes[0]!.quote).toBe('Zé apresentou o roadmap.');
    expect(spec.claims(data, 'participantes')[0]!.anchors).toEqual([]);
  });

  it('citação vazia é descartada antes de virar âncora', () => {
    const data: DocumentData = {};
    spec.merge(
      data,
      { participants: [{ name: 'A', roleSource: 'unknown', quotes: ['', '   '] }] },
      'participantes',
      locator(),
    );
    expect(data.participants![0]!.quotes).toEqual([]);
  });
});

describe('participantes', () => {
  const spec = specForSection(sectionById('participantes'));

  it('cargo ausente vira roleSource unknown, não "desconhecido" como texto', () => {
    const data: DocumentData = {};
    spec.merge(
      data,
      { participants: [{ name: 'João', quotes: ['João explicou o pipeline.'] }] },
      'participantes',
      locator(),
    );
    expect(data.participants![0]).toMatchObject({ name: 'João', roleSource: 'unknown' });
    expect(data.participants![0]!.role).toBeUndefined();
  });

  it('a afirmação auditável inclui o cargo quando há cargo', () => {
    // Auditar só o nome deixaria o cargo passar sem conferência, e cargo
    // inventado é o erro que a Ata mais precisa evitar.
    const data: DocumentData = {};
    spec.merge(
      data,
      {
        participants: [
          {
            name: 'Maria',
            role: 'Gerente de Dados',
            roleSource: 'meeting',
            quotes: ['Maria, gerente de dados, abriu a reunião.'],
          },
        ],
      },
      'participantes',
      locator(),
    );
    const claim = spec.claims(data, 'participantes')[0]!;
    expect(claim.text).toContain('Maria');
    expect(claim.text).toContain('Gerente de Dados');
    expect(claim.anchors).toHaveLength(1);
  });

  it('drop remove exatamente a afirmação rejeitada', () => {
    const data: DocumentData = {};
    spec.merge(
      data,
      {
        participants: [
          { name: 'A', roleSource: 'unknown', quotes: [] },
          { name: 'B', roleSource: 'unknown', quotes: [] },
          { name: 'C', roleSource: 'unknown', quotes: [] },
        ],
      },
      'participantes',
      locator(),
    );
    spec.drop(data, new Set(['participants[1]']), 'participantes');
    expect(data.participants!.map((p) => p.name)).toEqual(['A', 'C']);
  });
});

describe('decisões', () => {
  const spec = specForSection(sectionById('decisoes'));

  const decision = (over: Record<string, unknown> = {}) => ({
    decisions: [
      {
        text: 'Adiar a entrega para sexta-feira',
        agreementQuote: 'De acordo, sexta.',
        confidence: 'high',
        quotes: ['Ana: Então adiamos a entrega para sexta-feira.'],
        ...over,
      },
    ],
  });

  it('a afirmação auditável diz explicitamente que foi DECIDIDO', () => {
    // O Auditor precisa julgar "isto foi decidido?", não "isto foi dito?".
    // Sem essa palavra, uma proposta bem argumentada passa.
    const data: DocumentData = {};
    spec.merge(data, decision(), 'decisoes', locator());
    const claim = spec.claims(data, 'decisoes')[0]!;
    expect(claim.text).toContain('DECIDIDO');
    expect(claim.text).toContain('Adiar a entrega para sexta-feira');
  });

  it('a âncora da concordância entra no trecho a julgar, junto com a da proposta', () => {
    // É o que separa decisão de proposta. Sem a concordância no trecho, o
    // Auditor teria de procurá-la na folga — que foi exatamente como uma
    // proposta passou como decisão.
    const data: DocumentData = {};
    spec.merge(data, decision(), 'decisoes', locator());
    const claim = spec.claims(data, 'decisoes')[0]!;
    expect(claim.anchors).toHaveLength(2);
    expect(claim.blocker).toBeUndefined();
  });

  it('concordância que não existe na transcrição derruba a decisão em código', () => {
    // Sem chamada ao modelo: não é opinião, é ausência de evidência.
    const data: DocumentData = {};
    spec.merge(data, decision({ agreementQuote: 'Todos aprovaram por unanimidade.' }), 'decisoes', locator());
    const claim = spec.claims(data, 'decisoes')[0]!;
    expect(claim.blocker).toMatch(/não existe na transcrição/);
  });

  it('decisão sem concordância apontada é proposta, e cai', () => {
    const data: DocumentData = {};
    spec.merge(data, decision({ agreementQuote: '' }), 'decisoes', locator());
    const claim = spec.claims(data, 'decisoes')[0]!;
    expect(claim.blocker).toMatch(/proposta, não decisão/);
  });

  it('confidence ausente cai para low, e não para high', () => {
    // Na dúvida, a Ata registra menos confiança, nunca mais.
    const data: DocumentData = {};
    spec.merge(data, decision({ confidence: undefined }), 'decisoes', locator());
    expect(data.decisions![0]!.confidence).toBe('low');
  });

  it('drop esvazia a lista quando tudo foi rejeitado', () => {
    const data: DocumentData = {};
    spec.merge(data, decision(), 'decisoes', locator());
    spec.drop(data, new Set(['decisions[0]']), 'decisoes');
    expect(data.decisions).toEqual([]);
  });
});

describe('genérico (templates placeholder)', () => {
  const spec = specForSection(TEMPLATES.x1.sections[0]!);

  it('guarda os itens por id de seção', () => {
    const data: DocumentData = {};
    spec.merge(
      data,
      { items: [{ text: 'algo', quotes: ['João explicou o pipeline.'] }] },
      'documento',
      locator(),
    );
    expect(data.generic!.documento).toHaveLength(1);
  });

  it('claims e drop usam caminho com o id da seção', () => {
    const data: DocumentData = {};
    spec.merge(
      data,
      { items: [{ text: 'a', quotes: [] }, { text: 'b', quotes: [] }] },
      'documento',
      locator(),
    );
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
    specForSection(sectionById('identificacao')).merge(
      data,
      { date: '' },
      'identificacao',
      locator(),
    );
    expect(data.metadata!.date).toBeUndefined();
  });

  it('nenhuma das duas produz afirmação auditável', () => {
    const data: DocumentData = { metadata: { date: '13/08/2026' }, signature: { name: 'X' } };
    expect(specForSection(sectionById('identificacao')).claims(data, 'identificacao')).toEqual([]);
    expect(specForSection(sectionById('assinatura')).claims(data, 'assinatura')).toEqual([]);
  });
});
