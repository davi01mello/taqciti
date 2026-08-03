/**
 * O parser da próxima reunião — o item de maior risco da funcionalidade e o
 * mais barato de testar, porque é puro.
 *
 * Cada caso aqui existe porque a alternativa produz um agendamento
 * silenciosamente errado: data no passado, hora da madrugada, reunião marcada
 * para o dia em que a conversa está acontecendo.
 *
 * ÂNCORA de todos os testes: sexta-feira, 11 de setembro de 2026.
 */
import { describe, expect, it } from 'vitest';
import { detectNextMeeting } from './nextMeeting';

/** Sexta, 11/09/2026, meio-dia local — a data em que a "reunião" aconteceu. */
const ANCHOR = new Date('2026-09-11T12:00:00Z').getTime();
const TZ = 'America/Recife';

const falas = (...textos: string[]) => textos.map((text) => ({ text }));

const ler = (...textos: string[]) => detectNextMeeting(falas(...textos), ANCHOR, TZ);

describe('dias da semana', () => {
  it('resolve cada dia para a PRÓXIMA ocorrência depois da reunião', () => {
    // Âncora é sexta 11/09. Segunda seguinte = 14/09, e assim por diante.
    expect(ler('vamos marcar segunda').date).toBe('2026-09-14');
    expect(ler('vamos marcar terça').date).toBe('2026-09-15');
    expect(ler('vamos marcar quarta').date).toBe('2026-09-16');
    expect(ler('vamos marcar quinta').date).toBe('2026-09-17');
    expect(ler('vamos marcar sábado').date).toBe('2026-09-12');
    expect(ler('vamos marcar domingo').date).toBe('2026-09-13');
  });

  it('o dia da própria reunião cai na semana SEGUINTE', () => {
    // A âncora é sexta. Ninguém marca a próxima reunião para a sexta em que
    // ainda está conversando — "sexta" é a de daqui a uma semana.
    expect(ler('então fica pra sexta').date).toBe('2026-09-18');
  });

  it('aceita a forma com "-feira" e com preposição', () => {
    // Com contexto de agenda: um dia da semana solto é conversa comum e o
    // parser o ignora de propósito (ver "conversa comum NÃO vira agendamento").
    expect(ler('vamos marcar na terça-feira').date).toBe('2026-09-15');
    expect(ler('ficou pra quinta feira').date).toBe('2026-09-17');
  });

  it('"segunda que vem" é a segunda seguinte, não a de daqui a duas semanas', () => {
    // "Que vem" qualifica o DIA, não a semana: numa sexta, "segunda que vem" é
    // 14/09 para a maioria de quem fala. Empurrar uma semana aqui moveria a
    // data em silêncio com base numa distinção que os falantes não fazem de
    // forma confiável.
    expect(ler('segunda que vem').date).toBe('2026-09-14');
  });

  it('"da próxima semana" é explícito e aí sim empurra sete dias', () => {
    expect(ler('na terça da próxima semana').date).toBe('2026-09-22');
  });
});

describe('relativos', () => {
  it('hoje, amanhã e depois de amanhã', () => {
    // Com intenção de agendar na frase: sem ela, nenhuma data conta (ver
    // "conversa comum NÃO vira agendamento").
    expect(ler('vamos fechar hoje mesmo às 18h').date).toBe('2026-09-11');
    expect(ler('vamos marcar amanhã às 10h').date).toBe('2026-09-12');
    expect(ler('fica pra depois de amanhã às 10h').date).toBe('2026-09-13');
  });
});

