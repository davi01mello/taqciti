import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A montagem do documento inteiro, com o modelo mockado. O que se testa aqui
 * é o que a rede de agentes garante no CÓDIGO: ordem das seções, `completed`
 * de verdade, lacuna visível, seção vazia sumindo e a guarda contra a
 * instrução do PDF vazar.
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

/**
 * Respostas por agente. O Pensante devolve a fatia da seção pedida; o
 * Auditor aprova; o Escritor devolve um cabeçalho com o que recebeu.
 */
function mockPipeline(overrides: Record<string, unknown> = {}) {
  const porSecao: Record<string, unknown> = {
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
    assinatura: {},
    ...overrides,
  };

  // A seção pedida sai no cabeçalho do pedido. Pensante e Escritor rotulam
  // diferente, então o mock reconhece as duas formas — casar pelo título solto
  // pegaria o título de outra seção citado dentro do guidance.
  const qualSecao = (conteudo: string) =>
    TEMPLATES.ata.sections.find(
      (s) =>
        conteudo.includes(`Seção a preencher: ${s.title}`) ||
        conteudo.includes(`da seção "${s.title}"`),
    )?.id;

  complete.mockImplementation(async (agent: string, req: { messages: { content: string }[] }) => {
    const conteudo = req.messages[0]!.content;
    if (agent === 'auditor') return reply({ supported: true, reason: 'ok' });
    if (agent === 'escritor') {
      const id = qualSecao(conteudo)!;
      const section = TEMPLATES.ata.sections.find((s) => s.id === id)!;
      return reply({ content: `## ${section.title}\n\nTexto redigido da seção.` });
    }
    return reply(porSecao[qualSecao(conteudo)!] ?? {});
  });
}

const reply = (parsed: unknown) => ({
  text: JSON.stringify(parsed),
  parsed,
  usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
  meta: { provider: 'google', model: 'falso', latencyMs: 1, repaired: false, rateLimitWaits: 0, overloadWaits: 0 },
});

const run = (over: Partial<Parameters<typeof generateStep>[0]> = {}) =>
  generateStep({ transcript, documentType: 'ata', completed: [], answers: [], ...over });

afterEach(() => complete.mockReset());

