/**
 * Os serviços determinísticos: privacidade, captura, revisão de documento e
 * fuso. Sem modelo, sem storage — contas que precisam dar sempre o mesmo
 * resultado. Dados sintéticos.
 */
import { describe, expect, it } from 'vitest';
import type { MeetingRecord, MeetingState } from '@/shared/types/domain';
import type { DocumentoGuardado } from '@/features/documents/store';
import { acharSensiveis, avisosDeExposicao, ocultarSensiveis } from './privacidade';
import { avaliarCaptura } from './captura';
import { revisarDocumento } from './revisao';
import { diaLocal, linkDoGoogleAgenda, localParaInstante, rotuloDoHorario } from './agenda';

describe('privacidade', () => {
  it('reconhece e-mail, telefone, CPF e CNPJ válidos — e não número qualquer', () => {
    const texto =
      'Fale com ana@citi.org.br ou (81) 99876-5432. CPF 529.982.247-25, CNPJ 11.222.333/0001-81. ' +
      'Pedido 123.456.789-00 é só um código, e o ano é 2026.';
    const tipos = acharSensiveis(texto).map((t) => t.tipo);
    expect(tipos).toEqual(['email', 'telefone', 'cpf', 'cnpj']);
  });

  it('a cópia oculta sem mexer no original, e o aviso não repete o dado', () => {
    const texto = 'senha: hunter2 e o e-mail bia@exemplo.com';
    const copia = ocultarSensiveis(texto);
    expect(copia).not.toContain('hunter2');
    expect(copia).not.toContain('bia@exemplo.com');
    expect(texto).toContain('hunter2');
    const avisos = avisosDeExposicao(acharSensiveis(texto)).join(' ');
    expect(avisos).not.toContain('bia@exemplo.com');
    expect(avisos).toMatch(/e-mail/);
  });
});

function reuniao(extra: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: 'm-1',
    title: 'Daily sintética',
    startedAt: 0,
    endedAt: 600_000,
    durationSeconds: 600,
    participants: [],
    segments: [
      { captionId: 'a', speaker: 'Ana', text: 'Bom dia', startOffsetMs: 0, endOffsetMs: 2_000 },
      { captionId: 'b', speaker: 'Bruno', text: 'Seguimos', startOffsetMs: 5_000, endOffsetMs: 7_000 },
      // Seis minutos sem fala: pode ser silêncio.
      { captionId: 'c', speaker: 'Ana', text: 'Voltando', startOffsetMs: 367_000, endOffsetMs: 369_000 },
    ],
    status: 'ready',
    metadata: { capturedCaptions: true, droppedSegments: 0, reconnectCount: 0, wasDiscardedAndRestarted: false },
    ...extra,
  };
}

describe('monitor de captura', () => {
  it('silêncio não é falha: o intervalo aparece, a avaliação não acusa problema', () => {
    const a = avaliarCaptura(reuniao(), null);
    expect(a.situacao).toBe('encerrada');
    expect(a.avaliacao).toBe('sem_problemas_detectados');
    expect(a.intervalos).toEqual([{ deMs: 7_000, ateMs: 367_000 }]);
    expect(a.sinais.join(' ')).toMatch(/pode ser silêncio/);
  });

  it('trecho descartado e reconexão são sinais verificáveis', () => {
    const a = avaliarCaptura(
      reuniao({ metadata: { capturedCaptions: true, droppedSegments: 2, reconnectCount: 1, wasDiscardedAndRestarted: false } }),
      null,
    );
    expect(a.avaliacao).toBe('problemas_detectados');
    expect(a.sinais.join(' ')).toMatch(/2 trecho\(s\) descartado/);
  });

  it('ao vivo: legenda ilegível vira problema; estado de OUTRA reunião não é usado', () => {
    const agora = 1_000_000;
    const vivo = {
      phase: 'recording',
      session: { meetingId: 'm-1', captureHealthy: false, lastChunkAt: agora - 1_000 },
    } as unknown as MeetingState;
    expect(avaliarCaptura(reuniao({ status: 'recording' }), vivo, agora).situacao).toBe('problema_na_captura');
    const deOutra = { ...vivo, session: { ...vivo.session!, meetingId: 'outra' } } as MeetingState;
    expect(avaliarCaptura(reuniao({ status: 'recording' }), deOutra, agora).situacao).toBe('desconhecida');
  });
});

