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
  normalizar,
  palavrasForaDaFonte,
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
