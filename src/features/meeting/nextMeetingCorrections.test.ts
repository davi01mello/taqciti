/**
 * CORREÇÕES, REMARCAÇÕES E CANCELAMENTOS — a matriz que a especificação cobra.
 *
 * O arquivo irmão (`nextMeeting.test.ts`) prova que datas irrelevantes não
 * viram reunião. Este prova a outra metade: quando a conversa MUDA de ideia, o
 * sistema tem que seguir a mudança certa — e só a mudança certa.
 *
 * O defeito que estes testes existem para impedir é específico: a versão
 * anterior escolhia "a última data falada", então qualquer número dito depois
 * substituía um compromisso real; e, quando havia remarcação de verdade, dois
 * candidatos com datas diferentes travavam o resultado em `parcial` para sempre.
 *
 * ÂNCORA de todos os testes: sexta-feira, 11 de setembro de 2026.
 */
import { describe, expect, it } from 'vitest';
import { detectNextMeeting } from './nextMeeting';

/** Sexta, 11/09/2026 — 09:00 em Recife (12:00Z). */
const ANCHOR = new Date('2026-09-11T12:00:00Z').getTime();
const TZ = 'America/Recife';

const falas = (...textos: string[]) => textos.map((text) => ({ text }));
const ler = (...textos: string[]) => detectNextMeeting(falas(...textos), ANCHOR, TZ);

describe('correção de DATA', () => {
  it('"esquece terça, fica quarta" remarca para a quarta — nunca para a terça', () => {
    /*
     * O caso que expôs o defeito de leitura: as duas datas estão na MESMA frase,
     * e `String.match` devolvia a primeira — exatamente a que acabou de ser
     * descartada. O sistema remarcaria para o dia abandonado, com confiança.
     */
    const h = ler('ficou combinado terça às 14h', 'esquece terça, fica quarta');
    expect(h.date).toBe('2026-09-16');
    // Correção só de data mantém a hora que já estava combinada.
    expect(h.time).toBe('14:00');
    expect(h.status).toBe('confirmada');
    expect(h.superseded[0]?.date).toBe('2026-09-15');
    expect(h.superseded[0]?.state).toBe('substituida');
  });

  it('"na verdade, melhor quinta" troca a data e preserva a evidência antiga', () => {
    const h = ler('vamos marcar terça às 10h', 'na verdade, melhor quinta');
    expect(h.date).toBe('2026-09-17');
    expect(h.time).toBe('10:00');
    expect(h.superseded).toHaveLength(1);
    expect(h.superseded[0]?.evidence.join(' ')).toContain('terça às 10h');
  });

  it('"muda para sexta" remarca', () => {
    const h = ler('ficou combinado quarta às 15h', 'muda para sexta');
    expect(h.date).toBe('2026-09-18');
    expect(h.time).toBe('15:00');
  });

  it('"remarca para dia 25/09" remarca para a data explícita', () => {
    const h = ler('ficou combinado quinta às 16h', 'remarca para 25/09');
    expect(h.date).toBe('2026-09-25');
    expect(h.time).toBe('16:00');
  });

  it('"em vez de terça, quarta" pega a segunda data', () => {
    const h = ler('vamos marcar terça às 9h', 'em vez de terça, quarta');
    expect(h.date).toBe('2026-09-16');
  });
});

describe('correção SOMENTE de horário', () => {
  it('"na verdade melhor às 16h" muda a hora e mantém o dia', () => {
    const h = ler('ficou combinado quinta às 14h', 'na verdade melhor às 16h');
    expect(h.date).toBe('2026-09-17');
    expect(h.time).toBe('16:00');
    expect(h.status).toBe('confirmada');
  });

  it('"muda para as 11h" mantém o dia combinado', () => {
    const h = ler('ficou combinado terça às 15h', 'muda para as 11h');
    expect(h.date).toBe('2026-09-15');
    expect(h.time).toBe('11:00');
  });

  it('a correção de hora não arrasta a data para outro dia', () => {
    const h = ler('vamos marcar dia 18/09 às 10h', 'na verdade melhor às 14h');
    expect(h.date).toBe('2026-09-18');
    expect(h.time).toBe('14:00');
  });
});

describe('correção de DATA E HORÁRIO juntos', () => {
  it('"esquece terça, fica quarta às 16h" troca os dois', () => {
    const h = ler('ficou combinado terça às 14h', 'esquece terça, fica quarta às 16h');
    expect(h.date).toBe('2026-09-16');
    expect(h.time).toBe('16:00');
    expect(h.status).toBe('confirmada');
    expect(h.superseded[0]?.date).toBe('2026-09-15');
  });

  it('duas remarcações em sequência: vale a última, e as duas anteriores ficam', () => {
    const h = ler(
      'ficou combinado terça às 14h',
      'na verdade quarta às 15h',
      'desculpa, muda para sexta às 9h',
    );
    expect(h.date).toBe('2026-09-18');
    expect(h.time).toBe('09:00');
    expect(h.superseded).toHaveLength(2);
    expect(h.superseded.map((c) => c.date)).toEqual(['2026-09-15', '2026-09-16']);
  });
});

