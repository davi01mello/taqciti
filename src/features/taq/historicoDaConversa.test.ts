/**
 * O histórico que vai ao modelo, quando um turno é maior que o limite.
 *
 * Antes, um turno sozinho acima de `maxCaracteres` fazia o laço parar sem
 * escolher NENHUM turno: o modelo perdia a conversa inteira sem aviso. Agora fica
 * o FIM do turno (o mais recente), marcado como parcial.
 */
import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@/home/conversations';
import { historicoDaConversa } from './contexto';

const msg = (role: 'user' | 'assistant', text: string, i: number): ConversationMessage =>
  ({ id: `m${i}`, role, text, at: i }) as ConversationMessage;

describe('historicoDaConversa', () => {
  it('cabe tudo: devolve os turnos na ordem, com a pessoa abrindo e fechando por um marcador', () => {
    const h = historicoDaConversa([msg('user', 'Oi', 1), msg('assistant', 'Olá!', 2), msg('user', 'E agora?', 3)], 1000);
    expect(h.map((t) => t.papel)).toEqual(['pessoa', 'modelo', 'pessoa', 'modelo']);
    expect((h[3] as { texto: string }).texto).toBe('(sem resposta registrada)');
  });

  it('um turno maior que o limite não zera o histórico: fica o fim dele, avisando que o começo foi omitido', () => {
    const longo = `${'a'.repeat(800)}FIM-IMPORTANTE`;
    const h = historicoDaConversa([msg('assistant', longo, 1)], 300);
    expect(h.length).toBeGreaterThan(0);
    const texto = h.map((t) => ('texto' in t ? t.texto : '')).join('\n');
    expect(texto).toContain('[início deste turno omitido por tamanho]');
    expect(texto).toContain('FIM-IMPORTANTE');
    expect(texto.length).toBeLessThan(longo.length);
  });

  it('com turnos recentes que cabem e um antigo enorme, os recentes ficam e o antigo sai (sem aviso, é só histórico velho)', () => {
    const h = historicoDaConversa(
      [msg('user', 'x'.repeat(5000), 1), msg('assistant', 'resposta antiga', 2), msg('user', 'pergunta recente', 3), msg('assistant', 'resposta recente', 4)],
      200,
    );
    const texto = h.map((t) => ('texto' in t ? t.texto : '')).join('\n');
    expect(texto).toContain('resposta recente');
    expect(texto).toContain('pergunta recente');
    expect(texto).not.toContain('xxxxx');
  });

  it('sem mensagens, não há histórico', () => {
    expect(historicoDaConversa([], 1000)).toEqual([]);
  });
});
