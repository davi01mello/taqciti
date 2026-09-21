/**
 * A liberação do `storage.session` para o content script.
 *
 * Este é o teste de uma linha de código que, faltando, apagava uma
 * funcionalidade inteira sem deixar rastro: sem ela o content script não lê a
 * área de sessão, o portão da captura rejeita em silêncio, e a extensão nunca
 * pergunta se deve registrar a reunião. Ver `sessionAccess.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liberarSessionParaContentScripts } from './sessionAccess';

let setAccessLevel: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setAccessLevel = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', { storage: { session: { setAccessLevel } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('liberarSessionParaContentScripts', () => {
  it('abre a área de sessão para contextos não confiáveis', async () => {
    await liberarSessionParaContentScripts();

    // `TRUSTED_AND_UNTRUSTED_CONTEXTS` é o único valor que alcança o content
    // script; o padrão do MV3 (`TRUSTED_CONTEXTS`) é o que quebrava tudo.
    expect(setAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
    });
  });

  /*
   * A inicialização inteira do background é encadeada nesta promessa. Deixar a
   * rejeição escapar transformaria um Chrome sem a API num background que nunca
   * responde mensagem nenhuma — uma falha muito pior do que a que se queria
   * evitar.
   */
  it('não derruba o boot quando o Chrome recusa', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    setAccessLevel.mockRejectedValueOnce(new Error('sem suporte'));

    await expect(liberarSessionParaContentScripts()).resolves.toBeUndefined();
    expect(erro).toHaveBeenCalled();
  });
});
