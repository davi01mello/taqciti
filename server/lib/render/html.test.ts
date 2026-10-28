import { describe, expect, it } from 'vitest';
import { escapeHtml, renderHtml, SECTION_RENDERERS } from './html';
import { MARCA_CAPA_LARGURA_PT } from './brand';
import { CINZA_LINHA, TAMANHO_RODAPE_PT, TINTA } from './typography';
import { TEMPLATES } from '../templates';
import { textoDeLacuna, type DocumentData, type Gap } from '../documentData';
import { marcadorDeLacuna } from '../vazamento';

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
  executiveSummary: [{ text: 'A entrega foi remarcada para 28/08/2026.', quotes: [] }],
  actionItems: [
    { acao: 'Enviar a lista de endpoints', responsavel: 'Ana', prazo: 'sexta', quotes: [] },
    { acao: 'Revisar o contrato da API', quotes: [] },
  ],
  openPoints: [{ text: 'Ninguém respondeu quem libera o acesso de produção.', quotes: [] }],
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
const COM_CABECALHO = [
  'resumo_executivo',
  'topicos_discutidos',
  'decisoes',
  'encaminhamentos',
  'outcomes',
  'outputs',
  'em_aberto',
];

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
    expect(html).toContain(`width:${Math.round(MARCA_CAPA_LARGURA_PT)}pt`);
  });

  it('abre com o título do modelo', () => {
    expect(render()).toContain('Ata de reunião</h1>');
  });

  it('pede Barlow, com Arial (a do modelo) como queda', () => {
    // Barlow é a fonte escolhida; no HTML ela não pode ser embutida, então o
    // que precisa estar garantido é a ORDEM — Barlow primeiro, e uma queda
    // que não seja uma fonte qualquer do sistema.
    const familia = /font-family:Barlow, ?Arial/;
    expect(render()).toMatch(familia);
  });

  it('escapa < > & aspas vindos do conteúdo, não só do fixture', () => {
    // O `<` já tinha teste unitário em `escapeHtml`, mas nunca havia sido
    // exercitado ATRAVÉS do render — e numa execução real do pipeline ele
    // escapou da conferência porque o Escritor parafraseou o "<200ms" que
    // estava na transcrição. Aqui o caractere é forçado em campos de seções
    // diferentes, que é como ele chegaria de verdade.
    const html = renderHtml({
      documentType: 'ata',
      data: {
        metadata: { date: '12/08/2026', projectName: 'Alpha & Beta <Ltda>' },
        generalTopic: { topic: 'Latência <200ms', progress: 'Meta "p95" & p99 mantida.' },
        participants: [
          { name: 'Ana <Souza>', role: 'Dev & Ops', roleSource: 'meeting', quotes: [] },
        ],
        decisions: [
          {
            text: 'Manter o SLA em <200ms',
            agreement: { quote: 'ok', anchor: { start: 0, end: 2, exact: true } },
            confidence: 'high',
            quotes: [],
          },
        ],
        executiveSummary: [{ text: 'Fecha com "aspas" & sinais <perigosos>.', quotes: [] }],
        actionItems: [{ acao: 'Medir <p95> & p99', responsavel: 'Ana <Souza>', quotes: [] }],
      },
      gaps: [],
      title: 'Ata & <teste>',
    });

    // Nenhuma marcação nova pôde nascer do conteúdo.
    expect(html).not.toContain('<200ms');
    expect(html).not.toContain('<Ltda>');
    expect(html).not.toContain('<Souza>');
    expect(html).not.toContain('<perigosos>');
    expect(html).not.toContain('<p95>');
    expect(html).toContain('Medir &lt;p95&gt; &amp; p99 — responsável: Ana &lt;Souza&gt;');
    expect(html).toContain('&lt;200ms');
    expect(html).toContain('Alpha &amp; Beta &lt;Ltda&gt;');
    expect(html).toContain('&quot;aspas&quot; &amp; sinais &lt;perigosos&gt;');

    // E o documento continua sendo HTML bem formado: todo `&` do arquivo é
    // início de entidade, nenhum é um `&` solto que o parser teria que
    // adivinhar.
    expect(html).not.toMatch(/&(?!amp;|lt;|gt;|quot;|ndash;|#)/);
  });

  it('centraliza a identidade da capa: marca, título e subtítulo', () => {
    // A marca é centralizada pela CAIXA (`margin:0 auto`), não por herdar
    // `text-align` de um pai: o conversor do Docs reescreve a árvore, e é
    // exatamente aí que um `<img>` inline escorrega pra esquerda.
    const html = render();
    expect(html).toMatch(/<img [^>]*style="display:block;margin:[^";]*auto/);
    expect(html).toMatch(/<h1 style="[^"]*text-align:center[^"]*">Ata de reunião<\/h1>/);
    expect(html).toMatch(/<p style="[^"]*text-align:center[^"]*">Projeto Fênix - 12\/08\/2026<\/p>/);
  });

  it('o subtítulo "[Projeto] - [Data]" sai UMA vez, e é na capa', () => {
    // No modelo ele mora sob o título da capa; a página de conteúdo traz só a
    // linha DATA. Repetir era divergência, não redundância inofensiva.
    const html = render();
    const ocorrencias = html.split('Projeto Fênix - 12/08/2026').length - 1;
    expect(ocorrencias).toBe(1);
    expect(html.indexOf('Projeto Fênix - 12/08/2026')).toBeLessThan(html.indexOf('DATA:'));
  });

  it('títulos de seção ficam à ESQUERDA — só a capa é centralizada', () => {
    expect(render()).toMatch(/<h2 style="[^"]*text-align:left[^"]*">Tópicos discutidos<\/h2>/);
  });

  it('traz o rodapé institucional, em preto sob uma linha cinza', () => {
    // No modelo o cinza é só do traço: o texto do rodapé é `0 0 0 rg`, como
    // todo o resto do documento.
    const html = render();
    expect(html).toContain('Centro Integrado de tecnologia da Informação');
    expect(html).toContain('CIn, UFPE');
    expect(html).toContain(`border-top:1px solid ${CINZA_LINHA}`);
    expect(html).toMatch(
      new RegExp(`font-size:${TAMANHO_RODAPE_PT}pt;color:${TINTA}`),
    );
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
    // O rótulo era "PARTICIPANTES – CARGO:" até 28/10/2026; a reunião quase
    // nunca diz cargo, e a linha agora traz a atuação de cada um.
    const html = render();
    expect(html).toContain('PARTICIPANTES:');
    expect(html).not.toContain('>Participantes</h2>');
  });

  it('a atuação vem depois do nome, e o cargo só quando foi dito', () => {
    const html = render({
      ...completa,
      participants: [
        { name: 'Carlos', roleSource: 'unknown', atuacao: 'apresentou o cronograma', quotes: [] },
      ],
    });
    expect(html).toContain('Carlos: apresentou o cronograma');
  });

  it('encaminhamento sem dono vai para o próprio rótulo, sem célula vazia', () => {
    const html = render();
    expect(html).toContain('Enviar a lista de endpoints — responsável: Ana · prazo: sexta');
    expect(html).toContain('SEM RESPONSÁVEL DEFINIDO:');
    expect(html.indexOf('SEM RESPONSÁVEL DEFINIDO:')).toBeLessThan(html.indexOf('Revisar o contrato da API'));
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
      executiveSummary: [{ text: '<script>alert(1)</script> & "aspas" > fim', quotes: [] }],
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

/*
 * Campo ausente NÃO vira "[A preencher: …]". Cargo que a reunião não disse,
 * quem assina, nome do projeto, afirmação que o Auditor derrubou: a linha
 * simplesmente não entra no documento do cliente. Só uma dúvida marcada
 * `extrema` aparece (e hoje nenhuma detecção automática a marca).
 */
describe('lacunas', () => {
  const extrema: Gap = { ...lacunaCargo, extrema: true };

  it('cargo ausente: sai só o nome, sem marcador', () => {
    const html = render();
    expect(html).toContain('Ana</li>');
    expect(html).not.toContain('A preencher');
    expect(html).not.toContain(escapeHtml(lacunaCargo.question));
  });

  it('uma lacuna extrema aparece no lugar do cargo, e é a mesma frase do markdown', () => {
    // Se divergirem, a ata em HTML e a em markdown discordam sobre o que falta.
    const html = render(completa, [extrema]);
    expect(html).toContain(`Ana &ndash; <span style="font-weight:bold;color:#000000">${escapeHtml(textoDeLacuna(extrema.question))}</span>`);
    expect(html).toContain(escapeHtml(marcadorDeLacuna(extrema).replace(/\*\*/g, '')));
  });

  it('campo ausente sem lacuna simplesmente não entra', () => {
    const html = render({ ...completa, metadata: {}, signature: {} }, []);
    expect(html).not.toContain('A preencher');
    expect(html).not.toContain('DATA:');
    expect(html).not.toContain('Atenciosamente');
  });

  it('"Você" não é nome e não entra na lista de participantes', () => {
    const html = render({ ...completa, participants: [...completa.participants!, { name: 'Você', roleSource: 'unknown', quotes: [] }] }, []);
    expect(html).not.toContain('Você');
  });

  it('afirmação descartada pelo Auditor some sem deixar pergunta no documento', () => {
    const descartada: Gap = {
      sectionId: 'decisoes',
      field: 'decisions[0]',
      question: 'A afirmação X deve constar na ata?',
      why: 'Rejeitada duas vezes.',
    };
    const html = render(completa, [descartada]);
    expect(html).not.toContain(escapeHtml(descartada.question));
    // Já a dúvida extrema, sem campo próprio, vai para o fim da seção.
    const secao = render(completa, [{ ...descartada, extrema: true }]);
    expect(secao.slice(secao.indexOf('>Decisões tomadas</h2>'))).toContain(
      escapeHtml(textoDeLacuna(descartada.question)),
    );
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

  it('usa a MESMA regra de vazio que o markdown', () => {
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
  it('daily renderiza pelo genérico, sem quebrar', () => {
    const html = renderHtml({
      documentType: 'daily',
      data: { generic: { documento: [{ text: 'algo discutido', quotes: [] }] } },
      gaps: [],
      title: 'Daily',
    });
    expect(html).toContain('algo discutido');
  });
});

describe('X1 — perguntas e respostas', () => {
  it('renderiza cada par com os dois rótulos pedidos', () => {
    const html = renderHtml({
      documentType: 'x1',
      data: {
        qa: [
          {
            pergunta: 'Por que você quer essa vaga?',
            quotesPergunta: [],
            resposta: 'Porque gosto do desafio técnico.',
            quotesResposta: [],
          },
        ],
      },
      gaps: [],
      title: 'X1',
    });
    expect(html).toContain('Gente e gestão');
    expect(html).toContain('Por que você quer essa vaga?');
    expect(html).toContain('Entrevistado');
    expect(html).toContain('Porque gosto do desafio técnico.');
  });

  it('usa o título do documento, não o da Ata', () => {
    const html = renderHtml({
      documentType: 'x1',
      data: { qa: [] },
      gaps: [],
      title: 'X1',
    });
    expect(html).toContain('Doc de Conversa 1:1 — X1</h1>');
    expect(html).not.toContain('Ata de reunião</h1>');
  });

  it('campo descartado pela auditoria: o par sobra sem o lado que caiu, sem marcador', () => {
    const html = renderHtml({
      documentType: 'x1',
      data: {
        qa: [{ pergunta: 'Por que você quer essa vaga?', quotesPergunta: [], quotesResposta: [] }],
      },
      gaps: [
        {
          sectionId: 'perguntas_respostas',
          field: 'qa[0].resposta',
          question: 'Qual foi a resposta a esta pergunta?',
          why: 'Rejeitada pela conferência contra a transcrição.',
        },
      ],
      title: 'X1',
    });
    expect(html).toContain('Por que você quer essa vaga?');
    expect(html).not.toContain('Qual foi a resposta a esta pergunta?');
    expect(html).not.toContain('A preencher');
    expect(html).not.toContain('Entrevistado');
  });
});

describe('Resumo completo — resumo por período', () => {
  const data = {
    periods: [
      {
        title: 'Abertura e pauta',
        start: '00:00:00',
        end: '00:08:30',
        summary: 'Maria abriu a reunião e apresentou a pauta.',
        quotes: [],
      },
      {
        title: 'Integração com a API',
        start: '00:08:30',
        end: '00:31:10',
        summary: 'A equipe explicou o atraso.\nFicou combinado revisar a documentação.',
        quotes: [],
      },
    ],
  };

  it('mostra os trechos numerados, em ordem, com o intervalo de cada um', () => {
    const html = renderHtml({ documentType: 'resumo', data, gaps: [], title: 'Resumo' });
    expect(html).toContain('1. Abertura e pauta (00:00:00 – 00:08:30)');
    expect(html).toContain('2. Integração com a API (00:08:30 – 00:31:10)');
    expect(html.indexOf('Abertura e pauta')).toBeLessThan(html.indexOf('Integração com a API'));
    expect(html).toContain('Ficou combinado revisar a documentação.');
  });

  it('usa o título próprio e não repete cabeçalho de seção', () => {
    const html = renderHtml({ documentType: 'resumo', data, gaps: [], title: 'Resumo' });
    expect(html).toContain('Resumo completo da reunião</h1>');
    expect(html).not.toContain('Resumo por período</h2>');
    expect(html).not.toContain('Ata de reunião</h1>');
  });

  it('sem carimbo, o trecho sai só com o título', () => {
    const html = renderHtml({
      documentType: 'resumo',
      data: { periods: [{ title: 'Único assunto', summary: 'Tudo.', quotes: [] }] },
      gaps: [],
      title: 'Resumo',
    });
    expect(html).toContain('1. Único assunto<');
  });

  it('escapa HTML no que vem do modelo', () => {
    const html = renderHtml({
      documentType: 'resumo',
      data: { periods: [{ title: 'A <b>', summary: '<script>x</script>', quotes: [] }] },
      gaps: [],
      title: 'Resumo',
    });
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
  });
});
