/**
 * Os dois casos canônicos da especificação, contra a API DE VERDADE.
 *
 *   "Acho que deveríamos adiar a entrega."      → não é decisão. Rejeitar.
 *   "Então fechamos o adiamento para sexta."    → decisão confirmada. Aceitar.
 *
 * Se o Auditor não separar esses dois, ele não está funcionando — e nenhum
 * teste com modelo mockado descobre isso, porque o mock responde o que
 * mandamos responder.
 *
 * Fica FORA do `npm test` de propósito: gasta token, depende de rede e de
 * chave. `npm run test:live` roda. Sem chave, os casos aparecem como
 * SKIPPED na saída — visível, em vez de silenciosamente ausente.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/** Vitest não lê `.env.local` (isso é do Next). Carrega à mão. */
function loadEnvLocal(): void {
  const path = join(process.cwd(), '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (value!.trim() && !process.env[key!]) process.env[key!] = value!.trim();
  }
}

loadEnvLocal();

const LIVE = process.env.DOCCITI_LIVE_TESTS === '1' && Boolean(process.env.GOOGLE_API_KEY?.trim());

/**
 * A proposta e a decisão precisam ficar LONGE uma da outra.
 *
 * Na primeira versão deste fixture elas estavam a ~150 caracteres de
 * distância, e a folga de 400 do Auditor recortava as duas juntas. O modelo
 * então aprovava a afirmação — corretamente, porque o trecho que ele recebeu
 * continha mesmo a decisão. O teste não estava medindo discriminação; estava
 * medindo o tamanho da folga.
 *
 * Numa reunião real a proposta e o fechamento ficam separados por minutos de
 * conversa, e é esse o caso que importa reproduzir.
 */
const conversaIntermediaria = [
  'Carlos: Antes disso, precisamos entender o impacto no time de dados.',
  'Ana: O time de dados depende da API de importação, que ainda não está estável.',
  'Carlos: E a documentação que o cliente mandou está desatualizada em três endpoints.',
  'Ana: Isso explica o retrabalho da semana passada.',
  'Carlos: Precisamos também revisar os testes de carga antes de qualquer coisa.',
  'Ana: Os testes de carga rodaram ontem e apontaram gargalo no banco.',
  'Carlos: Então temos duas frentes abertas, integração e desempenho.',
  'Ana: Sugiro tratar as duas em paralelo, com pessoas diferentes.',
  'Carlos: Faz sentido. Vou levantar quem está disponível.',
  'Ana: Enquanto isso eu falo com o cliente sobre a documentação.',
].join('\n');

const transcript = [
  'Carlos: Sobre o cronograma, a integração atrasou por causa da documentação.',
  'Ana: Acho que deveríamos adiar a entrega.',
  conversaIntermediaria,
  'Carlos: Revisamos o impacto e o cliente está de acordo.',
  'Ana: Então fechamos o adiamento para sexta-feira.',
  'Carlos: Fechado.',
].join('\n');

describe.skipIf(!LIVE)('Auditor — casos canônicos (rede)', () => {
  let auditar: typeof import('./auditor').auditar;
  let statements: import('../compactedContext').CompactedStatement[];

  beforeAll(async () => {
    ({ auditar } = await import('./auditor'));
    const { createLocator } = await import('./anchoring');
    const locator = createLocator(transcript);

    const make = (id: string, quote: string, text: string) => ({
      id,
      text,
      quote,
      anchor: createLocator(transcript).locate(quote),
      kind: 'argument' as const,
    });
    void locator;

    statements = [
      make('st-proposta', 'Acho que deveríamos adiar a entrega.', 'Ana propôs adiar a entrega.'),
      make(
        'st-decisao',
        'Então fechamos o adiamento para sexta-feira.',
        'A equipe fechou o adiamento da entrega para sexta-feira.',
      ),
    ];

    // Se a âncora não localizar, o teste mediria outra coisa.
    for (const s of statements) expect(s.anchor, s.id).not.toBeNull();

    // E a distância entre proposta e decisão precisa ser maior que a folga,
    // senão o trecho da proposta alcança a decisão e o caso deixa de
    // discriminar. Esta asserção é o que impede o fixture de apodrecer.
    const { EXCERPT_PADDING_CHARS } = await import('./auditor');
    const distancia = statements[1]!.anchor!.start - statements[0]!.anchor!.end;
    expect(distancia).toBeGreaterThan(EXCERPT_PADDING_CHARS);
  });

  it('REJEITA proposta apresentada como decisão', async () => {
    const { verdicts } = await auditar({
      claims: [
        {
          path: 'decisions[0]',
          text: 'Foi DECIDIDO na reunião: Adiar a entrega.',
          statementIds: ['st-proposta'],
        },
      ],
      statements,
      transcript,
    });

    expect(verdicts[0]!.supported, `justificativa: ${verdicts[0]!.reason}`).toBe(false);
  }, 120_000);

  it('ACEITA decisão de fato tomada', async () => {
    const { verdicts } = await auditar({
      claims: [
        {
          path: 'decisions[0]',
          text: 'Foi DECIDIDO na reunião: Adiar a entrega para sexta-feira.',
          statementIds: ['st-decisao'],
        },
      ],
      statements,
      transcript,
    });

    expect(verdicts[0]!.supported, `justificativa: ${verdicts[0]!.reason}`).toBe(true);
  }, 120_000);

  it('REJEITA cargo que o trecho não mostra', async () => {
    // A outra metade das seções `strict`: cargo inventado é o erro que a Ata
    // mais precisa evitar.
    const { verdicts } = await auditar({
      claims: [
        {
          path: 'participants[0]',
          text: 'Carlos participou da reunião e tem o cargo/papel de Gerente de Projetos.',
          statementIds: ['st-proposta'],
        },
      ],
      statements,
      transcript,
    });

    expect(verdicts[0]!.supported, `justificativa: ${verdicts[0]!.reason}`).toBe(false);
  }, 120_000);
});
