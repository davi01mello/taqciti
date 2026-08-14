import { describe, expect, it } from 'vitest';
import { sanitizarNomeDeArquivo } from './baixarDocumento';

describe('sanitizarNomeDeArquivo', () => {
  it('preserva espaço e travessão — é o formato de nome da especificação', () => {
    expect(sanitizarNomeDeArquivo('Ata de Reunião — Projeto Fênix — 12-08-2026')).toBe(
      'Ata de Reunião — Projeto Fênix — 12-08-2026',
    );
  });

  it('tira barra, que truncaria o nome no download', () => {
    // O nome do projeto vem de uma reunião real. "Fênix/Q3" chegaria aqui.
    expect(sanitizarNomeDeArquivo('Ata — Fênix/Q3 — 12-08-2026')).toBe(
      'Ata — FênixQ3 — 12-08-2026',
    );
  });

  it('tira os demais caracteres que o Windows recusa', () => {
    expect(sanitizarNomeDeArquivo('a<b>c:d"e\\f|g?h*i')).toBe('abcdefghi');
  });

  it('tira ponto final, que o Windows descarta em silêncio', () => {
    expect(sanitizarNomeDeArquivo('Ata do dia...')).toBe('Ata do dia');
  });

  it('colapsa espaço repetido', () => {
    expect(sanitizarNomeDeArquivo('Ata    de   Reunião')).toBe('Ata de Reunião');
  });

  it('nunca devolve string vazia', () => {
    // Nome vazio produziria um arquivo chamado só ".html", que alguns
    // sistemas tratam como oculto e a pessoa não acha.
    expect(sanitizarNomeDeArquivo('///')).toBe('documento');
    expect(sanitizarNomeDeArquivo('   ')).toBe('documento');
  });

  it('corta nome longo demais sem deixar espaço na ponta', () => {
    const longo = sanitizarNomeDeArquivo('x'.repeat(300));
    expect(longo.length).toBe(150);
  });
});
