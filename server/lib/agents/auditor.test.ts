import { describe, expect, it } from 'vitest';
import { buildExcerpt, EXCERPT_PADDING_CHARS, QUOTE_CLOSE, QUOTE_OPEN } from './auditor';
import type { LocatedAnchor } from './anchoring';

const transcript =
  'INICIO. ' +
  'Carlos disse que acha que deveriamos adiar a entrega. ' +
  'MEIO NEUTRO QUE SEPARA OS DOIS TRECHOS POR UMA DISTANCIA GRANDE. '.repeat(20) +
  'Ana disse entao fechamos o adiamento para sexta-feira. ' +
  'FIM.';

function anchor(quote: string): LocatedAnchor {
  const start = transcript.indexOf(quote);
  if (start === -1) throw new Error(`fixture inválida: "${quote}" não está na transcrição.`);
  return { start, end: start + quote.length, exact: true };
}

const PROPOSTA = anchor('acha que deveriamos adiar a entrega');
const FECHAMENTO = anchor('entao fechamos o adiamento para sexta-feira');

/** O texto sem os delimitadores, para asserções sobre o recorte em si. */
const semMarcas = (excerpt: string) => excerpt.split(QUOTE_OPEN).join('').split(QUOTE_CLOSE).join('');

describe('buildExcerpt', () => {
  it('recorta o trecho da transcrição em volta da âncora', () => {
    const excerpt = buildExcerpt([PROPOSTA], transcript, EXCERPT_PADDING_CHARS)!;
    expect(excerpt).toContain('acha que deveriamos adiar a entrega');
  });

  it('marca dentro do trecho o que foi citado', () => {
    // A folga existe para dar vizinhança legível, não para ser evidência. Sem
    // a marcação, o Auditor não distingue o que foi apontado do que só estava
    // por perto — e foi assim que uma concordância de outro assunto sustentou
    // uma decisão.
    const excerpt = buildExcerpt([PROPOSTA], transcript, 100)!;
    expect(excerpt).toContain(`${QUOTE_OPEN}acha que deveriamos adiar a entrega${QUOTE_CLOSE}`);
  });

  it('a folga é o que torna o trecho julgável', () => {
    // "Concordo." sozinho não diz com o quê. Sem folga o Auditor julgaria no
    // escuro.
    const semFolga = buildExcerpt([PROPOSTA], transcript, 0)!;
    const comFolga = buildExcerpt([PROPOSTA], transcript, 200)!;
    expect(comFolga.length).toBeGreaterThan(semFolga.length);
    expect(semMarcas(semFolga)).toBe('acha que deveriamos adiar a entrega');
  });

  it('devolve null quando nenhuma âncora sustenta a afirmação', () => {
    // Sem trecho não há o que auditar, e o chamador rejeita sem gastar
    // chamada. Aprovar por omissão seria o oposto do propósito.
    expect(buildExcerpt([], transcript, 100)).toBeNull();
  });

  it('junta trechos distantes com separador, preservando os dois', () => {
    const excerpt = buildExcerpt([PROPOSTA, FECHAMENTO], transcript, 100)!;
    expect(excerpt).toContain('adiar a entrega');
    expect(excerpt).toContain('sexta-feira');
    expect(excerpt).toContain('[...]');
  });

  it('marca as duas citações quando são duas', () => {
    // O caso da decisão: proposta e concordância vêm ancoradas separadamente,
    // e as duas precisam aparecer marcadas.
    const excerpt = buildExcerpt([PROPOSTA, FECHAMENTO], transcript, 100)!;
    expect(excerpt.split(QUOTE_OPEN)).toHaveLength(3);
    expect(excerpt.split(QUOTE_CLOSE)).toHaveLength(3);
  });

  it('funde trechos que se sobrepõem em vez de repetir o texto', () => {
    // Duas âncoras vizinhas renderiam o mesmo parágrafo duas vezes e só
    // gastariam token.
    const excerpt = buildExcerpt([PROPOSTA, FECHAMENTO], transcript, 100_000)!;
    expect(excerpt).not.toContain('[...]');
    expect(semMarcas(excerpt)).toBe(transcript);
  });

  it('ordena os trechos, mesmo com âncoras fora de ordem', () => {
    const excerpt = buildExcerpt([FECHAMENTO, PROPOSTA], transcript, 100)!;
    expect(excerpt.indexOf('adiar a entrega')).toBeLessThan(excerpt.indexOf('sexta-feira'));
  });

  it('âncora contida em outra não abre delimitador dentro de delimitador', () => {
    // O Pensante pode citar a frase e, na concordância, um pedaço dela.
    // Marcar as duas produziria ⟦...⟦...⟧...⟧, que o prompt não sabe ler.
    const interna = anchor('adiar a entrega');
    const excerpt = buildExcerpt([PROPOSTA, interna], transcript, 50)!;
    expect(excerpt.split(QUOTE_OPEN)).toHaveLength(2);
    expect(semMarcas(excerpt)).toContain('acha que deveriamos adiar a entrega');
  });
});
