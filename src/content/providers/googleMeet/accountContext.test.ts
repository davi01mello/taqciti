import { afterEach, describe, expect, it, vi } from 'vitest';
import { readMeetAccountContext } from './accountContext';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('contexto não-autoritativo da conta percebida no Meet', () => {
  it('lê o controle semântico em português', () => {
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
    document.body.innerHTML = `
      <button aria-label="Conta do Google: Ana Pessoa (ana@empresa.com)"></button>
    `;
    expect(readMeetAccountContext()).toEqual({
      email: 'ana@empresa.com',
      displayName: 'Ana Pessoa',
      observedAt: Date.parse('2026-08-02T12:00:00Z'),
      source: 'meet_account_control',
      confidence: 0.95,
    });
  });

  it('lê o layout em inglês e normaliza a caixa do e-mail', () => {
    document.body.innerHTML = `
      <div role="button" aria-label="Google Account: Bob Example (BOB@Example.COM)"></div>
    `;
    expect(readMeetAccountContext()).toMatchObject({
      email: 'bob@example.com',
      displayName: 'Bob Example',
    });
  });

  it('não transforma fala, texto solto ou região live em identidade', () => {
    document.body.innerHTML = `
      <p>Minha conta do Google é fala@cliente.com</p>
      <div aria-live="polite">
        <button aria-label="Conta do Google: Falante (fala@cliente.com)"></button>
      </div>
      <button aria-label="Enviar convite para convidado@cliente.com"></button>
    `;
    expect(readMeetAccountContext()).toBeNull();
  });
});
