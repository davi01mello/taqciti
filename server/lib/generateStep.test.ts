import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A montagem do documento inteiro, com o modelo mockado. O que se testa aqui
 * é o que o pipeline garante no CÓDIGO: DUAS chamadas no máximo, ordem das
 * seções, `completed` de verdade, lacuna visível, descarte do que o Auditor
 * rejeita, seção vazia sumindo e a guarda contra a instrução do PDF vazar.
 */
const complete = vi.hoisted(() => vi.fn());
vi.mock('./ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ai')>()),
  complete,
}));

const { generateStep } = await import('./generateStep');
const { TEMPLATES } = await import('./templates');

const transcript = [
  'Reuniao de 13/08/2026, projeto Fenix.',
  'Maria, gerente de dados, abriu a reuniao.',
  'Joao explicou o pipeline.',
  'Maria: Entao adiamos a entrega para sexta-feira.',
  'Joao: De acordo, sexta.',
].join('\n');

const DOCUMENTO = {
  identificacao: { date: '13/08/2026', projectName: 'Fenix' },
  topico_geral: { topic: 'Cronograma', progress: 'Em andamento.' },
  participantes: {
    participants: [
      {
        name: 'Maria',
        role: 'Gerente de Dados',
        roleSource: 'meeting',
        quotes: ['Maria, gerente de dados, abriu a reuniao.'],
      },
      { name: 'Joao', roleSource: 'unknown', quotes: ['Joao explicou o pipeline.'] },
    ],
  },
  topicos_discutidos: {
    topics: [{ title: 'Cronograma', summary: 'A entrega foi adiada.', quotes: [] }],
  },
  decisoes: {
    decisions: [
      {
        text: 'Adiar a entrega para sexta-feira',
        agreementQuote: 'De acordo, sexta.',
        confidence: 'high',
        quotes: ['Entao adiamos a entrega para sexta-feira.'],
      },
    ],
  },
  outcomes: { items: [] },
  outputs: { items: [] },
  conclusao: { text: 'O projeto segue com a entrega remarcada.' },
};

const reply = (parsed: unknown) => ({
  text: JSON.stringify(parsed),
  parsed,
  usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
  meta: { provider: 'google', model: 'falso', latencyMs: 1, repaired: false, rateLimitWaits: 0, overloadWaits: 0 },
});

/** O Auditor aprova tudo, menos as afirmações cujo texto contém `rejeitar`. */
function mockPipeline(overrides: Record<string, unknown> = {}, rejeitar: string[] = []) {
  complete.mockImplementation(async (agent: string, req: { messages: { content: string }[] }) => {
    if (agent === 'auditor') {
      const blocos = req.messages[0]!.content.split('\n\n---\n\n');
      return reply({
        verdicts: blocos.map((bloco) => ({
          id: /^# Afirmação (\S+)/.exec(bloco)![1],
          supported: !rejeitar.some((r) => bloco.includes(r)),
          reason: 'motivo do auditor',
        })),
      });
    }
    return reply({ ...DOCUMENTO, ...overrides });
  });
}

const run = (over: Partial<Parameters<typeof generateStep>[0]> = {}) =>
  generateStep({ transcript, documentType: 'ata', completed: [], answers: [], ...over });

const chamadasDe = (agent: string) => complete.mock.calls.filter(([a]) => a === agent);

afterEach(() => complete.mockReset());

describe('custo da Ata', () => {
  it('uma leitura e uma conferência — duas chamadas, e só', async () => {
    mockPipeline();
    const { report } = await run();

    expect(chamadasDe('leitor')).toHaveLength(1);
    expect(chamadasDe('auditor')).toHaveLength(1);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(report.calls).toBe(2);
  });

  it('a leitura pede todas as seções de uma vez, menos a Assinatura', async () => {
    mockPipeline();
    await run();

    const schema = chamadasDe('leitor')[0]![1].jsonSchema;
    const esperadas = TEMPLATES.ata.sections.filter((s) => !s.fromUserOnly).map((s) => s.id);
    expect(Object.keys(schema.properties).sort()).toEqual(esperadas.sort());
    expect(schema.required.sort()).toEqual(esperadas.sort());
    expect(schema.properties).not.toHaveProperty('assinatura');
  });

  it('todas as afirmações das seções strict vão na MESMA conferência', async () => {
    mockPipeline();
    const { report } = await run();

    // Maria, Joao e a decisão.
    expect(report.verdicts.map((v) => v.path)).toEqual([
      'participants[0]',
      'participants[1]',
      'decisions[0]',
    ]);
    expect(report.verdicts.map((v) => v.sectionId)).toEqual(['participantes', 'participantes', 'decisoes']);
  });

  it('nada a conferir: não chama o Auditor', async () => {
    mockPipeline({ participantes: { participants: [] }, decisoes: { decisions: [] } });
    await run();
    expect(chamadasDe('auditor')).toHaveLength(0);
  });

  it('a transcrição vai na leitura, e o trecho — não a transcrição inteira — na conferência', async () => {
    mockPipeline();
    await run();

    expect(chamadasDe('leitor')[0]![1].cacheablePrefix).toBe(transcript);
    expect(chamadasDe('leitor')[0]![1].reasoning).toBe('high');
    expect(chamadasDe('auditor')[0]![1].cacheablePrefix).toBeUndefined();
  });
});