describe('revisão de documento', () => {
  const ata: DocumentoGuardado = {
    id: 'd-1',
    title: 'Ata — Daily',
    formato: 'markdown',
    origem: 'gerado',
    createdAt: 1,
    updatedAt: 2,
    tipo: 'Ata de Reunião',
    meetingId: 'm-1',
    content: [
      '# Ata — Daily',
      '## Identificação',
      '**Projeto:** A confirmar',
      '## Tópico geral',
      'Abertura da daily [1].',
      '## Decisões tomadas',
      'Seguir com o plano [2] [3].',
      '## Fontes',
      '1. Daily sintética · 0:00 — “Bom dia”',
      '2. Daily sintética · 0:05 — “isto nunca foi dito”',
    ].join('\n\n'),
  };

  it('aponta seção obrigatória ausente, "A confirmar", nota sem fonte e fonte que mudou', () => {
    const r = revisarDocumento(ata, [reuniao()]);
    const tipos = r.problemas.map((p) => p.tipo);
    expect(tipos).toContain('secao_ausente'); // Participantes, Tópicos, Conclusão, Assinatura
    expect(tipos).toContain('a_confirmar');
    expect(tipos).toContain('nota_sem_fonte'); // [3]
    expect(tipos).toContain('fonte_alterada'); // [2]
    expect(r.fontes.map((f) => f.situacao)).toEqual(['conferida', 'alterada']);
  });

  it('reunião apagada: a fonte fica indisponível, não "conferida"', () => {
    const r = revisarDocumento(ata, []);
    expect(r.fontes.every((f) => f.situacao === 'indisponivel')).toBe(true);
  });
});

describe('fuso', () => {
  it('14h em Recife é 17h UTC; em São Paulo também; em Lisboa (verão) é 13h UTC', () => {
    expect(new Date(localParaInstante('2026-10-02', '14:00', 'America/Recife')).toISOString()).toBe('2026-10-02T17:00:00.000Z');
    expect(new Date(localParaInstante('2026-10-02', '14:00', 'America/Sao_Paulo')).toISOString()).toBe('2026-10-02T17:00:00.000Z');
    expect(new Date(localParaInstante('2026-07-02', '14:00', 'Europe/Lisbon')).toISOString()).toBe('2026-07-02T13:00:00.000Z');
  });

  it('22h em Recife ainda é o mesmo dia local, mesmo sendo o dia seguinte em UTC', () => {
    const i = localParaInstante('2026-10-02', '22:00', 'America/Recife');
    expect(new Date(i).toISOString().slice(0, 10)).toBe('2026-10-03');
    expect(diaLocal(i, 'America/Recife')).toBe('2026-10-02');
    expect(rotuloDoHorario(i, 'America/Recife')).toMatch(/02\/10.*22:00/);
  });

  it('data inexistente é recusada', () => {
    expect(() => localParaInstante('2026-02-30', '10:00', 'America/Recife')).toThrow(/inexistente/);
  });

  it('o link do Google Agenda não leva convidados', () => {
    const link = linkDoGoogleAgenda({
      titulo: 'Revisão de escopo',
      inicio: '2026-10-02T17:00:00.000Z',
      fim: '2026-10-02T17:30:00.000Z',
      fuso: 'America/Recife',
    });
    const url = new URL(link);
    expect(url.searchParams.get('dates')).toBe('20261002T170000Z/20261002T173000Z');
    expect(url.searchParams.has('add')).toBe(false);
  });
});