describe('datas explícitas', () => {
  it('dd/mm resolve para a próxima ocorrência futura', () => {
    expect(ler('podemos apresentar a proposta dia 18/09').date).toBe('2026-09-18');
  });

  it('dd/mm que já passou no ano vai para o ano seguinte', () => {
    // 05/03 já passou em 11/09/2026 — a menção só pode ser de 2027.
    expect(ler('fica para 05/03').date).toBe('2027-03-05');
  });

  it('dd/mm/aaaa é usado como veio', () => {
    expect(ler('marcado para 20/01/2027').date).toBe('2027-01-20');
  });

  it('"18 de setembro" por extenso', () => {
    expect(ler('vamos marcar dia 18 de setembro').date).toBe('2026-09-18');
  });

  it('"dia 3" sozinho vira o próximo dia 3 — nunca um que já passou', () => {
    expect(ler('podemos conversar no dia 3 de outubro').date).toBe('2026-10-03');
  });

  it('data impossível não vira data', () => {
    expect(ler('o pedido 31/02 está travado').date).toBeNull();
  });
});

describe('horários', () => {
  it('formatos numéricos', () => {
    expect(ler('vamos marcar quinta às 15h').time).toBe('15:00');
    expect(ler('vamos marcar quinta às 15h30').time).toBe('15:30');
    expect(ler('vamos marcar quinta às 15:00').time).toBe('15:00');
    expect(ler('vamos marcar quinta às 9h').time).toBe('09:00');
  });

  it('por extenso', () => {
    expect(ler('vamos marcar quinta às nove').time).toBe('09:00');
    expect(ler('vamos marcar quinta às nove da manhã').time).toBe('09:00');
  });

  it('período da tarde e da noite convertem para 24h', () => {
    // Sem isto, "três da tarde" entra no calendário às 3 da manhã e alguém
    // perde a reunião.
    expect(ler('vamos marcar quinta às três da tarde').time).toBe('15:00');
    expect(ler('vamos marcar quinta às oito da noite').time).toBe('20:00');
  });

  it('meio-dia', () => {
    expect(ler('vamos marcar quinta meio-dia').time).toBe('12:00');
    expect(ler('vamos marcar quinta meio dia').time).toBe('12:00');
  });

  /*
   * Bug real: "16 horas" (dígito + palavra "horas" por extenso, sem
   * abreviar) não batia com nenhum dos dois padrões — nem o numérico
   * ("15h"/"15:00", que exige "h" OU ":" logo após o número) nem o por
   * extenso (que exige o número também escrito por extenso, "nove"). A hora
   * inteira era descartada em silêncio: a data preenchia sozinha, o campo
   * HORÁRIO ficava vazio, e ninguém saberia por quê.
   */
  it('dígito + "horas" por extenso', () => {
    expect(ler('vamos marcar quinta às 16 horas').time).toBe('16:00');
    expect(ler('vamos marcar quinta às 16 horas da tarde').time).toBe('16:00');
    expect(ler('vamos marcar quinta às 9 horas da manhã').time).toBe('09:00');
    expect(ler('vamos marcar quinta 1 hora da tarde').time).toBe('13:00');
  });
});

