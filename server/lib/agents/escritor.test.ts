import { afterEach, describe, expect, it, vi } from 'vitest';

const complete = vi.hoisted(() => vi.fn());
vi.mock('../ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai')>()),
  complete,
}));

const { escrever, assertSemVazamento, confidenceFor, marcadorDeLacuna, FRASES_PROIBIDAS } =
  await import('./escritor');
const { TEMPLATES } = await import('../templates');
import type { DocumentData, Gap } from '../documentData';
import type { RenderedSection } from '../generateStep';

const secao = (id: string) => TEMPLATES.ata.sections.find((s) => s.id === id)!;

const reply = (content: string) => ({
  text: JSON.stringify({ content }),
  parsed: { content },
  usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
  meta: { provider: 'google', model: 'falso', latencyMs: 1, repaired: false, rateLimitWaits: 0, overloadWaits: 0 },
});

const participantes: DocumentData = {
  participants: [
    { name: 'Maria', role: 'Gerente de Dados', roleSource: 'meeting', quotes: [] },
    { name: 'João', roleSource: 'unknown', quotes: [] },
  ],
};

const lacunaDoJoao: Gap = {
  sectionId: 'participantes',
  field: 'participants[João].role',
  question: 'Qual é o cargo/papel de João?',
  why: 'Não houve evidência na reunião do cargo de João.',
};

afterEach(() => complete.mockReset());

