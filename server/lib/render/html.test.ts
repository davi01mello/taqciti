import { describe, expect, it } from 'vitest';
import { escapeHtml, renderHtml, SECTION_RENDERERS } from './html';
import { TEMPLATES } from '../templates';
import { textoDeLacuna, type DocumentData, type Gap } from '../documentData';
import { marcadorDeLacuna } from '../agents/escritor';

const completa: DocumentData = {
  metadata: { date: '12/08/2026', projectName: 'Projeto Fênix' },
  generalTopic: { topic: 'Cronograma', progress: 'Em andamento.' },
  participants: [
    { name: 'Beatriz', role: 'Arquiteta de integração', roleSource: 'meeting', quotes: [] },
    { name: 'Ana', roleSource: 'unknown', quotes: [] },
  ],
  topicsDiscussed: [{ title: 'Integração', summary: 'A API travou.', quotes: [] }],
  decisions: [
    {
      text: 'Adiar a entrega para 28/08/2026',
      agreement: { quote: 'De acordo, sexta.', anchor: { start: 0, end: 5, exact: true } },
      confidence: 'high',
      quotes: [],
    },
  ],
  outcomes: [],
  outputs: [{ text: 'Lista dos endpoints alterados', quotes: [] }],
  conclusion: { text: 'O projeto segue com a entrega remarcada.' },
  signature: {},
};

const lacunaCargo: Gap = {
  sectionId: 'participantes',
  field: 'participants[Ana].role',
  question: 'Qual é o cargo/papel de Ana?',
  why: 'Não houve evidência na reunião do cargo de Ana.',
};

const render = (data: DocumentData = completa, gaps: Gap[] = [lacunaCargo]) =>
  renderHtml({ documentType: 'ata', data, gaps, title: 'Ata de Reunião — Projeto Fênix' });

describe('cobertura', () => {
  it('toda seção da Ata tem renderizador próprio', () => {
    // Seção da Ata caindo no genérico sairia como lista de texto solto,
    // perdendo a estrutura que o JSON intermediário guarda.
    for (const section of TEMPLATES.ata.sections) {
      expect(SECTION_RENDERERS[section.id], section.id).toBeDefined();
    }
  });

  it('as seções saem na ordem do template', () => {
    const html = render();
    const posicoes = TEMPLATES.ata.sections
      .slice()
      .sort((a, b) => a.order - b.order)
      .filter((s) => s.id !== 'outcomes')
      .map((s) => html.indexOf(`<h2>${escapeHtml(s.title)}</h2>`));

    expect(posicoes).not.toContain(-1);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
  });
});

describe('escape', () => {
  it('texto do modelo não vira marcação', () => {
    // Tudo aqui veio de LLM sobre uma transcrição que o usuário forneceu. Um
    // `<` solto quebraria a estrutura; um `<script>` seria pior que quebrar.
    const html = render({
      ...completa,
      conclusion: { text: '<script>alert(1)</script> & "aspas" > fim' },
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('o título também é escapado', () => {
    const html = renderHtml({
      documentType: 'ata',
      data: completa,
      gaps: [],
      title: 'Ata <b>X</b>',
    });
    expect(html).not.toContain('<b>X</b>');
  });
});

describe('lacunas', () => {
  it('cargo ausente vira marcador no lugar do cargo, não linha separada', () => {
    const html = render();
    expect(html).toContain(
      `Ana &ndash; <strong>${escapeHtml(textoDeLacuna(lacunaCargo.question))}</strong>`,
    );
  });

  it('HTML e markdown mostram a MESMA frase de lacuna', () => {
    // Se divergirem, a ata em HTML e a em markdown discordam sobre o que
    // falta — e a estrutura é a mesma nas duas.
    const emMarkdown = marcadorDeLacuna(lacunaCargo);
    const html = render();
    const nu = emMarkdown.replace(/\*\*/g, '');
    expect(html).toContain(escapeHtml(nu));
  });

  it('campo sem lacuna correspondente ainda mostra que falta algo', () => {
    // `askWhenMissing` vazio faz a seção degradar em silêncio de propósito.
    // Ali o documento ainda precisa dizer que não se determinou — campo em
    // branco diria que a reunião não tinha aquilo.
    const html = render({ ...completa, metadata: {} }, []);
    expect(html).toContain('A preencher');
  });

  it('lacuna sem campo próprio vai para o fim da seção, não some', () => {
    // É o caso da afirmação descartada pelo Auditor: ela não tem um campo
    // para ocupar, mas o leitor precisa ver que ali falta algo.
    const descartada: Gap = {
      sectionId: 'decisoes',
      field: 'decisions[0]',
      question: 'A afirmação X deve constar na ata?',
      why: 'Rejeitada duas vezes.',
    };
    const html = render(completa, [descartada]);
    const secao = html.slice(html.indexOf('<h2>Decisões tomadas</h2>'));
    expect(secao).toContain(escapeHtml(textoDeLacuna(descartada.question)));
  });
});

describe('omitWhenEmpty', () => {
  it('outcomes vazio some do HTML', () => {
    expect(render()).not.toContain('<h2>Outcomes da reunião</h2>');
  });

  it('outputs com item permanece', () => {
    expect(render()).toContain('<h2>Outputs da reunião</h2>');
  });

  it('decisões vazias NÃO somem — a seção não é omitWhenEmpty', () => {
    // Uma reunião sem decisão precisa registrar que não houve, e não fingir
    // que a seção não existe.
    const html = render({ ...completa, decisions: [] }, []);
    expect(html).toContain('<h2>Decisões tomadas</h2>');
  });

  it('usa a MESMA regra de vazio que o Escritor', () => {
    // Duas definições de "vazio" fariam o HTML e o markdown discordarem
    // sobre quais seções o documento tem.
    const semNenhum = render({ metadata: { date: '12/08/2026' } }, []);
    expect(semNenhum).not.toContain('<h2>Outcomes da reunião</h2>');
    expect(semNenhum).not.toContain('<h2>Outputs da reunião</h2>');
  });
});

describe('formato de saída', () => {
  it('é um documento completo, com charset', () => {
    // Vai como ARQUIVO para o `files.create` do Drive. Sem `<meta charset>`,
    // "gestão" chega ao Google Docs como "gestÃ£o".
    const html = render();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<html lang="pt-BR">');
  });

  it('não usa CSS, classe nem tabela — o import do Docs descarta', () => {
    const html = render();
    expect(html).not.toMatch(/<style|class=|<table/i);
  });

  it('tópicos discutidos saem numerados', () => {
    // O guidance da Ata pede numeração "para facilitar referência futura".
    expect(render()).toContain('<ol>');
  });

  it('a decisão sai só com o texto, sem a citação da concordância', () => {
    // A concordância ancorada é evidência para a auditoria, não conteúdo da
    // ata — e o markdown do Escritor também não a imprime.
    const html = render();
    expect(html).toContain('Adiar a entrega para 28/08/2026');
    expect(html).not.toContain('De acordo, sexta.');
  });
});

describe('templates placeholder', () => {
  it('x1 renderiza pelo genérico, sem quebrar', () => {
    const html = renderHtml({
      documentType: 'x1',
      data: { generic: { documento: [{ text: 'algo discutido', quotes: [] }] } },
      gaps: [],
      title: 'X1',
    });
    expect(html).toContain('algo discutido');
  });
});
