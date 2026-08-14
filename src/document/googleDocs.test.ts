import { describe, expect, it } from 'vitest';
import { nomeDoArquivo } from './googleDocs';

const quando = new Date(2026, 7, 12); // 12/08/2026

describe('nomeDoArquivo', () => {
  it('usa o projeto quando ele foi determinado', () => {
    expect(nomeDoArquivo('Ata de Reunião', 'Projeto Fênix', 'Reunião de quinta', quando)).toBe(
      'Ata de Reunião — Projeto Fênix — 12-08-2026',
    );
  });

  it('cai para o título da reunião quando o projeto é lacuna', () => {
    expect(nomeDoArquivo('Ata de Reunião', undefined, 'Reunião de quinta', quando)).toBe(
      'Ata de Reunião — Reunião de quinta — 12-08-2026',
    );
  });

  it('projeto em branco também cai para o título', () => {
    // O servidor omite o campo quando não determina, mas string vazia ou só
    // espaço chegaria aqui como "projeto presente" e produziria um nome com
    // dois travessões seguidos.
    expect(nomeDoArquivo('Ata de Reunião', '   ', 'Reunião de quinta', quando)).toBe(
      'Ata de Reunião — Reunião de quinta — 12-08-2026',
    );
  });

  it('nunca escreve undefined nem colchete', () => {
    // É a primeira coisa que o cliente vê na lista do Drive. Um
    // "[A preencher: ...]" ali transforma uma lacuna interna do documento
    // numa falha aparente do produto.
    const nome = nomeDoArquivo('Ata de Reunião', undefined, 'Reunião', quando);
    expect(nome).not.toContain('undefined');
    expect(nome).not.toContain('[');
  });

  it('zero à esquerda no dia e no mês', () => {
    expect(nomeDoArquivo('Ata', 'P', 'R', new Date(2026, 0, 5))).toContain('05-01-2026');
  });

  it('o rótulo acompanha o tipo de documento', () => {
    expect(nomeDoArquivo('Daily', 'Fênix', 'R', quando)).toBe('Daily — Fênix — 12-08-2026');
  });
});
