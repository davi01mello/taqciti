import { describe, expect, it } from 'vitest';
import { pedeAcaoExterna } from '@/features/taq/politica';
import { pedidoDeEnvio, pedidoDeRedacao } from './Carta';

describe('os pedidos da carta ao Taq', () => {
  it('"Enviar" é um pedido de ação externa, e leva o texto inteiro', () => {
    const p = pedidoDeEnvio({
      para: ' Ana Souza ',
      assunto: 'Ata de terça',
      texto: 'Oi, Ana.\n\nSegue a ata.',
      anexo: 'Transcrição.txt',
    });
    expect(pedeAcaoExterna(p)).toBe(true);
    expect(p).toContain('Para: Ana Souza');
    expect(p).toContain('Assunto: Ata de terça');
    expect(p).toContain('"""\nOi, Ana.\n\nSegue a ata.\n"""');
    expect(p).toContain('Anexo: Transcrição.txt');
  });

  it('"Redigir" não pede envio: só texto para revisar', () => {
    const p = pedidoDeRedacao({ para: 'Ana', assunto: '', texto: '' });
    expect(pedeAcaoExterna(p)).toBe(false);
    expect(p).not.toContain('"""');
  });
});
