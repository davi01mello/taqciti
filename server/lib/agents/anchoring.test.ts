import { describe, expect, it } from 'vitest';
import { buildNormalizedIndex, createLocator, excerptFor } from './anchoring';

const transcript = [
  '**Carlos:** Boa tarde, Ana. Vamos revisar a modelagem do banco de dados?',
  '**Ana:** Concordo.',
  '**Carlos:** Minha sugestão é PostgreSQL.',
  '**Ana:** Concordo.',
].join('\n');

describe('createLocator — busca literal', () => {
  it('localiza a citação e devolve offsets que recortam o mesmo texto', () => {
    // O teste que importa: o offset precisa RECORTAR a citação. Um offset
    // "quase certo" faria o Auditor ler o trecho vizinho e confirmar coisa
    // que ninguém disse.
    const quote = 'Vamos revisar a modelagem do banco de dados?';
    const anchor = createLocator(transcript).locate(quote)!;

    expect(anchor.exact).toBe(true);
    expect(transcript.slice(anchor.start, anchor.end)).toBe(quote);
  });

  it('devolve null para citação que não existe', () => {
    expect(createLocator(transcript).locate('isso nunca foi dito')).toBeNull();
  });

  it('devolve null para citação vazia ou só espaços', () => {
    // String vazia está contida em qualquer texto; sem guarda, uma citação
    // vazia viraria âncora válida na posição 0 e a taxa mentiria.
    const locator = createLocator(transcript);
    expect(locator.locate('')).toBeNull();
    expect(locator.locate('   ')).toBeNull();
  });
});

describe('createLocator — normalização leve', () => {
  it('tolera espaço a mais e caixa diferente, mas marca exact=false', () => {
    const anchor = createLocator(transcript).locate('VAMOS   REVISAR a  modelagem')!;
    expect(anchor.exact).toBe(false);
    expect(transcript.slice(anchor.start, anchor.end).toLowerCase()).toContain('vamos revisar');
  });

  it('tolera aspas curvas trocadas por retas', () => {
    const comAspas = 'Ele disse “bom dia” e saiu.';
    const anchor = createLocator(comAspas).locate('"bom dia"')!;
    expect(anchor.exact).toBe(false);
    expect(comAspas.slice(anchor.start, anchor.end)).toBe('“bom dia”');
  });

  it('NÃO tolera acento apagado — é o defeito que a métrica existe para pegar', () => {
    // Observado no bench: um modelo devolveu "gesto" onde o texto diz
    // "gestão", com o caractere multibyte apagado. Tolerar aqui esconderia
    // o problema justamente no indicador que deveria denunciá-lo.
    const texto = 'o sistema de gestão de clientes';
    expect(createLocator(texto).locate('sistema de gesto de clientes')).toBeNull();
  });

  it('NÃO tolera acento transliterado', () => {
    const texto = 'o sistema de gestão de clientes';
    expect(createLocator(texto).locate('sistema de gestao de clientes')).toBeNull();
  });
});

describe('createLocator — citação repetida', () => {
  it('avança pelas ocorrências em vez de apontar sempre para a primeira', () => {
    // "Concordo." aparece duas vezes. Se as duas âncoras apontassem para a
    // primeira, o Auditor leria o contexto errado na segunda afirmação.
    const locator = createLocator(transcript);
    const primeira = locator.locate('Concordo.')!;
    const segunda = locator.locate('Concordo.')!;

    expect(segunda.start).toBeGreaterThan(primeira.start);
    expect(transcript.slice(segunda.start, segunda.end)).toBe('Concordo.');
  });

  it('volta ao começo quando a citação está antes do cursor', () => {
    // As afirmações costumam vir na ordem da transcrição, mas não é garantido.
    // Quando o modelo devolve fora de ordem, a busca precisa achar mesmo assim.
    const locator = createLocator(transcript);
    locator.locate('Minha sugestão é PostgreSQL.');
    const anterior = locator.locate('Boa tarde, Ana.')!;
    expect(transcript.slice(anterior.start, anterior.end)).toBe('Boa tarde, Ana.');
  });
});

describe('buildNormalizedIndex', () => {
  it('colapsa espaços e mantém o mapa de volta ao original', () => {
    const source = 'a   b';
    const index = buildNormalizedIndex(source);
    expect(index.text).toBe('a b');
    // O espaço normalizado aponta para o PRIMEIRO da corrida.
    expect(index.originalOffset).toEqual([0, 1, 4]);
  });

  it('trata quebra de linha como espaço', () => {
    expect(buildNormalizedIndex('a\n\nb').text).toBe('a b');
  });

  it('preserva acento', () => {
    expect(buildNormalizedIndex('gestão').text).toBe('gestão');
  });

  it('o mapa tem um offset por caractere normalizado', () => {
    const index = buildNormalizedIndex('  Olá   mundo  ');
    expect(index.originalOffset).toHaveLength(index.text.length);
  });
});

describe('excerptFor', () => {
  it('recorta exatamente sem folga', () => {
    const anchor = createLocator(transcript).locate('PostgreSQL')!;
    expect(excerptFor(transcript, anchor)).toBe('PostgreSQL');
  });

  it('acrescenta folga em volta, que é o que o Auditor precisa ler', () => {
    const anchor = createLocator(transcript).locate('PostgreSQL')!;
    const comFolga = excerptFor(transcript, anchor, 30);
    expect(comFolga).toContain('Minha sugestão é PostgreSQL');
    expect(comFolga.length).toBeGreaterThan('PostgreSQL'.length);
  });

  it('não estoura os limites do texto', () => {
    const anchor = { start: 0, end: 5 };
    expect(() => excerptFor(transcript, anchor, 10_000)).not.toThrow();
    expect(excerptFor(transcript, anchor, 10_000)).toBe(transcript);
  });
});
