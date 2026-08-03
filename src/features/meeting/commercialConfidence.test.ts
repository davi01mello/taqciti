import { describe, expect, it } from 'vitest';
import { computeCommercialConfidence } from './commercialConfidence';

function transcript(...texts: string[]) {
  return texts.map((text) => ({ text }));
}

describe('commercialConfidence', () => {
  it('transcript vazio → 0', () => {
    expect(computeCommercialConfidence([])).toBe(0);
    expect(computeCommercialConfidence(transcript('   '))).toBe(0);
  });

  it('conversa casual → confiança baixa', () => {
    const score = computeCommercialConfidence(
      transcript(
        'e aí pessoal, tudo bem com vocês?',
        'assistiu o jogo ontem? foi incrível',
        'bora marcar um almoço qualquer dia',
      ),
    );
    expect(score).toBeLessThan(0.3);
  });

  it('vocabulário comercial forte → confiança alta', () => {
    const score = computeCommercialConfidence(
      transcript(
        'vamos fechar a proposta comercial com o orçamento revisado',
        'o contrato prevê pagamento em três parcelas',
        'o escopo do projeto e o prazo de entrega ficaram definidos',
        'o investimento total inclui desconto para o cliente',
      ),
    );
    expect(score).toBeGreaterThan(0.6);
  });

  it('acentos não escondem palavras-chave', () => {
    const withAccents = computeCommercialConfidence(transcript('orçamento e preço'));
    const withoutAccents = computeCommercialConfidence(transcript('orcamento e preco'));
    expect(withAccents).toBeCloseTo(withoutAccents, 5);
  });

  it('mais sinais nunca diminuem a confiança (monotônica)', () => {
    const fewer = computeCommercialConfidence(transcript('temos uma proposta'));
    const more = computeCommercialConfidence(
      transcript('temos uma proposta', 'com orçamento e contrato definidos'),
    );
    expect(more).toBeGreaterThanOrEqual(fewer);
  });

  it('repetição satura: spam de uma palavra não vale mais que vocabulário variado', () => {
    const spam = computeCommercialConfidence(
      transcript(Array(50).fill('proposta').join(' ')),
    );
    const varied = computeCommercialConfidence(
      transcript('proposta orçamento contrato precificação comercial fechamento'),
    );
    expect(varied).toBeGreaterThan(spam);
  });

  it('resultado sempre em [0, 1]', () => {
    const extreme = computeCommercialConfidence(
      transcript(
        Array(30)
          .fill(
            'proposta orçamento contrato preço valor investimento escopo prazo entrega pagamento desconto custo projeto cliente',
          )
          .join(' '),
      ),
    );
    expect(extreme).toBeGreaterThan(0.9);
    expect(extreme).toBeLessThanOrEqual(1);
  });
});
