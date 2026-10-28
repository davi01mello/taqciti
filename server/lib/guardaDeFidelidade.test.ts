/**
 * Os três defeitos que a revisão da geração real de 20/10/2026 achou, como
 * teste: cargo deduzido, gravidade inventada e hipótese dita como fato.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentData } from './documentData';
import {
  certezaIndevida,
  frases,
  guardarFidelidade,
  nomeAparece,
  normalizar,
  prazoAparece,
  palavrasForaDaFonte,
  turnosEmVolta,
} from './guardaDeFidelidade';

const TRANSCRICAO = [
  '[08:28] Pessoa D: Eu acho que para gerente tá parecendo também, mas a gente pode mudar isso aí.',
  '[09:40] Pessoa D: Eu acho que eu vou poder saber dizer o que foi pode ter acontecido, talvez tenha mexido para saber como é que é que te ver também ficou no banco de dados.',
  '[09:55] Pessoa D: Que ele já foi aprovado uma vez e pode ter contado isso como uma taxa de aprovação.',
  '[16:34] Pessoa B: Eu tô conseguindo entrar.',
].join('\n');

const q = (quote: string) => ({ quote, anchor: null });
/** Citação ANCORADA na transcrição, como o Leitor a devolve de verdade. */
const qa = (quote: string) => {
  const start = TRANSCRICAO.indexOf(quote);
  return { quote, anchor: { start, end: start + quote.length, exact: true } };
};

describe('léxico fora da fonte', () => {
  it('cargo que a reunião não diz é pego; o que ela diz passa', () => {
    expect(palavrasForaDaFonte('Painel gerencial do perfil de diretoria.', TRANSCRICAO)).toEqual(['diretor/diretoria']);
    expect(palavrasForaDaFonte('Visível também para o gerente.', TRANSCRICAO)).toEqual([]);
  });

  it('"gerencial" (de dashboard) não é "gerente"', () => {
    expect(palavrasForaDaFonte('O dashboard gerencial foi entregue.', 'sem cargo nenhum aqui')).toEqual([]);
  });

  it('gravidade inventada é pega', () => {
    expect(palavrasForaDaFonte('Foram relatadas falhas críticas na instalação.', TRANSCRICAO)).toEqual(['gravidade']);
    expect(palavrasForaDaFonte('Falha urgente no envio.', TRANSCRICAO)).toEqual(['gravidade']);
  });

  it('ignora acento e caixa', () => {
    expect(normalizar('DIRETORIA Crítica')).toBe('diretoria critica');
    expect(palavrasForaDaFonte('CRÍTICO', TRANSCRICAO)).toEqual(['gravidade']);
  });
});

describe('certeza indevida', () => {
  const citacaoHipotese = 'Que ele já foi aprovado uma vez e pode ter contado isso como uma taxa de aprovação.';

  it('"constatou-se que se deve a…" sobre uma hipótese cai', () => {
    expect(
      certezaIndevida(
        'Constatou-se que a divergência na taxa de aprovação se deve a registros de testes no banco de dados.',
        ['Eu acho que ... talvez tenha mexido ... ficou no banco de dados.', citacaoHipotese],
      ),
    ).toBe(true);
  });

  it('a frase que JÁ mantém a dúvida fica', () => {
    expect(
      certezaIndevida(
        'Apontou-se como provável causa a permanência de dados de testes no banco de dados.',
        [citacaoHipotese],
      ),
    ).toBe(false);
  });

  it('afirmação causal apoiada em citação firme fica', () => {
    expect(
      certezaIndevida('Constatou-se que o botão não gera arquivo com informações.', [
        'O meu baixou, só que não veio com nenhuma informação porque não tem nada ainda.',
      ]),
    ).toBe(false);
  });

  it('um "acho" de OUTRO assunto não derruba a frase causal', () => {
    expect(
      certezaIndevida('Constatou-se que o relatório foi enviado devido ao pedido da gerência.', [
        'Eu acho que para gerente tá parecendo também.',
      ]),
    ).toBe(false);
  });

  it('"dados residuais que afetavam a taxa" também afirma a causa, mesmo sem "se deve a"', () => {
    expect(
      certezaIndevida('A depuração de dados residuais de teste que afetavam a taxa de aprovação é necessária.', [
        'Que ele já foi aprovado uma vez e pode ter contado isso como uma taxa de aprovação ficou no banco de dados.',
      ]),
    ).toBe(true);
  });

  it('frases() preserva o texto inteiro', () => {
    const texto = 'Primeira frase. Segunda frase! Terceira?';
    expect(frases(texto).join('')).toBe(texto);
    expect(frases(texto)).toHaveLength(3);
  });
});