describe('a correção precisa ser explícita', () => {
  /*
   * A regra que o enunciado cobra: a informação mais recente só vence quando é
   * confirmação, correção ou remarcação — nunca por ser a última data dita.
   */
  it('uma data solta depois NÃO substitui um compromisso combinado', () => {
    const h = ler(
      'ficou combinado quinta às 14h',
      'ah, e o pessoal de vocês costuma conversar na segunda',
    );
    // A segunda é conversa sobre a rotina deles, não uma remarcação.
    expect(h.date).toBe('2026-09-17');
    expect(h.time).toBe('14:00');
  });

  it('duas propostas sem correção não escolhem sozinhas', () => {
    const h = ler('podemos conversar na terça', 'ou a call pode ser na quinta');
    expect(h.candidate?.conflicting).toBe(true);
    expect(h.status).toBe('parcial');
    expect(h.missing).toContain('confirmacao');
  });
});

describe('cancelamento', () => {
  it('"cancelamos" desmarca o que estava combinado', () => {
    const h = ler('ficou combinado quinta às 14h', 'olha, vamos cancelar essa reunião');
    expect(h.status).toBe('cancelada');
    expect(h.date).toBeNull();
    expect(h.time).toBeNull();
    expect(h.found).toBe(false);
    // A data fica no candidato: é por ela que o motor sabe QUAL evento cancelar.
    expect(h.candidate?.date).toBe('2026-09-17');
    expect(h.candidate?.state).toBe('cancelada');
  });

  it('"desmarca" também desmarca', () => {
    const h = ler('ficou combinado terça às 10h', 'precisamos desmarcar a call de terça');
    expect(h.status).toBe('cancelada');
  });

  it('cancelar algo ANTES de marcar não desmarca a reunião nova', () => {
    const h = ler(
      'a gente cancelou a conversa da semana passada',
      'vamos marcar quinta às 14h então',
    );
    expect(h.status).toBe('confirmada');
    expect(h.date).toBe('2026-09-17');
  });

  it('cancelar um CONTRATO não cancela a reunião', () => {
    // O veto de contexto tem que valer aqui também: "cancelamos o contrato" é
    // um fato da operação do cliente.
    const h = ler('ficou combinado quinta às 14h', 'eles cancelaram o contrato de manutenção');
    expect(h.status).toBe('confirmada');
    expect(h.date).toBe('2026-09-17');
  });
});

describe('indefinição dita em voz alta', () => {
  it('"ainda não definimos" devolve nao_definida, não a última data que passou', () => {
    const h = ler(
      'podemos conversar na quinta',
      'na real ainda não definimos a data, deixa eu ver com o time',
    );
    expect(h.status).toBe('nao_definida');
    expect(h.date).toBeNull();
    // A evidência do que foi discutido continua disponível para a tela.
    expect(h.candidate?.date).toBe('2026-09-17');
  });

  it('"depois a gente marca" é adiamento, não agendamento', () => {
    const h = ler('vamos marcar uma conversa na terça', 'depois a gente combina direitinho');
    expect(h.status).toBe('nao_definida');
  });

  it('"te confirmo depois" não fecha compromisso', () => {
    const h = ler('vamos marcar quinta às 14h', 'te confirmo depois, tá?');
    expect(h.status).toBe('nao_definida');
  });
});

describe('alternativas e hesitação continuam sem fechar nada', () => {
  it('"terça ou quinta" fica parcial', () => {
    const h = ler('podemos marcar terça ou quinta às 14h');
    expect(h.status).toBe('parcial');
    expect(h.candidate?.alternatives).toBe(true);
    expect(h.missing).toContain('confirmacao');
  });

  it('"talvez" derruba mesmo depois de uma correção', () => {
    const h = ler('ficou combinado terça às 14h', 'na verdade talvez quinta seja melhor');
    expect(h.date).toBe('2026-09-17');
    expect(h.status).toBe('parcial');
    expect(h.candidate?.hedged).toBe(true);
  });
});

