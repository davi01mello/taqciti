import { describe, expect, it } from 'vitest';
import { escapeHtml, renderHtml, SECTION_RENDERERS } from './html';
import { MARCA_LARGURA_PT } from './brand';
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
  signature: { name: 'Ana Souza', role: 'Gerente de Projetos' },
};

const lacunaCargo: Gap = {
  sectionId: 'participantes',
  field: 'participants[Ana].role',
  question: 'Qual é o cargo/papel de Ana?',
  why: 'Não houve evidência na reunião do cargo de Ana.',
};

const render = (data: DocumentData = completa, gaps: Gap[] = [lacunaCargo]) =>
  renderHtml({ documentType: 'ata', data, gaps, title: 'Ata de Reunião — Projeto Fênix' });

/** As seções que o modelo apresenta COM cabeçalho próprio. */
const COM_CABECALHO = ['topicos_discutidos', 'decisoes', 'outcomes', 'outputs', 'conclusao'];

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
      .filter((s) => COM_CABECALHO.includes(s.id) && s.id !== 'outcomes')
      .map((s) => html.indexOf(`>${escapeHtml(s.title)}</h2>`));

    expect(posicoes).not.toContain(-1);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
  });
});

describe('estilo do modelo institucional', () => {
  it('traz a marca embutida, sem depender de rede', () => {
    // Um `<img src="https://...">` faria a ata depender do servidor estar no
    // ar quando alguém abre o arquivo — e o arquivo é o que sobrevive ao
    // servidor.
    const html = render();
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain(`width:${MARCA_LARGURA_PT}pt`);
  });

  it('abre com o título do modelo', () => {
    expect(render()).toContain('Ata de reunião</h1>');
  });

  it('usa Arial, como o modelo', () => {
    expect(render()).toContain('Arial');
  });

  it('traz o rodapé institucional', () => {
    const html = render();
    expect(html).toContain('Centro Integrado de tecnologia da Informação');
    expect(html).toContain('CIn, UFPE');
  });

  it('apresenta data, tópico e andamento como linhas rotuladas', () => {
    // No modelo elas não têm cabeçalho de seção: são DATA:, TÓPICO: e
    // ANDAMENTO: em linha.
    const html = render();
    expect(html).toContain('DATA:');
    expect(html).toContain('TÓPICO:');
    expect(html).toContain('ANDAMENTO:');
  });

  it('participantes vêm sob o rótulo do modelo, sem cabeçalho de seção', () => {
    const html = render();
    expect(html).toContain('PARTICIPANTES &ndash; CARGO:');
    expect(html).not.toContain('>Participantes e cargos</h2>');
  });

  it('fecha com "Atenciosamente," e a assinatura', () => {
    const html = render();
    expect(html).toContain('Atenciosamente,');
    expect(html).toContain('Ana Souza &ndash; Gerente de Projetos');
    expect(html).not.toContain('>Assinatura</h2>');
  });

  it('identificação e tópico geral não ganham cabeçalho', () => {
    // O modelo não os traz. Um `<h2>Identificação</h2>` no meio de uma ata
    // institucional denuncia a estrutura interna do gerador.
    const html = render();
    expect(html).not.toContain('>Identificação</h2>');
    expect(html).not.toContain('>Tópico geral</h2>');
  });

  it('as seções do corpo GANHAM cabeçalho', () => {
    const html = render();
    for (const id of COM_CABECALHO.filter((s) => s !== 'outcomes')) {
      const titulo = TEMPLATES.ata.sections.find((s) => s.id === id)!.title;
      expect(html, id).toContain(`>${escapeHtml(titulo)}</h2>`);
    }
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
  });

  it('o título também é escapado', () => {
    const html = renderHtml({
      documentType: 'ata',
      data: completa,
      gaps: [],
      title: 'Ata <b>X</b>',
    });
    expect(html).not.toContain('<title>Ata <b>X</b></title>');
  });
});

describe('lacunas', () => {
  it('cargo ausente vira marcador no lugar do cargo, não linha separada', () => {
    const html = render();
    expect(html).toContain(
      `Ana &ndash; <span style="font-weight:bold;color:#000000">${escapeHtml(
        textoDeLacuna(lacunaCargo.question),
      )}</span>`,
    );
  });

  it('HTML e markdown mostram a MESMA frase de lacuna', () => {
    // Se divergirem, a ata em HTML e a em markdown discordam sobre o que
    // falta — e a estrutura é a mesma nas duas.
    const nu = marcadorDeLacuna(lacunaCargo).replace(/\*\*/g, '');
    expect(render()).toContain(escapeHtml(nu));
  });

  it('campo sem lacuna correspondente ainda mostra que falta algo', () => {
    // `askWhenMissing` vazio faz a seção degradar em silêncio de propósito.
    // Ali o documento ainda precisa dizer que não se determinou — campo em
    // branco diria que a reunião não tinha aquilo.
    expect(render({ ...completa, metadata: {} }, [])).toContain('A preencher');
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
    const secao = html.slice(html.indexOf('>Decisões tomadas</h2>'));
    expect(secao).toContain(escapeHtml(textoDeLacuna(descartada.question)));
  });
});

describe('omitWhenEmpty', () => {
  it('outcomes vazio some do HTML', () => {
    expect(render()).not.toContain('>Outcomes da reunião</h2>');
  });

  it('outputs com item permanece', () => {
    expect(render()).toContain('>Outputs da reunião</h2>');
  });

  it('decisões vazias NÃO somem — a seção não é omitWhenEmpty', () => {
    // Uma reunião sem decisão precisa registrar que não houve, e não fingir
    // que a seção não existe.
    expect(render({ ...completa, decisions: [] }, [])).toContain('>Decisões tomadas</h2>');
  });

  it('usa a MESMA regra de vazio que o Escritor', () => {
    // Duas definições de "vazio" fariam o HTML e o markdown discordarem
    // sobre quais seções o documento tem.
    const semNenhum = render({ metadata: { date: '12/08/2026' } }, []);
    expect(semNenhum).not.toContain('>Outcomes da reunião</h2>');
    expect(semNenhum).not.toContain('>Outputs da reunião</h2>');
  });
});

describe('compatibilidade com o import do Google Docs', () => {
  it('é um documento completo, com charset', () => {
    // Vai como ARQUIVO. Sem `<meta charset>`, "gestão" chega ao Docs como
    // "gestÃ£o".
    const html = render();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<html lang="pt-BR">');
  });

  it('a aparência vai INLINE, não por classe', () => {
    // O conversor do Drive descarta quase toda regra de folha de estilo e
    // preserva atributo `style`. Estilo por classe chegaria ao Docs como
    // texto sem formatação nenhuma.
    const html = render();
    expect(html).not.toContain('class=');
    expect(html).toContain('<h1 style=');
    expect(html).toContain('<p style=');
  });

  it('a folha de estilo carrega só o que o inline não alcança', () => {
    // `@page` não tem equivalente inline. O resto precisa estar no elemento.
    const html = render();
    const folha = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    expect(folha).toContain('@page');
    expect(folha).not.toContain('h2');
  });

  it('não usa tabela de layout', () => {
    expect(render()).not.toContain('<table');
  });

  it('tópicos discutidos saem numerados', () => {
    // O guidance da Ata pede numeração "para facilitar referência futura", e
    // o modelo também numera.
    expect(render()).toContain('<ol style=');
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
