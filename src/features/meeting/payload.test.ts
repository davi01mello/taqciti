import { describe, expect, it } from 'vitest';
import type { MeetingSessionState } from '@/shared/types/domain';
import { buildMeetingPayload, buildMeetingRecord } from './payload';

const START = Date.UTC(2026, 6, 6, 14, 0, 0);
const END = START + 45 * 60 * 1000;

function session(overrides: Partial<MeetingSessionState> = {}): MeetingSessionState {
  return {
    meetingId: 'm-42',
    meetingCode: 'abc-defg-hij',
    provider: 'google-meet',
    title: 'Discovery Sympla',
    tabId: 3,
    startedAt: START,
    endedAt: END,
    captionsEnabled: true,
    participants: [
      { name: 'Ana', isHost: true },
      { name: 'Bruno', isHost: null },
    ],
    segments: [
      {
        id: 'seg-0',
        captionId: 'c1',
        speaker: 'Ana',
        text: 'vamos falar do orçamento da proposta',
        startOffsetMs: 1000,
        endOffsetMs: 4000,
        source: 'caption',
        status: 'active',
      },
    ],
    sealedCaptionIds: ['c0'],
    droppedSegments: 2,
    reconnectCount: 1,
    wasDiscardedAndRestarted: true,
    captionLanguage: 'unknown',
    languageWarningDismissed: false,
    chunksSinceLanguageCheck: 0,
    ...overrides,
  };
}

describe('buildMeetingPayload', () => {
  it('cumpre o contrato: datas ISO, duração e metadata corretos', () => {
    const payload = buildMeetingPayload(session());
    expect(payload).toEqual({
      meetingId: 'm-42',
      provider: 'google-meet',
      title: 'Discovery Sympla',
      startedAt: new Date(START).toISOString(),
      endedAt: new Date(END).toISOString(),
      // O contexto temporal tem forma própria (fuso da máquina que roda a
      // suíte) e é verificado no bloco "contexto temporal", abaixo.
      temporal: expect.objectContaining({
        timezone: expect.any(String),
        localDate: expect.any(String),
        timezoneSource: 'extensao',
      }),
      durationSeconds: 45 * 60,
      participants: [
        { name: 'Ana', isHost: true },
        { name: 'Bruno', isHost: null },
      ],
      transcript: [
        {
          speaker: 'Ana',
          text: 'vamos falar do orçamento da proposta',
          startOffsetMs: 1000,
          endOffsetMs: 4000,
        },
      ],
      metadata: {
        capturedCaptions: true,
        droppedSegments: 2,
        reconnectCount: 1,
        captureDegradedCount: 0,
        lastChunkAt: null,
        wasDiscardedAndRestarted: true,
      },
    });
  });

  it('remove o captionId interno do transcript', () => {
    const payload = buildMeetingPayload(session());
    expect(payload.transcript[0]).not.toHaveProperty('captionId');
  });

  it('sem segmentos → capturedCaptions false', () => {
    const payload = buildMeetingPayload(session({ segments: [] }));
    expect(payload.metadata.capturedCaptions).toBe(false);
  });
});

describe('registro de histórico', () => {
  it('reunião viva (sem endedAt) usa o fallback para calcular a duração', () => {
    const live = session({ endedAt: null });
    const record = buildMeetingRecord(live, 'recording', START + 10 * 60 * 1000);
    expect(record.status).toBe('recording');
    expect(record.endedAt).toBe(START + 10 * 60 * 1000);
    expect(record.durationSeconds).toBe(10 * 60);
  });
});

describe('contexto temporal', () => {
  /*
   * O payload passou a carregar o fuso porque o backend não tinha como saber
   * qual era o DIA LOCAL da conversa a partir de um instante em UTC — e é
   * contra esse dia que "amanhã" e "terça" são resolvidos.
   */
  it('o payload carrega fuso IANA, dia e hora locais', () => {
    const payload = buildMeetingPayload(session());
    expect(payload.temporal).toBeDefined();
    expect(payload.temporal?.timezone).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$|^UTC$/);
    expect(payload.temporal?.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.temporal?.localTime).toMatch(/^\d{2}:\d{2}$/);
    expect(payload.temporal?.timezoneSource).toBe('extensao');
  });

  it('startedAt do contexto traz offset explícito, nunca "Z"', () => {
    // Um horário sem fuso é uma ambiguidade que alguém resolve errado depois.
    const payload = buildMeetingPayload(session());
    expect(payload.temporal?.startedAt).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it('o dia local do contexto e o instante em UTC descrevem o mesmo momento', () => {
    const payload = buildMeetingPayload(session());
    expect(Date.parse(payload.temporal?.startedAt ?? '')).toBe(Date.parse(payload.startedAt));
  });
});