describe('confiança', () => {
  it('data, hora e verbo de confirmação dão status CONFIRMADA', () => {
    const h = ler('então ficou combinado, quinta às 14h, apresentação da proposta');
    expect(h.status).toBe('confirmada');
    expect(h.confidence).toBe('alta');
    expect(h.date).toBe('2026-09-17');
    expect(h.time).toBe('14:00');
    // Nada falta — mas a tela AINDA pede confirmação humana antes de agendar.
    expect(h.missing).toEqual([]);
    // O candidato coerente carrega tudo junto, inclusive o objetivo que a
    // própria frase disse.
    expect(h.candidate?.schedulingIntent).toBe(true);
    expect(h.candidate?.confirmed).toBe(true);
    expect(h.candidate?.objective).toBe('apresentacao_proposta');
    expect(h.candidate?.evidence.join(' ')).toContain('quinta às 14h');
  });

  it('sem verbo de confirmação fica PARCIAL, mesmo com data e hora', () => {
    // "A gente podia" não é "ficou combinado". A tela pede confirmação.
    expect(ler('a gente podia conversar na quinta às 14h').confidence).toBe('parcial');
  });

  it('hesitação derruba a confiança mesmo com tudo na frase', () => {
    const h = ler('talvez a gente feche na quinta às 14h');
    expect(h.status).toBe('parcial');
    expect(h.candidate?.hedged).toBe(true);
    // A data continua sendo lida: o que ela não é, é um compromisso.
    expect(h.date).toBe('2026-09-17');
    expect(h.missing).toContain('confirmacao');
  });

  it('só o dia, sem hora, fica PARCIAL — não chuta horário', () => {
    const h = ler('ficou combinado para quinta');
    expect(h.status).toBe('parcial');
    expect(h.date).toBe('2026-09-17');
    expect(h.time).toBeNull();
    // A tela pede exatamente o que falta, e só isso.
    expect(h.missing).toEqual(['hora']);
  });

  /*
   * COMPORTAMENTO ALTERADO NESTA VERSÃO, e de propósito.
   *
   * Antes, duas datas quaisquer marcavam conflito e prendiam o resultado em
   * `parcial` — inclusive quando a segunda era uma REMARCAÇÃO explícita. Era o
   * defeito espelho de "a última data manda": sem saber distinguir correção de
   * coincidência, o parser precisava desconfiar de tudo.
   *
   * "Na verdade" é uma correção inequívoca. A quinta é a verdade, a terça fica
   * gravada como substituída, e não há conflito nenhum a resolver. A tela ainda
   * pede confirmação humana antes de criar o evento — isso nunca dependeu deste
   * status.
   */
  it('uma correção explícita RESOLVE, em vez de virar conflito', () => {
    const h = ler('ficou combinado terça às 14h', 'na verdade vamos marcar quinta às 14h');
    expect(h.date).toBe('2026-09-17');
    expect(h.time).toBe('14:00');
    expect(h.status).toBe('confirmada');
    expect(h.candidate?.conflicting).toBe(false);
    // A terça não some: fica com estado e evidência, para a tela poder mostrar
    // "era terça, virou quinta".
    expect(h.superseded).toHaveLength(1);
    expect(h.superseded[0]?.date).toBe('2026-09-15');
    expect(h.superseded[0]?.state).toBe('substituida');
    expect(h.superseded[0]?.evidence.join(' ')).toContain('terça às 14h');
  });

  it('mas duas datas SEM correção continuam derrubando a confirmação', () => {
    // Nenhum sinal de remarcação: são dois assuntos, e ninguém decidiu. Aqui o
    // conflito é a resposta certa, e a primeira data continua de pé.
    const h = ler('podemos conversar na terça', 'a call de alinhamento é quinta');
    expect(h.status).toBe('parcial');
    expect(h.candidate?.conflicting).toBe(true);
    expect(h.missing).toContain('confirmacao');
    // A segunda data NÃO tomou o lugar da primeira só por ser mais recente.
    expect(h.date).toBe('2026-09-15');
  });
});

describe('a última menção manda', () => {
  it('remarcação no meio da conversa vence a primeira combinação', () => {
    const h = ler(
      'vamos marcar terça às 10h',
      'assunto sem data nenhuma aqui',
      'ficou combinado quinta às 16h',
    );
    expect(h.date).toBe('2026-09-17');
    expect(h.time).toBe('16:00');
  });

  it('data e hora ditas em falas separadas se combinam', () => {
    const h = ler('então fica pra quinta', 'ficou combinado, às 14h', 'obrigado pessoal');
    expect(h.date).toBe('2026-09-17');
    expect(h.time).toBe('14:00');
  });

  /*
   * O ESPELHO do teste acima: a hora vem primeiro ("pode ser às 15h?"), e a
   * data confirma depois ("quinta então, fechado"). Antes da correção do
   * merge(), esse padrão não fundia — a hora ficava perdida e só a data
   * aparecia na tela, mesmo com os dois tendo sido identificados.
   */
  it('hora dita ANTES da data também se combina', () => {
    const h = ler('então fica às 15h', 'ficou combinado, pra quinta', 'obrigado pessoal');
    expect(h.date).toBe('2026-09-17');
    expect(h.time).toBe('15:00');
  });

  it('hora antes da data não funde se uma hora nova aparecer no meio', () => {
    const h = ler(
      'então fica às 15h',
      'ah não, prefiro às 16h',
      'ficou combinado, pra quinta',
    );
    // A hora nova rompe o vínculo com a primeira — nada deve ser inventado
    // juntando a data à hora que já foi descartada.
    expect(h.time).not.toBe('15:00');
  });
});