describe('guardarFidelidade no DocumentData', () => {
  it('Ata: a frase causal certa cai do tópico e o resto fica', () => {
    const data: DocumentData = {
      topicsDiscussed: [
        {
          title: 'Dashboard',
          summary:
            'Foi apontada uma divergência na taxa de aprovação, de 17%. Constatou-se que a divergência se deve a registros residuais de testes no banco de dados.',
          // Citações mínimas, como o Leitor cita: a dúvida ("talvez", "acho") está
          // na MESMA fala, mas não no trecho citado.
          quotes: [qa('ficou no banco de dados.'), qa('Eu tô conseguindo entrar.')],
        },
      ],
    };
    const descartes = guardarFidelidade(data, TRANSCRICAO);
    expect(data.topicsDiscussed![0]!.summary).toBe('Foi apontada uma divergência na taxa de aprovação, de 17%.');
    expect(descartes).toHaveLength(1);
    expect(descartes[0]).toMatchObject({ sectionId: 'topicos_discutidos', path: 'topicsDiscussed[0]' });
    expect(descartes[0]!.motivo).toMatch(/hipótese/);
  });

  it('a dúvida está em outra fala, ANTES da citada, numa transcrição de turnos de várias linhas', () => {
    // Caso real de 20/10: a citação é a fala das 09:55 (três linhas), e o
    // "talvez … ficou no banco de dados" está na das 09:40. Contar LINHAS não
    // alcançava; a janela é por TURNO de fala.
    const transcricao = [
      '[09:32] Pessoa A: Inclusive todos estão a oito dias.',
      '[09:40] Pessoa D: Eu acho que talvez tenha mexido, e ficou no banco de dados.',
      '[09:50] Pessoa B: Teste né?',
      '[09:55] Pessoa D: aí.',
      'ficou guardado.',
      'Que ele já foi aprovado uma vez.',
      '[10:45] Pessoa A: Então tem que limpar.',
    ].join('\n');
    const citada = 'Que ele já foi aprovado uma vez.';
    const start = transcricao.indexOf(citada);
    const data: DocumentData = {
      topicsDiscussed: [
        {
          title: 'Dashboard',
          summary: 'Constatou-se que a divergência se deve a registros de testes no banco de dados.',
          quotes: [{ quote: citada, anchor: { start, end: start + citada.length, exact: true } }],
        },
      ],
    };
    const descartes = guardarFidelidade(data, transcricao);
    expect(descartes).toHaveLength(1);
    expect(data.topicsDiscussed).toEqual([]);
  });

  it('turnos: sem carimbo, cada linha é um turno; com carimbo, a continuação se junta à fala', () => {
    const start = 'a\n'.length; // o `b`
    expect(turnosEmVolta('a\nb\nc', { start, end: start + 1 }, 1, 1)).toEqual(['a', 'b', 'c']);
    const comCarimbo = '[01:00] A: primeira\ncontinua\n[01:05] B: segunda';
    expect(turnosEmVolta(comCarimbo, { start: comCarimbo.indexOf('continua'), end: 30 }, 0, 0)).toEqual([
      '[01:00] A: primeira continua',
    ]);
  });

  it('item de lista cai inteiro: "perfil de diretoria" no output', () => {
    const data: DocumentData = {
      outputs: [
        { text: 'Painel gerencial do perfil de diretoria disponibilizado.', quotes: [] },
        { text: 'Cadastro de empreendimentos disponibilizado.', quotes: [] },
      ],
    };
    const descartes = guardarFidelidade(data, TRANSCRICAO);
    expect(data.outputs!.map((o) => o.text)).toEqual(['Cadastro de empreendimentos disponibilizado.']);
    expect(descartes[0]).toMatchObject({ sectionId: 'outputs', path: 'outputs[0]' });
    expect(descartes[0]!.motivo).toMatch(/diretor/);
  });

  it('tópico que perde todas as frases some; conclusão idem', () => {
    const data: DocumentData = {
      topicsDiscussed: [{ title: 'X', summary: 'A diretoria aprovou.', quotes: [] }],
      conclusion: { text: 'Falha crítica identificada.' },
    };
    guardarFidelidade(data, TRANSCRICAO);
    expect(data.topicsDiscussed).toEqual([]);
    expect(data.conclusion).toBeUndefined();
  });

  it('Daily/Planning/Review (seção genérica): ponto com severidade inventada cai', () => {
    const data: DocumentData = {
      generic: { documento: [{ text: 'Falha grave na instalação.', quotes: [] }, { text: 'Exportação para Excel pendente.', quotes: [] }] },
    };
    guardarFidelidade(data, TRANSCRICAO);
    expect(data.generic!.documento!.map((i) => i.text)).toEqual(['Exportação para Excel pendente.']);
  });

  it('resumo: a frase some do período e o horário e o título ficam', () => {
    const data: DocumentData = {
      periods: [{ title: 'Dashboard', start: '00:08:28', summary: 'Pessoa B questionou a taxa. O gerente de projeto aprovou.', quotes: [] }],
    };
    guardarFidelidade(data, 'Pessoa B questionou a taxa de 17%.');
    expect(data.periods![0]).toMatchObject({ title: 'Dashboard', start: '00:08:28', summary: 'Pessoa B questionou a taxa.' });
  });

  it('texto limpo passa intacto, sem descarte', () => {
    const data: DocumentData = {
      topicsDiscussed: [{ title: 'T', summary: 'A extensão não aparece na barra de ferramentas.', quotes: [] }],
      outcomes: [{ text: 'Alinhamento sobre o filtro.', quotes: [] }],
    };
    const antes = JSON.stringify(data);
    expect(guardarFidelidade(data, TRANSCRICAO)).toEqual([]);
    expect(JSON.stringify(data)).toBe(antes);
  });
});