describe('montagem da Ata', () => {
  it('devolve as seções na ordem do template', async () => {
    mockPipeline();
    const { sections } = await run();
    const esperada = TEMPLATES.ata.sections
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id)
      // outcomes e outputs somem: `omitWhenEmpty` e sem item.
      .filter((id) => id !== 'outcomes' && id !== 'outputs');

    expect(sections.map((s) => s.id)).toEqual(esperada);
  });

  it('outcomes com item permanece', async () => {
    mockPipeline({ outcomes: { items: [{ text: 'Prioridades alinhadas.', quotes: [] }] } });
    const { sections } = await run();
    expect(sections.find((s) => s.id === 'outcomes')!.content).toContain('- Prioridades alinhadas.');
  });

  it('o markdown sai dos dados, com o texto que o Leitor escreveu', async () => {
    mockPipeline();
    const { sections } = await run();
    const por = (id: string) => sections.find((s) => s.id === id)!.content;

    expect(por('topico_geral')).toContain('**TÓPICO:** Cronograma');
    expect(por('topicos_discutidos')).toContain('1. **Cronograma:** A entrega foi adiada.');
    expect(por('decisoes')).toContain('- Adiar a entrega para sexta-feira');
    // A concordância é evidência para a auditoria, não texto da ata.
    expect(por('decisoes')).not.toContain('De acordo, sexta.');
    expect(por('conclusao')).toContain('O projeto segue com a entrega remarcada.');
  });

  it('a lacuna do cargo aparece marcada no documento', async () => {
    mockPipeline();
    const { sections } = await run();
    const participantes = sections.find((s) => s.id === 'participantes')!;
    expect(participantes.content).toContain('**[A preencher:');
    expect(participantes.content).toContain('Joao');
  });

  it('a Assinatura sai com lacuna e vira as duas perguntas', async () => {
    mockPipeline();
    const { sections, questions } = await run();
    expect(sections.find((s) => s.id === 'assinatura')!.content).toContain('[A preencher:');
    expect(questions.map((q) => q.id)).toEqual(
      expect.arrayContaining(['assinatura:signature.name', 'assinatura:signature.role']),
    );
  });

  it('as lacunas voltam como perguntas', async () => {
    mockPipeline();
    const { questions } = await run();
    const cargo = questions.find((q) => q.id.includes('participants[Joao].role'));
    expect(cargo).toBeDefined();
    expect(cargo!.why).toContain('cargo de Joao');
    expect(cargo!.optional).toBe(false);
  });

  it('confidence reflete a seção: partial onde há lacuna, ok onde não há', async () => {
    mockPipeline();
    const { sections } = await run();
    expect(sections.find((s) => s.id === 'participantes')!.confidence).toBe('partial');
    expect(sections.find((s) => s.id === 'topicos_discutidos')!.confidence).toBe('ok');
  });

  it('completed é respeitado: seção já pronta não é regerada nem pedida', async () => {
    mockPipeline();
    const pronta = {
      id: 'identificacao',
      title: 'Identificação',
      content: '## Identificação\n\nJá estava pronta.',
      confidence: 'ok' as const,
    };

    const { sections } = await run({ completed: [pronta] });

    expect(sections.map((s) => s.id)).not.toContain('identificacao');
    expect(chamadasDe('leitor')[0]![1].jsonSchema.properties).not.toHaveProperty('identificacao');
  });

  it('documentData de entrada chega à leitura como "já determinado"', async () => {
    mockPipeline();
    const semente = { metadata: { date: '01/01/2020', projectName: 'ANTERIOR' } };

    await run({
      completed: [
        { id: 'identificacao', title: 'Identificação', content: '## Identificação', confidence: 'ok' as const },
      ],
      documentData: semente,
    });

    expect(chamadasDe('leitor')[0]![1].messages[0].content).toContain('ANTERIOR');
  });

  it('devolve o documentData, não só o markdown', async () => {
    mockPipeline();
    const { documentData } = await run();

    expect(documentData.metadata?.projectName).toBe('Fenix');
    expect(documentData.participants?.map((p) => p.name)).toEqual(['Maria', 'Joao']);
    expect(documentData.participants?.[0]!.roleSource).toBe('meeting');
    expect(documentData.decisions?.[0]!.agreement.quote).toBe('De acordo, sexta.');
  });

  it('as citações de cada seção são contadas separadamente', async () => {
    mockPipeline();
    const { report } = await run();
    const participantes = report.porSecao.find((s) => s.sectionId === 'participantes')!;
    expect(participantes.quotes).toMatchObject({ total: 2, missing: 0, anchorRate: 1 });
  });
});