describe('quando não há reunião nenhuma', () => {
  it('transcrição sem data devolve found: false', () => {
    const h = ler('a gente fecha o mês no escuro', 'o estoque real só é conhecido uma vez por mês');
    expect(h.found).toBe(false);
    expect(h.confidence).toBe('nenhuma');
    expect(h.date).toBeNull();
  });

  it('transcrição vazia não quebra', () => {
    expect(detectNextMeeting([], ANCHOR, TZ).found).toBe(false);
  });
});

describe('evidência e fuso', () => {
  it('guarda o trecho literal que sustenta a leitura', () => {
    const h = ler('bom, então ficou combinado quinta às 14h.');
    expect(h.evidence).toContain('quinta às 14h');
  });

  it('o fuso é o que foi declarado, nunca lido do texto', () => {
    // Nenhuma legenda do Meet diz fuso; inventá-lo seria adivinhação.
    expect(ler('quinta às 14h em Lisboa').timezone).toBe(TZ);
  });
});

describe('a âncora é a reunião, não o relógio', () => {
  it('a mesma transcrição sempre resolve para a mesma data', () => {
    // Reprocessar amanhã não pode mover o agendamento.
    const outraAncora = new Date('2026-09-18T12:00:00Z').getTime();
    expect(detectNextMeeting(falas('vamos marcar terça'), ANCHOR, TZ).date).toBe('2026-09-15');
    expect(detectNextMeeting(falas('vamos marcar terça'), outraAncora, TZ).date).toBe(
      '2026-09-22',
    );
  });
});

describe('conversa comum NÃO vira agendamento', () => {
  /**
   * O falso positivo que aparece em quase toda transcrição de diagnóstico:
   * "hoje" e dias da semana são vocabulário normal de quem descreve uma
   * operação. Sem o portão de contexto, cada reunião nasceria com uma data
   * inventada — e o pior tipo de erro é o que parece certo.
   */
  it('"quem confere as medições hoje" não é uma reunião', () => {
    expect(ler('Quem confere as medições hoje, o campo ou o financeiro?').found).toBe(false);
  });

  it('"como funciona hoje" não é uma reunião', () => {
    expect(ler('Como funciona hoje o controle de estoque entre as lojas?').found).toBe(false);
  });

  it('dia da semana descrevendo rotina não é uma reunião', () => {
    expect(ler('A gente fecha o inventário toda sexta.').found).toBe(false);
  });

  it('mas a mesma data COM contexto de agenda conta', () => {
    expect(ler('Então vamos marcar para sexta.').found).toBe(true);
    expect(ler('Fica pra quinta, então.').found).toBe(true);
  });

  /*
   * REGRA INVERTIDA nesta versão, e é a mudança mais importante do detector.
   *
   * Antes um horário valia sozinho, "porque ninguém diz às 14h sem marcar algo".
   * Mas dizem: "trabalhamos das 8h às 18h", "o processo demora 2h", "o SLA é de
   * 24h". A exceção era a origem dos falsos positivos que mais custam, porque
   * produzem um evento no calendário de alguém.
   */
  it('horário sozinho NÃO prova reunião', () => {
    expect(ler('Quinta às 14h.').found).toBe(false);
  });

  it('data de calendário sozinha NÃO prova reunião', () => {
    expect(ler('O documento é de 18/09.').found).toBe(false);
  });

  it('mas as duas COM intenção de agendar contam', () => {
    const h = ler('Vamos marcar quinta às 14h.');
    expect(h.found).toBe(true);
    expect(h.time).toBe('14:00');
    expect(h.date).toBe('2026-09-17');
  });

  it('a transcrição de diagnóstico do exemplo não produz reunião nenhuma', () => {
    // Exatamente as falas da bancada visual, que expuseram o defeito.
    const h = ler(
      'A gente fecha o mês no escuro e só descobre o prejuízo depois.',
      'Quem confere as medições hoje, o campo ou o financeiro?',
      'Os dois, e é aí que mora o retrabalho.',
      'Entendi. E o fechamento leva quanto tempo depois que as medições chegam?',
    );
    expect(h.found).toBe(false);
  });
});