/**
 * Encaminhamentos (28/10/2026): dono e prazo só ficam se estão nas falas em
 * volta das citações. O defeito de origem: "A e D farão a limpeza" quando um
 * só comentou o assunto (`docs/redesenho-dos-documentos.md`, causa 2).
 */
describe('dono e prazo do encaminhamento', () => {
  const transcricao = [
    '[10:00] Pessoa A: Precisamos limpar a base de teste.',
    '[10:01] Pessoa D: Deixa comigo, faço até sexta.',
    '[10:02] Pessoa C: Beleza.',
  ].join('\n');
  const ancora = (trecho: string) => {
    const start = transcricao.indexOf(trecho);
    return { quote: trecho, anchor: { start, end: start + trecho.length, exact: true } };
  };

  it('o nome vale por parte, como a fala o chama', () => {
    expect(nomeAparece('Pessoa D', normalizar('[10:01] Pessoa D: Deixa comigo'))).toBe(true);
    expect(nomeAparece('Ana Souza', normalizar('a Ana fica com isso'))).toBe(true);
    expect(nomeAparece('Bruno', normalizar('a Ana fica com isso'))).toBe(false);
  });

  it('prazo: palavras de ligação não contam; prazo convertido não passa', () => {
    expect(prazoAparece('até sexta', normalizar('faço até sexta'))).toBe(true);
    expect(prazoAparece('sexta-feira', normalizar('faço até sexta'))).toBe(false);
    expect(prazoAparece('15/11', normalizar('dia quinze de novembro'))).toBe(false);
    expect(prazoAparece('semana que vem', normalizar('na semana que vem eu vejo'))).toBe(true);
  });

  it('dono que não aparece nas falas sai, e a ação fica sem dono', () => {
    const data: DocumentData = {
      actionItems: [
        { acao: 'Limpar a base de teste', responsavel: 'Pessoa D', prazo: 'até sexta', quotes: [ancora('Deixa comigo, faço até sexta.')] },
        { acao: 'Revisar o dashboard', responsavel: 'Pessoa Z', prazo: 'amanhã', quotes: [ancora('Beleza.')] },
      ],
    };
    const descartes = guardarFidelidade(data, transcricao);
    expect(data.actionItems![0]).toMatchObject({ responsavel: 'Pessoa D', prazo: 'até sexta' });
    expect(data.actionItems![1]!.responsavel).toBeUndefined();
    expect(data.actionItems![1]!.prazo).toBeUndefined();
    expect(data.actionItems![1]!.acao).toBe('Revisar o dashboard');
    expect(descartes.map((d) => d.path)).toEqual(['actionItems[1].responsavel', 'actionItems[1].prazo']);
  });

  it('cargo na atuação derruba a atuação, e a pessoa fica', () => {
    const data: DocumentData = {
      participants: [{ name: 'Pessoa A', roleSource: 'unknown', atuacao: 'como gerente, pediu a limpeza', quotes: [ancora('Precisamos limpar a base de teste.')] }],
    };
    guardarFidelidade(data, transcricao);
    expect(data.participants).toHaveLength(1);
    expect(data.participants![0]!.atuacao).toBeUndefined();
  });
});