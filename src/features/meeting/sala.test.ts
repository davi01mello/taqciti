import { describe, expect, it } from 'vitest';
import { salaDaUrl, salaDoCaminho } from './sala';

describe('salaDoCaminho', () => {
  it('reconhece o código padrão, com ou sem barra final', () => {
    expect(salaDoCaminho('/abc-defg-hij')).toBe('abc-defg-hij');
    expect(salaDoCaminho('/ABC-defg-hij/')).toBe('abc-defg-hij');
  });

  it('reconhece o apelido de sala do Workspace', () => {
    expect(salaDoCaminho('/sala-do-citi')).toBe('sala-do-citi');
    expect(salaDoCaminho('/daily_citi/')).toBe('daily_citi');
  });

  it('não confunde as páginas do Meet com salas', () => {
    for (const p of ['/', '/landing', '/new', '/lookup/abc123', '/tel/123', '/ab', '/a/b']) {
      expect(salaDoCaminho(p)).toBeNull();
    }
  });
});

describe('salaDaUrl', () => {
  it('ignora query e âncora, e só vale no meet.google.com por https', () => {
    expect(salaDaUrl('https://meet.google.com/abc-defg-hij?authuser=1&pli=1')).toBe('abc-defg-hij');
    expect(salaDaUrl('https://meet.google.com/sala-do-citi#x')).toBe('sala-do-citi');
    expect(salaDaUrl('https://meet.google.com/landing')).toBeNull();
    expect(salaDaUrl('http://meet.google.com/abc-defg-hij')).toBeNull();
    expect(salaDaUrl('https://example.com/abc-defg-hij')).toBeNull();
    expect(salaDaUrl('não é url')).toBeNull();
  });
});
