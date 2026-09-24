/**
 * A troca de provedor por ambiente — `LLM_PROVIDER` e `MOCK_LLM`.
 *
 * `AGENT_CONFIG` é resolvida na IMPORTAÇÃO do módulo, o que é o certo para o
 * servidor (a configuração não muda no meio de uma geração) e ruim para um
 * teste que queira variar o ambiente. Por isso o que se testa aqui são as
 * funções puras que decidem — `parseProviderAlias` e `mockPadrao`, esta última
 * recebendo o ambiente como parâmetro — e não a constante resolvida.
 */
import { describe, expect, it } from 'vitest';
import { mockPadrao, parseProviderAlias, parseOverride } from './config';

describe('o nome que se escreve na variável', () => {
  it('aceita o nome comercial', () => {
    expect(parseProviderAlias('claude', 'LLM_PROVIDER')).toBe('anthropic');
    expect(parseProviderAlias('gpt', 'LLM_PROVIDER')).toBe('openai');
  });

  it('aceita também o id interno, para quem já conhece a camada', () => {
    expect(parseProviderAlias('anthropic', 'LLM_PROVIDER')).toBe('anthropic');
    expect(parseProviderAlias('openai', 'LLM_PROVIDER')).toBe('openai');
    expect(parseProviderAlias('mock', 'LLM_PROVIDER')).toBe('mock');
  });

  it('ignora caixa e espaço em volta', () => {
    expect(parseProviderAlias('  Claude  ', 'LLM_PROVIDER')).toBe('anthropic');
  });

  it('recusa o desconhecido dizendo o que vale', () => {
    expect(() => parseProviderAlias('llama', 'LLM_PROVIDER')).toThrow(/claude, openai/);
  });
});

describe('o override por agente continua valendo', () => {
  it('entende provedor:modelo', () => {
    expect(parseOverride('openai:gpt-4.1-mini', 'DOCCITI_PENSANTE')).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini',
    });
    expect(parseOverride('mock:mock-1', 'DOCCITI_AUDITOR')).toEqual({
      provider: 'mock',
      model: 'mock-1',
    });
  });

  it('o erro de provedor desconhecido lista os novos', () => {
    expect(() => parseOverride('llama:3', 'DOCCITI_PENSANTE')).toThrow(/anthropic, openai/);
  });
});

describe('quando o mock assume sozinho', () => {
  it('assume fora de produção quando não há chave nenhuma', () => {
    expect(mockPadrao({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true);
  });

  /*
   * O caso que a regra ingênua ("mock sempre em dev") estragaria: quem TEM
   * chave e roda `next dev` está testando a geração de verdade, e receberia um
   * documento `[mock]` sem ter pedido.
   */
  it('não assume em dev quando existe chave configurada', () => {
    expect(
      mockPadrao({ NODE_ENV: 'development', GOOGLE_API_KEY: 'k' } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it('não assume quando o provedor foi escolhido à mão', () => {
    expect(
      mockPadrao({ NODE_ENV: 'development', LLM_PROVIDER: 'claude' } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it('nunca assume sozinho em produção', () => {
    expect(mockPadrao({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('MOCK_LLM=true força, inclusive em produção e com chave', () => {
    expect(
      mockPadrao({
        NODE_ENV: 'production',
        GOOGLE_API_KEY: 'k',
        MOCK_LLM: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it('MOCK_LLM só vale escrito true — nada de "1" ou "sim" ligando por acidente', () => {
    expect(
      mockPadrao({ NODE_ENV: 'production', GOOGLE_API_KEY: 'k', MOCK_LLM: '1' } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});