describe('virada de mês, de ano e fuso', () => {
  it('remarcação atravessa a virada de mês', () => {
    // Âncora 30/09/2026 (quarta). "Quinta" é 01/10.
    const anchor = new Date('2026-09-30T12:00:00Z').getTime();
    const h = detectNextMeeting(falas('ficou combinado quinta às 14h'), anchor, TZ);
    expect(h.date).toBe('2026-10-01');
  });

  it('remarcação atravessa a virada de ano', () => {
    // Âncora 30/12/2026 (quarta). "Sexta" é 01/01/2027.
    const anchor = new Date('2026-12-30T12:00:00Z').getTime();
    const h = detectNextMeeting(falas('ficou combinado sexta às 10h'), anchor, TZ);
    expect(h.date).toBe('2027-01-01');
  });

  it('"dia 5" dito em dezembro cai em janeiro do ano seguinte', () => {
    const anchor = new Date('2026-12-20T12:00:00Z').getTime();
    const h = detectNextMeeting(falas('vamos marcar dia 5 de janeiro às 10h'), anchor, TZ);
    expect(h.date).toBe('2027-01-05');
  });

  /*
   * O DEFEITO DE FUSO, provado. A reunião acontece às 22h de 17/09 em Recife —
   * que em UTC já é 01h de 18/09. A versão anterior lia o dia com
   * `new Date(ms).getDate()`, o fuso do processo: no backend em UTC a âncora
   * virava 18/09 e "amanhã" resolvia para 19 em vez de 18.
   */
  it('a âncora é o dia LOCAL da reunião, não o dia em UTC', () => {
    const anchor = new Date('2026-09-18T01:00:00Z').getTime(); // 17/09 22h em Recife
    const h = detectNextMeeting(falas('vamos marcar amanhã às 10h'), anchor, 'America/Recife');
    expect(h.date).toBe('2026-09-18');
  });

  it('a mesma transcrição dá a mesma data em qualquer fuso de execução', () => {
    // O contrato de determinismo: o resultado depende do fuso DA REUNIÃO, que
    // viaja com ela — nunca do fuso de quem está processando.
    const anchor = new Date('2026-09-18T01:00:00Z').getTime();
    const recife = detectNextMeeting(falas('vamos marcar amanhã às 10h'), anchor, 'America/Recife');
    const utc = detectNextMeeting(falas('vamos marcar amanhã às 10h'), anchor, 'UTC');
    // Fusos diferentes, dias locais diferentes — e cada um coerente com o seu.
    expect(recife.date).toBe('2026-09-18');
    expect(utc.date).toBe('2026-09-19');
  });

  it('resolve "terça" contra o dia local mesmo na virada de fuso', () => {
    const anchor = new Date('2026-09-18T01:00:00Z').getTime(); // sexta 17/09 em Recife? (17 é quinta)
    // 17/09/2026 é quinta. "Terça" seguinte = 22/09.
    const h = detectNextMeeting(falas('vamos marcar terça às 10h'), anchor, 'America/Recife');
    expect(h.date).toBe('2026-09-22');
  });
});

describe('transcrição em andamento', () => {
  /*
   * O painel roda o analisador a cada legenda nova. A hipótese precisa evoluir
   * de forma monotônica e coerente — nunca oscilar entre datas conforme a
   * conversa cresce.
   */
  const conversa = [
    'obrigado pelo tempo de vocês hoje',
    'o contrato de vocês vence 18/10',
    'vamos marcar uma conversa na terça',
    'ficou combinado, às 14h',
    'na verdade, esquece terça, fica quarta às 16h',
  ];

  it('evolui de nao_definida até o compromisso final, sem inventar no caminho', () => {
    const passo = (n: number) => detectNextMeeting(falas(...conversa.slice(0, n)), ANCHOR, TZ);

    // Só cortesia: nada.
    expect(passo(1).status).toBe('nao_definida');
    // Vencimento de contrato: continua nada — é o veto funcionando.
    expect(passo(2).status).toBe('nao_definida');
    // Proposta sem hora: parcial, e pede a hora.
    expect(passo(3).status).toBe('parcial');
    expect(passo(3).date).toBe('2026-09-15');
    expect(passo(3).missing).toContain('hora');
    // Hora combinada: fecha.
    expect(passo(4).status).toBe('confirmada');
    expect(passo(4).time).toBe('14:00');
    // Remarcação: segue a correção.
    expect(passo(5).date).toBe('2026-09-16');
    expect(passo(5).time).toBe('16:00');
    expect(passo(5).status).toBe('confirmada');
  });

  it('reprocessar a transcrição inteira dá o mesmo resultado do incremento', () => {
    const incremental = detectNextMeeting(falas(...conversa), ANCHOR, TZ);
    const doZero = detectNextMeeting(falas(...conversa), ANCHOR, TZ);
    expect(incremental).toEqual(doZero);
    // E a data do vencimento (18/10) nunca aparece como reunião.
    expect(incremental.date).not.toBe('2026-10-18');
  });
});

describe('estados do domínio', () => {
  it('todo resultado tem um dos cinco estados públicos', () => {
    const permitidos = ['proposta', 'confirmada', 'parcial', 'cancelada', 'nao_definida'];
    const casos = [
      ler('nada de datas por aqui'),
      ler('vamos marcar quinta'),
      ler('ficou combinado quinta às 14h'),
      ler('ficou combinado quinta às 14h', 'vamos cancelar'),
      ler('vamos marcar quinta', 'ainda não definimos nada'),
    ];
    for (const caso of casos) {
      expect(permitidos).toContain(caso.status);
      // `substituida` é estado de candidato, nunca de resultado.
      expect(caso.status).not.toBe('substituida');
    }
  });

  it('candidatos substituídos guardam ordem e evidência', () => {
    const h = ler('vamos marcar terça às 14h', 'na verdade quinta às 16h');
    expect(h.superseded[0]?.order).toBeLessThan(h.candidate?.order ?? Infinity);
    expect(h.candidate?.supersedes).toBe(h.superseded[0]?.id);
  });
});