describe('o que o Auditor rejeita', () => {
  it('sai do documento e vira lacuna — sem segunda leitura', async () => {
    mockPipeline({}, ['Adiar a entrega']);
    const { documentData, sections, gaps, report } = await run();

    expect(documentData.decisions).toEqual([]);
    expect(sections.find((s) => s.id === 'decisoes')!.content).not.toContain('- Adiar a entrega');
    expect(gaps.some((g) => g.field === 'decisions[0]')).toBe(true);
    expect(report.discarded).toEqual([
      expect.objectContaining({ sectionId: 'decisoes', path: 'decisions[0]', reason: 'motivo do auditor' }),
    ]);
    // Rejeitar não relê a reunião: continua uma leitura só.
    expect(chamadasDe('leitor')).toHaveLength(1);
  });

  it('participante rejeitado não deixa pergunta de cargo para trás', async () => {
    mockPipeline({}, ['Joao participou']);
    const { questions, documentData } = await run();

    expect(documentData.participants?.map((p) => p.name)).toEqual(['Maria']);
    expect(questions.some((q) => q.id.includes('participants[Joao].role'))).toBe(false);
  });

  it('decisão sem concordância localizável cai em código, sem ir ao Auditor', async () => {
    mockPipeline({
      decisoes: {
        decisions: [
          {
            text: 'Cancelar o projeto',
            agreementQuote: 'fala que nunca existiu',
            confidence: 'low',
            quotes: ['Joao explicou o pipeline.'],
          },
        ],
      },
    });
    const { documentData } = await run();

    expect(documentData.decisions).toEqual([]);
    const conferidas = chamadasDe('auditor')[0]![1].messages[0].content;
    expect(conferidas).not.toContain('Cancelar o projeto');
  });
});

describe('guarda contra vazamento', () => {
  it('FALHA ALTO quando a instrução do PDF vaza para o documento', async () => {
    mockPipeline({ conclusao: { text: 'Narrativa Resumida do encontro.' } });
    await expect(run()).rejects.toThrow(/vazou/);
  });
});

describe('templates placeholder', () => {
  it('daily gera seção única e genérica, sem quebrar', async () => {
    const id = TEMPLATES.daily.sections[0]!.id;
    complete.mockResolvedValue(reply({ [id]: { items: [{ text: 'algo discutido', quotes: [] }] } }));

    const { sections } = await generateStep({
      transcript,
      documentType: 'daily',
      completed: [],
      answers: [],
    });

    expect(sections).toHaveLength(TEMPLATES.daily.sections.length);
    expect(sections[0]!.content).toContain('- algo discutido');
  });
});

describe('X1 — perguntas e respostas', () => {
  it('monta o par em código, conferido pelo Auditor', async () => {
    complete.mockImplementation(async (agent: string) => {
      if (agent === 'auditor') {
        return reply({
          verdicts: [
            { id: 'a1', supported: true, reason: 'ok' },
            { id: 'a2', supported: true, reason: 'ok' },
          ],
        });
      }
      return reply({
        perguntas_respostas: {
          pares: [
            {
              pergunta: 'Por que você quer essa vaga?',
              // Precisa ser um trecho literal do `transcript` deste arquivo —
              // sem âncora localizável o Auditor rejeita SEM gastar chamada.
              quotesPergunta: ['Joao explicou o pipeline.'],
              resposta: 'Porque gosto do desafio técnico.',
              quotesResposta: ['Entao adiamos a entrega para sexta-feira.'],
            },
          ],
        },
      });
    });

    const { sections } = await generateStep({
      transcript,
      documentType: 'x1',
      completed: [],
      answers: [],
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]!.content).toContain('Gente e gestão');
    expect(sections[0]!.content).toContain('Entrevistado');
    expect(sections[0]!.content).toContain('Por que você quer essa vaga?');
    expect(sections[0]!.content).toContain('Porque gosto do desafio técnico.');
  });
});