describe('omitWhenEmpty', () => {
  it('seção marcada e sem dado nenhum some, sem gastar chamada', async () => {
    const result = await escrever({
      section: secao('outcomes'),
      data: {},
      gaps: [],
      completed: [],
    });

    expect(result.section).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it('seção NÃO marcada e sem dado continua no documento', async () => {
    // Decisões é `omitWhenEmpty: false` de propósito: uma reunião sem decisão
    // precisa registrar que não houve, e não fingir que a seção não existe.
    complete.mockResolvedValueOnce(reply('## Decisões tomadas\n\nNenhuma decisão foi registrada.'));

    const result = await escrever({
      section: secao('decisoes'),
      data: {},
      gaps: [],
      completed: [],
    });

    expect(result.section).not.toBeNull();
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe('lacunas', () => {
  it('o marcador que o modelo escreveu é preservado, sem duplicar', async () => {
    complete.mockResolvedValueOnce(
      reply(`## Participantes e cargos\n\n- Maria — Gerente de Dados\n- João — ${marcadorDeLacuna(lacunaDoJoao)}`),
    );

    const result = await escrever({
      section: secao('participantes'),
      data: participantes,
      gaps: [lacunaDoJoao],
      completed: [],
    });

    const ocorrencias = result.section!.content.split(marcadorDeLacuna(lacunaDoJoao)).length - 1;
    expect(ocorrencias).toBe(1);
    expect(result.lacunasAcrescentadas).toEqual([]);
  });

  it('lacuna que o modelo esqueceu é acrescentada pelo código', async () => {
    // Sem isto a ata sairia parecendo completa, com o cargo do João
    // simplesmente ausente em vez de marcado como pendente.
    complete.mockResolvedValueOnce(reply('## Participantes e cargos\n\n- Maria — Gerente de Dados\n- João'));

    const result = await escrever({
      section: secao('participantes'),
      data: participantes,
      gaps: [lacunaDoJoao],
      completed: [],
    });

    expect(result.section!.content).toContain(marcadorDeLacuna(lacunaDoJoao));
    expect(result.lacunasAcrescentadas).toEqual([lacunaDoJoao]);
  });

  it('o marcador cita a pergunta que vai para o usuário, não um texto genérico', async () => {
    expect(marcadorDeLacuna(lacunaDoJoao)).toBe('**[A preencher: Qual é o cargo/papel de João?]**');
  });

  it('resposta vazia do modelo ainda produz a seção, com título e lacunas', async () => {
    complete.mockResolvedValueOnce(reply(''));

    const result = await escrever({
      section: secao('participantes'),
      data: participantes,
      gaps: [lacunaDoJoao],
      completed: [],
    });

    expect(result.section!.content).toContain('## Participantes e cargos');
    expect(result.section!.content).toContain(marcadorDeLacuna(lacunaDoJoao));
  });
});

describe('guarda contra vazamento de instrução', () => {
  it('toda frase da lista derruba a geração', () => {
    for (const frase of FRASES_PROIBIDAS) {
      expect(() => assertSemVazamento(`texto antes ${frase} texto depois`, 'x'), frase).toThrow(
        /vazou/,
      );
    }
  });

  it('a seção que vazou é nomeada no erro', async () => {
    complete.mockResolvedValueOnce(reply('## Decisões tomadas\n\nO Veredito: adiar a entrega.'));

    await expect(
      escrever({ section: secao('decisoes'), data: {}, gaps: [], completed: [] }),
    ).rejects.toThrow(/Decisões tomadas/);
  });

  it('a comparação distingue caixa — prosa legítima não é falso positivo', () => {
    // "definir uma ação concreta" é frase normal de ata; "Ação Concreta" é
    // título de bloco do PDF. Casar sem distinguir caixa derrubaria geração
    // boa, que é pior que o problema.
    expect(() =>
      assertSemVazamento('A equipe definiu uma ação concreta para a próxima sprint.', 'x'),
    ).not.toThrow();
  });

  it('texto limpo passa', () => {
    expect(() => assertSemVazamento('## Conclusão\n\nO projeto segue no cronograma.', 'x')).not.toThrow();
  });
});

describe('confidence', () => {
  const participantesSpec = secao('participantes');

  it('ok quando há dado e nenhuma lacuna', () => {
    expect(confidenceFor(participantesSpec, 'dados', [])).toBe('ok');
  });

  it('partial quando há dado e alguma lacuna', () => {
    expect(confidenceFor(participantesSpec, 'dados', [lacunaDoJoao])).toBe('partial');
  });

  it('missing quando uma seção obrigatória ficou sem dado', () => {
    expect(confidenceFor(participantesSpec, null, [])).toBe('missing');
  });

  it('seção opcional sem dado é partial, não missing', () => {
    // `missing` significa "faltou algo que a ata precisa ter". Outcomes é
    // `required: false`: não ter outcome não é defeito da geração.
    expect(confidenceFor(secao('outcomes'), null, [])).toBe('partial');
  });
});

describe('o que o Escritor recebe', () => {
  it('NÃO recebe a transcrição', async () => {
    // O que entra no documento já foi decidido e conferido. Dar a transcrição
    // ao Escritor abriria uma segunda porta para informação não auditada.
    complete.mockResolvedValueOnce(reply('## Participantes e cargos\n\n- Maria'));

    await escrever({
      section: secao('participantes'),
      data: participantes,
      gaps: [],
      completed: [],
    });

    const req = complete.mock.calls[0]![1];
    const tudo = `${req.system}\n${req.messages[0].content}\n${req.cacheablePrefix ?? ''}`;
    expect(tudo).not.toContain('Maria, gerente de dados, abriu a reunião');
    expect(req.cacheablePrefix).toBeUndefined();
  });

  it('as seções já escritas vão como prefixo cacheável', async () => {
    // Elas crescem por acréscimo, então o prefixo da seção k contém o da
    // k-1 — é o formato que o cache de prefixo aproveita.
    const anteriores: RenderedSection[] = [
      { id: 'identificacao', title: 'Identificação', content: '## Identificação\n\n13/08/2026', confidence: 'ok' },
    ];
    complete.mockResolvedValueOnce(reply('## Participantes e cargos\n\n- Maria'));

    await escrever({
      section: secao('participantes'),
      data: participantes,
      gaps: [],
      completed: anteriores,
    });

    expect(complete.mock.calls[0]![1].cacheablePrefix).toContain('## Identificação');
  });

  it('recebe os dados da seção, e só os dela', async () => {
    complete.mockResolvedValueOnce(reply('## Participantes e cargos\n\n- Maria'));

    await escrever({
      section: secao('participantes'),
      data: { ...participantes, conclusion: { text: 'CONCLUSAO DE OUTRA SECAO' } },
      gaps: [],
      completed: [],
    });

    const pedido = complete.mock.calls[0]![1].messages[0].content;
    expect(pedido).toContain('Maria');
    expect(pedido).not.toContain('CONCLUSAO DE OUTRA SECAO');
  });
});