describe('montagem da Ata', () => {
  it('não devolve mais stub', async () => {
    mockPipeline();
    const { sections } = await run();
    for (const section of sections) {
      expect(section.content).not.toContain('stub');
      expect(section.content).not.toContain('Transcrição recebida com');
    }
  });

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

  it('outcomes e outputs vazios somem do documento', async () => {
    mockPipeline();
    const { sections } = await run();
    expect(sections.map((s) => s.id)).not.toContain('outcomes');
    expect(sections.map((s) => s.id)).not.toContain('outputs');
  });

  it('outcomes com item permanece', async () => {
    mockPipeline({ outcomes: { items: [{ text: 'Prioridades alinhadas.', quotes: [] }] } });
    const { sections } = await run();
    expect(sections.map((s) => s.id)).toContain('outcomes');
  });

  it('a lacuna do cargo aparece marcada no documento', async () => {
    // O Joao não tem cargo na transcrição. Isso precisa ser VISÍVEL na ata,
    // não simplesmente ausente.
    mockPipeline();
    const { sections } = await run();
    const participantes = sections.find((s) => s.id === 'participantes')!;
    expect(participantes.content).toContain('**[A preencher:');
    expect(participantes.content).toContain('Joao');
  });

  it('as lacunas voltam como perguntas, prontas para a UI que não existe', async () => {
    mockPipeline();
    const { questions } = await run();
    const cargo = questions.find((q) => q.id.includes('participants[Joao].role'));
    expect(cargo).toBeDefined();
    expect(cargo!.why).toContain('cargo de Joao');
    // Participantes é `required: true`.
    expect(cargo!.optional).toBe(false);
  });

  it('confidence reflete a seção: partial onde há lacuna, ok onde não há', async () => {
    mockPipeline();
    const { sections } = await run();
    expect(sections.find((s) => s.id === 'participantes')!.confidence).toBe('partial');
    expect(sections.find((s) => s.id === 'topicos_discutidos')!.confidence).toBe('ok');
  });

  it('completed é respeitado: seção já pronta não é regerada', async () => {
    mockPipeline();
    const pronta = {
      id: 'identificacao',
      title: 'Identificação',
      content: '## Identificação\n\nJá estava pronta.',
      confidence: 'ok' as const,
    };

    const { sections } = await run({ completed: [pronta] });

    expect(sections.map((s) => s.id)).not.toContain('identificacao');
    // E ela chega ao Escritor das seguintes, para não repetir nem contradizer.
    const prefixos = complete.mock.calls
      .filter(([agent]) => agent === 'escritor')
      .map(([, req]) => req.cacheablePrefix ?? '');
    expect(prefixos.some((p: string) => p.includes('Já estava pronta.'))).toBe(true);
  });

  it('cada seção vê as anteriores já escritas', async () => {
    mockPipeline();
    await run();

    const escritor = complete.mock.calls.filter(([agent]) => agent === 'escritor');
    // A primeira não tem anterior; a última tem todas as anteriores.
    expect(escritor[0]![1].cacheablePrefix).toBeUndefined();
    expect(escritor[escritor.length - 1]![1].cacheablePrefix).toContain('## Identificação');
  });

  it('a transcrição chega ao Pensante e para nele', async () => {
    // O Escritor redige a partir de dados conferidos. Se a transcrição
    // chegasse até ele, haveria uma segunda porta para informação não
    // auditada entrar na ata.
    mockPipeline();
    await run();

    for (const [agent, req] of complete.mock.calls) {
      const tudo = `${req.system}\n${req.messages[0].content}\n${req.cacheablePrefix ?? ''}`;
      if (agent === 'pensante') expect(tudo).toContain('Joao explicou o pipeline.');
      if (agent === 'escritor') expect(tudo).not.toContain('Joao explicou o pipeline.');
    }
  });

  it('devolve o documentData acumulado, não só o markdown', async () => {
    // É a camada canônica: HTML e PDF renderizam daqui. O markdown já perdeu
    // que Maria tem cargo de origem `meeting`.
    mockPipeline();
    const { documentData } = await run();

    expect(documentData.metadata?.projectName).toBe('Fenix');
    expect(documentData.participants?.map((p) => p.name)).toEqual(['Maria', 'Joao']);
    expect(documentData.participants?.[0]!.roleSource).toBe('meeting');
    expect(documentData.decisions?.[0]!.agreement.quote).toBe('De acordo, sexta.');
  });

  it('devolve as lacunas com o campo, não só a pergunta', async () => {
    // Quem renderiza precisa do campo para pôr o marcador no lugar certo —
    // o cargo do Joao ao lado do Joao, e não no fim da seção.
    mockPipeline();
    const { gaps } = await run();
    expect(gaps.some((g) => g.field === 'participants[Joao].role')).toBe(true);
  });

  it('documentData de entrada semeia a passada seguinte', async () => {
    // Contraparte de devolvê-lo. Sem isto, uma segunda chamada recomeçaria
    // com o acumulado vazio e o Pensante não veria o que já foi determinado.
    mockPipeline();
    const semente = { metadata: { date: '01/01/2020', projectName: 'ANTERIOR' } };

    await run({
      completed: [
        { id: 'identificacao', title: 'Identificação', content: '## Identificação', confidence: 'ok' as const },
      ],
      documentData: semente,
    });

    const pedidoDoPensante = complete.mock.calls.find(([agent]) => agent === 'pensante')![1];
    expect(pedidoDoPensante.messages[0].content).toContain('ANTERIOR');
  });

  it('FALHA ALTO quando a instrução do PDF vaza para o documento', async () => {
    // Entregar calado poria a instrução de autoria dentro de uma ata que vai
    // para um cliente.
    mockPipeline();
    complete.mockImplementation(async (agent: string) => {
      if (agent === 'auditor') return reply({ supported: true, reason: 'ok' });
      if (agent === 'escritor') {
        return reply({ content: '## Identificação\n\nNarrativa Resumida do encontro.' });
      }
      return reply({ date: '13/08/2026', projectName: 'Fenix' });
    });

    await expect(run()).rejects.toThrow(/vazou/);
  });
});

describe('templates placeholder', () => {
  it('x1 gera seção única e genérica, sem quebrar', async () => {
    // Não há modelo para eles. O que não pode é quebrar.
    complete.mockImplementation(async (agent: string) =>
      agent === 'escritor'
        ? reply({ content: '## Documento\n\nTexto.' })
        : reply({ items: [{ text: 'algo discutido', quotes: [] }] }),
    );

    const { sections } = await generateStep({
      transcript,
      documentType: 'x1',
      completed: [],
      answers: [],
    });

    expect(sections).toHaveLength(TEMPLATES.x1.sections.length);
    expect(sections[0]!.content).toContain('Texto.');
  });
});