/**
 * A LISTA que a especificação cobra, caso por caso.
 *
 * Cada frase aqui apareceu (ou apareceria) numa transcrição comercial real e
 * NÃO é um agendamento. O custo de errar aqui não é uma tela feia: é um evento
 * no calendário de alguém, para uma reunião que ninguém marcou.
 */
describe('o que NUNCA pode virar reunião', () => {
  const naoAgenda = (frase: string) => {
    const h = ler(frase);
    expect(h.found, `virou reunião: "${frase}"`).toBe(false);
    expect(h.status).toBe('nao_definida');
    expect(h.date).toBeNull();
    expect(h.time).toBeNull();
  };

  it('data histórica', () => {
    naoAgenda('O cliente abriu a empresa em 2019.');
    naoAgenda('A gente é parceiro deles desde 2021.');
  });

  it('data de vencimento', () => {
    naoAgenda('O contrato vence dia 18/10.');
    naoAgenda('A fatura venceu 05/09 e ninguém viu.');
    naoAgenda('A validade do certificado é 30/11.');
  });

  it('prazo de entrega', () => {
    naoAgenda('A entrega está prevista para 15/12.');
    naoAgenda('O prazo do fornecedor é terça.');
  });

  it('horário comercial', () => {
    naoAgenda('Trabalhamos das 8h às 18h.');
    naoAgenda('O expediente vai de 9h às 17h.');
  });

  it('rotina semanal', () => {
    naoAgenda('O fechamento acontece toda sexta.');
    naoAgenda('A gente fecha o inventário todo dia 5.');
    naoAgenda('Sempre conversamos na segunda de manhã sobre isso.');
  });

  it('feriado', () => {
    naoAgenda('Dia 12/10 é feriado, ninguém trabalha.');
    naoAgenda('Na semana do carnaval a operação para.');
  });

  it('aniversário', () => {
    naoAgenda('O aniversário da loja é 18/09.');
  });

  it('duração, não horário', () => {
    naoAgenda('Hoje o processo demora duas horas.');
    naoAgenda('O fechamento leva 3h depois que as medições chegam.');
  });

  it('data isolada, sem intenção de agendar', () => {
    naoAgenda('O documento é de 18/09.');
    naoAgenda('Isso foi 05/03.');
  });

  it('horário isolado, sem intenção de agendar', () => {
    naoAgenda('O turno começa às 6h.');
    naoAgenda('O relatório sai às 23h.');
  });

  /*
   * O caso que a versão anterior errava de forma mais grave: data e horário de
   * CONTEXTOS DIFERENTES eram combinados num compromisso que ninguém marcou.
   */
  it('data e hora desconectadas NÃO se combinam num compromisso', () => {
    const h = ler(
      'O contrato vence 18/09, então precisamos resolver antes.',
      'A operação roda das 8h às 18h todos os dias.',
      'Bom, obrigado pelo tempo.',
    );
    expect(h.found).toBe(false);
  });

  it('uma reunião real no fim NÃO herda a data de um vencimento no começo', () => {
    const h = ler(
      'O contrato vence 18/09.',
      'Muita coisa pra resolver até lá.',
      'Vamos marcar uma conversa quinta, então.',
    );
    // A data é da CONVERSA (quinta = 17/09), não do vencimento (18/09).
    expect(h.date).toBe('2026-09-17');
    expect(h.time).toBeNull();
    expect(h.candidate?.evidence.join(' ')).toContain('quinta');
    expect(h.candidate?.evidence.join(' ')).not.toContain('vence');
  });

  it('"talvez" não fecha nada', () => {
    const h = ler('Talvez a gente consiga conversar na quinta às 14h.');
    expect(h.status).toBe('parcial');
    expect(h.candidate?.hedged).toBe(true);
  });

  it('duas alternativas na mesma frase não fecham nada', () => {
    const h = ler('Podemos marcar terça ou quinta, o que for melhor pra vocês.');
    expect(h.status).toBe('parcial');
    expect(h.missing).toContain('confirmacao');
  });

  it('data no PASSADO não vira compromisso confirmado', () => {
    // 05/03 já passou em relação à âncora: resolve para 2027, mas se alguém
    // disser a data com ano explícito no passado, `isFuture` recusa a
    // confirmação em vez de agendar para trás.
    const h = ler('ficou combinado, vamos marcar 05/03/2026 às 14h');
    expect(h.status).toBe('parcial');
    expect(h.missing).toContain('confirmacao');
  });
});

