import { describe, expect, it } from 'vitest';
import { buildExcerpt, EXCERPT_PADDING_CHARS } from './auditor';
import type { CompactedStatement } from '../compactedContext';

const transcript =
  'INICIO. ' +
  'Carlos disse que acha que deveriamos adiar a entrega. ' +
  'MEIO NEUTRO QUE SEPARA OS DOIS TRECHOS POR UMA DISTANCIA GRANDE. '.repeat(20) +
  'Ana disse entao fechamos o adiamento para sexta-feira. ' +
  'FIM.';

function statement(id: string, quote: string): CompactedStatement {
  const start = transcript.indexOf(quote);
  return {
    id,
    text: 'irrelevante',
    quote,
    anchor: start === -1 ? null : { start, end: start + quote.length, exact: true },
    kind: 'decision',
  };
}

const byId = new Map(
  [
    statement('st-001', 'acha que deveriamos adiar a entrega'),
    statement('st-002', 'entao fechamos o adiamento para sexta-feira'),
    { ...statement('st-003', 'inexistente'), anchor: null } as CompactedStatement,
  ].map((s) => [s.id, s]),
);

describe('buildExcerpt', () => {
  it('recorta o trecho da transcrição em volta da âncora', () => {
    const excerpt = buildExcerpt(
      { path: 'x', text: 'y', statementIds: ['st-001'] },
      byId,
      transcript,
      EXCERPT_PADDING_CHARS,
    )!;
    expect(excerpt).toContain('acha que deveriamos adiar a entrega');
  });

  it('a folga é o que torna o trecho julgável', () => {
    // "Concordo." sozinho não diz com o quê, e é justamente a concordância
    // que transforma proposta em decisão. Sem folga o Auditor julgaria no
    // escuro.
    const semFolga = buildExcerpt(
      { path: 'x', text: 'y', statementIds: ['st-001'] },
      byId,
      transcript,
      0,
    )!;
    const comFolga = buildExcerpt(
      { path: 'x', text: 'y', statementIds: ['st-001'] },
      byId,
      transcript,
      200,
    )!;
    expect(comFolga.length).toBeGreaterThan(semFolga.length);
    expect(semFolga).toBe('acha que deveriamos adiar a entrega');
  });

  it('devolve null quando nenhuma âncora sustenta a afirmação', () => {
    // Sem trecho não há o que auditar, e o chamador rejeita sem gastar
    // chamada. Aprovar por omissão seria o oposto do propósito.
    expect(
      buildExcerpt({ path: 'x', text: 'y', statementIds: ['st-003'] }, byId, transcript, 100),
    ).toBeNull();
  });

  it('devolve null para id que não existe', () => {
    expect(
      buildExcerpt({ path: 'x', text: 'y', statementIds: ['nao-existe'] }, byId, transcript, 100),
    ).toBeNull();
  });

  it('junta trechos distantes com separador, preservando os dois', () => {
    const excerpt = buildExcerpt(
      { path: 'x', text: 'y', statementIds: ['st-001', 'st-002'] },
      byId,
      transcript,
      100,
    )!;
    expect(excerpt).toContain('adiar a entrega');
    expect(excerpt).toContain('sexta-feira');
    expect(excerpt).toContain('[...]');
  });

  it('funde trechos que se sobrepõem em vez de repetir o texto', () => {
    // Duas âncoras vizinhas renderiam o mesmo parágrafo duas vezes e só
    // gastariam token.
    const excerpt = buildExcerpt(
      { path: 'x', text: 'y', statementIds: ['st-001', 'st-002'] },
      byId,
      transcript,
      100_000,
    )!;
    expect(excerpt).not.toContain('[...]');
    expect(excerpt).toBe(transcript);
  });

  it('ordena os trechos, mesmo com ids fora de ordem', () => {
    const excerpt = buildExcerpt(
      { path: 'x', text: 'y', statementIds: ['st-002', 'st-001'] },
      byId,
      transcript,
      100,
    )!;
    expect(excerpt.indexOf('adiar a entrega')).toBeLessThan(excerpt.indexOf('sexta-feira'));
  });
});
