/**
 * O motor temporal. Os casos aqui são exatamente os que quebravam antes:
 * dia deslocado por fuso, horário de verão, virada de mês e de ano.
 *
 * Nenhum teste usa `Date.now()`: uma suíte que depende de quando roda não prova
 * nada sobre determinismo, que é justamente o que este módulo existe para dar.
 */
import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildTemporalContext,
  civilFromIso,
  civilToInstant,
  civilToIso,
  daysBetween,
  formatOffset,
  instantToRfc3339,
  isRealDate,
  isValidTimezone,
  localDayOf,
  localTimeOf,
  offsetMinutesAt,
  timeFromIso,
  toRfc3339,
  weekdayOf,
} from './temporal.js';

describe('localDayOf — o dia local, não o dia do processo', () => {
  it('não desloca o dia quando o instante em UTC já virou', () => {
    // 22h de 17/09 em Recife (UTC−3) é 01h de 18/09 em UTC. O dia da reunião,
    // para quem estava nela, é 17 — e era isto que o código antigo errava.
    const instante = Date.UTC(2026, 8, 18, 1, 0);
    expect(localDayOf(instante, 'America/Recife')).toBe('2026-09-17');
    expect(localTimeOf(instante, 'America/Recife')).toBe('22:00');
  });

  it('devolve o dia UTC quando o fuso é UTC', () => {
    expect(localDayOf(Date.UTC(2026, 8, 18, 1, 0), 'UTC')).toBe('2026-09-18');
  });

  it('atravessa a virada de ano no fuso local', () => {
    // 21h de 31/12/2026 em São Paulo é 00h de 01/01/2027 em UTC.
    const instante = Date.UTC(2027, 0, 1, 0, 30);
    expect(localDayOf(instante, 'America/Sao_Paulo')).toBe('2026-12-31');
    expect(localDayOf(instante, 'UTC')).toBe('2027-01-01');
  });

  it('anda para a frente em fuso a leste de Greenwich', () => {
    // 23h UTC é 08h do dia seguinte em Tóquio (UTC+9).
    expect(localDayOf(Date.UTC(2026, 8, 17, 23, 0), 'Asia/Tokyo')).toBe('2026-09-18');
  });
});

describe('offsetMinutesAt', () => {
  it('lê o offset do Brasil', () => {
    expect(offsetMinutesAt(Date.UTC(2026, 8, 18, 15, 0), 'America/Recife')).toBe(-180);
  });

  it('lê offset positivo a leste', () => {
    expect(offsetMinutesAt(Date.UTC(2026, 8, 18, 15, 0), 'Asia/Tokyo')).toBe(540);
  });

  it('trata fuso inválido como UTC em vez de explodir', () => {
    expect(offsetMinutesAt(Date.UTC(2026, 8, 18, 15, 0), 'Nao/Existe')).toBe(0);
  });
});

describe('civilToInstant — horário de verão', () => {
  it('acerta o offset ANTES da virada de verão em Nova York', () => {
    // 08/03/2026, 01:00 — ainda EST (−05:00).
    const instante = civilToInstant({ year: 2026, month: 3, day: 8 }, { hour: 1, minute: 0 }, 'America/New_York');
    expect(offsetMinutesAt(instante, 'America/New_York')).toBe(-300);
    expect(localTimeOf(instante, 'America/New_York')).toBe('01:00');
  });

  it('acerta o offset DEPOIS da virada de verão em Nova York', () => {
    // Mesmo dia, 15:00 — já EDT (−04:00). É a segunda passada que corrige isto:
    // resolver o offset "de hoje" e aplicá-lo à tarde poria a reunião 1h fora.
    const instante = civilToInstant({ year: 2026, month: 3, day: 8 }, { hour: 15, minute: 0 }, 'America/New_York');
    expect(offsetMinutesAt(instante, 'America/New_York')).toBe(-240);
    expect(localTimeOf(instante, 'America/New_York')).toBe('15:00');
  });

  it('acerta a volta do horário de verão (hora repetida)', () => {
    // 01/11/2026 — o relógio volta de 02:00 para 01:00. Não há resposta única;
    // o que importa é devolver um instante REAL cujo relógio local seja 01:30.
    const instante = civilToInstant({ year: 2026, month: 11, day: 1 }, { hour: 1, minute: 30 }, 'America/New_York');
    expect(localTimeOf(instante, 'America/New_York')).toBe('01:30');
    expect(localDayOf(instante, 'America/New_York')).toBe('2026-11-01');
  });

  it('não perde o compromisso numa hora PULADA', () => {
    // 08/03/2026 02:30 não existe em Nova York — o relógio salta de 02:00 para
    // 03:00. Um instante real precisa sair daqui de qualquer forma.
    const instante = civilToInstant({ year: 2026, month: 3, day: 8 }, { hour: 2, minute: 30 }, 'America/New_York');
    expect(Number.isFinite(instante)).toBe(true);
    expect(localDayOf(instante, 'America/New_York')).toBe('2026-03-08');
  });

  it('ida e volta preserva data e hora no Brasil', () => {
    const instante = civilToInstant({ year: 2026, month: 9, day: 18 }, { hour: 14, minute: 0 }, 'America/Recife');
    expect(localDayOf(instante, 'America/Recife')).toBe('2026-09-18');
    expect(localTimeOf(instante, 'America/Recife')).toBe('14:00');
  });
});