describe('os candidatos são unidades coerentes', () => {
  /*
   * O defeito estrutural da versão anterior: `confirmed` era
   * `mentions.some(...)`, então um "fechado" em qualquer lugar da conversa
   * marcava como confirmada uma data dita em outro contexto.
   */
  it('a confirmação de um candidato NÃO valida outro', () => {
    const h = ler(
      'Fechado, então, o escopo está aprovado.',
      'Sobre a próxima, podemos conversar quinta.',
    );
    expect(h.date).toBe('2026-09-17');
    // "Fechado" era de outra frase, sobre outro assunto: não confirma esta.
    expect(h.status).toBe('parcial');
    expect(h.candidate?.confirmed).toBe(false);
  });

  it('data e hora em falas adjacentes do MESMO agendamento se fundem', () => {
    const h = ler('então fica pra quinta', 'ficou combinado, às 14h', 'obrigado pessoal');
    expect(h.date).toBe('2026-09-17');
    expect(h.time).toBe('14:00');
    expect(h.status).toBe('confirmada');
    // A evidência guarda as DUAS falas: o fato tem as duas origens.
    expect(h.candidate?.evidence).toHaveLength(2);
  });

  it('a hora vai para a data CORRIGIDA, nunca para a que foi substituída', () => {
    const h = ler(
      'fica pra quinta',
      'na verdade vamos marcar sexta',
      'ficou combinado, às 14h',
    );
    /*
     * O ponto do teste: as 14h pertencem à SEXTA, não à quinta. A proteção da
     * fusão (uma data nova no meio rompe o vínculo) continua valendo — o que
     * mudou é que a correção agora resolve em vez de envenenar o resultado.
     */
    expect(h.date).toBe('2026-09-18');
    expect(h.time).toBe('14:00');
    expect(h.status).toBe('confirmada');
    expect(h.candidate?.conflicting).toBe(false);
    expect(h.superseded[0]?.date).toBe('2026-09-17');
  });

  it('não se fundem quando estão longe demais na conversa', () => {
    const h = ler(
      'vamos marcar quinta',
      'assunto um',
      'assunto dois',
      'assunto três',
      'a call é às 14h',
    );
    // Quatro falas de distância não é continuidade: a hora não é fundida.
    expect(h.date).toBe('2026-09-17');
    expect(h.time).toBeNull();
  });
});
