import { afterEach, describe, expect, it } from 'vitest';
import { DOMINIO_PADRAO, dominioHospedadoDeFora, dominioPermitido, emailPermitido, mensagemDeRestricao } from './dominio';

const guardado = process.env.TAQCITI_DOMINIO_PERMITIDO;
afterEach(() => {
  if (guardado === undefined) delete process.env.TAQCITI_DOMINIO_PERMITIDO;
  else process.env.TAQCITI_DOMINIO_PERMITIDO = guardado;
});

describe('domínio permitido', () => {
  it('o padrão é o do CITi', () => {
    delete process.env.TAQCITI_DOMINIO_PERMITIDO;
    expect(DOMINIO_PADRAO).toBe('citi.org.br');
    expect(dominioPermitido()).toBe('citi.org.br');
  });

  it.each([['', 'citi.org.br'], ['   ', 'citi.org.br'], ['OUTRA.org', 'outra.org'], ['@outra.org', 'outra.org']])(
    'variável %j vira %j',
    (valor, esperado) => {
      process.env.TAQCITI_DOMINIO_PERMITIDO = valor;
      expect(dominioPermitido()).toBe(esperado);
    },
  );

  it('só o asterisco desliga', () => {
    process.env.TAQCITI_DOMINIO_PERMITIDO = '*';
    expect(dominioPermitido()).toBeNull();
    expect(emailPermitido('qualquer@gmail.com')).toBe(true);
  });

  it('emailPermitido compara o fim exato e ignora caixa e espaços', () => {
    delete process.env.TAQCITI_DOMINIO_PERMITIDO;
    expect(emailPermitido(' Ana@CITI.org.br ')).toBe(true);
    for (const ruim of ['ana@gmail.com', 'ana@naoehciti.org.br', 'ana@x.citi.org.br', '', null, undefined]) {
      expect(emailPermitido(ruim)).toBe(false);
    }
  });

  it('hd só adiciona recusa: ausente passa, igual passa, diferente barra', () => {
    delete process.env.TAQCITI_DOMINIO_PERMITIDO;
    expect(dominioHospedadoDeFora(undefined)).toBe(false);
    expect(dominioHospedadoDeFora('citi.org.br')).toBe(false);
    expect(dominioHospedadoDeFora('CITI.org.br')).toBe(false);
    expect(dominioHospedadoDeFora('outra.org')).toBe(true);
  });

  it('a mensagem diz o domínio', () => {
    delete process.env.TAQCITI_DOMINIO_PERMITIDO;
    expect(mensagemDeRestricao()).toContain('@citi.org.br');
  });
});