describe('toRfc3339', () => {
  it('emite offset explícito, nunca Z', () => {
    const iso = toRfc3339({ year: 2026, month: 9, day: 18 }, { hour: 14, minute: 0 }, 'America/Recife');
    expect(iso).toBe('2026-09-18T14:00:00-03:00');
    expect(iso).not.toContain('Z');
  });

  it('emite o offset de verão quando a data cai no verão', () => {
    const iso = toRfc3339({ year: 2026, month: 7, day: 15 }, { hour: 9, minute: 30 }, 'America/New_York');
    expect(iso).toBe('2026-07-15T09:30:00-04:00');
  });

  it('é aceito pelo Date nativo e volta ao mesmo instante', () => {
    const iso = toRfc3339({ year: 2026, month: 9, day: 18 }, { hour: 14, minute: 0 }, 'America/Recife');
    expect(localTimeOf(Date.parse(iso), 'America/Recife')).toBe('14:00');
  });
});

describe('instantToRfc3339', () => {
  it('formata no fuso pedido, com offset', () => {
    expect(instantToRfc3339(Date.UTC(2026, 8, 18, 17, 0, 0), 'America/Recife')).toBe(
      '2026-09-18T14:00:00-03:00',
    );
  });
});

describe('formatOffset', () => {
  it('formata negativo e positivo', () => {
    expect(formatOffset(-180)).toBe('-03:00');
    expect(formatOffset(540)).toBe('+09:00');
    expect(formatOffset(0)).toBe('+00:00');
    // Índia: meia hora de offset.
    expect(formatOffset(330)).toBe('+05:30');
  });
});

describe('aritmética de data civil', () => {
  it('vira o mês', () => {
    expect(civilToIso(addDays({ year: 2026, month: 9, day: 30 }, 1))).toBe('2026-10-01');
  });

  it('vira o ano', () => {
    expect(civilToIso(addDays({ year: 2026, month: 12, day: 31 }, 1))).toBe('2027-01-01');
  });

  it('respeita ano bissexto', () => {
    expect(civilToIso(addDays({ year: 2028, month: 2, day: 28 }, 1))).toBe('2028-02-29');
    expect(civilToIso(addDays({ year: 2026, month: 2, day: 28 }, 1))).toBe('2026-03-01');
  });

  it('anda para trás', () => {
    expect(civilToIso(addDays({ year: 2026, month: 1, day: 1 }, -1))).toBe('2025-12-31');
  });

  it('sabe o dia da semana', () => {
    // 18/09/2026 é uma sexta-feira.
    expect(weekdayOf({ year: 2026, month: 9, day: 18 })).toBe(5);
  });

  it('conta dias entre datas', () => {
    expect(daysBetween({ year: 2026, month: 9, day: 18 }, { year: 2026, month: 9, day: 25 })).toBe(7);
    expect(daysBetween({ year: 2026, month: 12, day: 31 }, { year: 2027, month: 1, day: 1 })).toBe(1);
  });

  it('rejeita 31 de fevereiro em vez de rolar para março', () => {
    expect(isRealDate({ year: 2026, month: 2, day: 31 })).toBe(false);
    expect(isRealDate({ year: 2026, month: 2, day: 28 })).toBe(true);
    expect(isRealDate({ year: 2026, month: 13, day: 1 })).toBe(false);
  });
});

describe('serialização', () => {
  it('lê e escreve data', () => {
    expect(civilFromIso('2026-09-18')).toEqual({ year: 2026, month: 9, day: 18 });
    expect(civilFromIso('2026-02-31')).toBeNull();
    expect(civilFromIso('18/09/2026')).toBeNull();
  });

  it('lê hora', () => {
    expect(timeFromIso('14:30')).toEqual({ hour: 14, minute: 30 });
    expect(timeFromIso('25:00')).toBeNull();
  });
});

describe('isValidTimezone', () => {
  it('aceita IANA e recusa sigla', () => {
    expect(isValidTimezone('America/Recife')).toBe(true);
    expect(isValidTimezone('BRT')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('-03:00')).toBe(false);
  });
});

describe('buildTemporalContext', () => {
  const inicio = Date.UTC(2026, 8, 18, 1, 0); // 17/09 22h em Recife
  const fim = Date.UTC(2026, 8, 18, 2, 0);

  it('marca confiança alta quando o fuso veio da extensão', () => {
    const ctx = buildTemporalContext({
      startedAtMs: inicio,
      endedAtMs: fim,
      timezone: 'America/Recife',
      source: 'extensao',
    });
    expect(ctx.timezone).toBe('America/Recife');
    expect(ctx.timezoneSource).toBe('extensao');
    expect(ctx.timezoneConfidence).toBe('alta');
    expect(ctx.localDate).toBe('2026-09-17');
    expect(ctx.localTime).toBe('22:00');
    expect(ctx.startedAt).toBe('2026-09-17T22:00:00-03:00');
  });

  it('cai para o padrão com confiança BAIXA quando o fuso é inválido', () => {
    const ctx = buildTemporalContext({
      startedAtMs: inicio,
      endedAtMs: fim,
      timezone: 'Nao/Existe',
      source: 'extensao',
    });
    expect(ctx.timezone).toBe('America/Sao_Paulo');
    expect(ctx.timezoneSource).toBe('padrao');
    expect(ctx.timezoneConfidence).toBe('baixa');
  });

  it('trata fuso ausente como padrão, sem quebrar', () => {
    const ctx = buildTemporalContext({
      startedAtMs: inicio,
      endedAtMs: fim,
      timezone: null,
      source: 'payload',
    });
    expect(ctx.timezone).toBe('America/Sao_Paulo');
    expect(ctx.timezoneConfidence).toBe('baixa');
  });

  it('confiança média quando o fuso veio declarado no payload', () => {
    const ctx = buildTemporalContext({
      startedAtMs: inicio,
      endedAtMs: fim,
      timezone: 'America/Recife',
      source: 'payload',
    });
    expect(ctx.timezoneConfidence).toBe('media');
  });
});
