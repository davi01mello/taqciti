import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleMeetProvider } from './GoogleMeetProvider';

function render(html: string): void {
  document.body.innerHTML = html;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('GoogleMeetProvider — presença confiável e reconciliada', () => {
  it('não promove avatar/falante da legenda a participante', () => {
    render(`
      <div role="region" aria-label="Legendas">
        <div data-participant-id="speaker-only"><span>Ana da legenda</span></div>
      </div>
      <div data-participant-id="self-1">
        <span data-self-name="Bernardo Belfort (Você)">Bernardo Belfort</span>
      </div>
      <div data-participant-id="guest-1">
        <span data-participant-name="Carla Lima">Carla Lima</span>
      </div>
    `);

    const participants = new GoogleMeetProvider().getParticipants();
    expect(participants?.map((entry) => entry.name)).toEqual([
      'Bernardo Belfort',
      'Carla Lima',
    ]);
    expect(participants?.some((entry) => /legenda/i.test(entry.name))).toBe(false);
    expect(participants?.[0]?.isHost).toBe(true);
  });

  it('remove de presentNow quem saiu, preservando firstSeen no retorno', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T10:00:00-03:00'));
    render(`
      <div data-participant-id="self"><span data-self-name="Ana Souza">Ana Souza</span></div>
      <div data-participant-id="guest"><span data-participant-name="Bruno Lima">Bruno Lima</span></div>
    `);
    const provider = new GoogleMeetProvider();
    const first = provider.getParticipants();
    const firstSeen = first?.find((entry) => entry.name === 'Ana Souza')?.firstSeenAt;

    vi.advanceTimersByTime(5_000);
    document.querySelector('[data-participant-id="guest"]')?.remove();
    const current = provider.getParticipants();

    expect(current?.map((entry) => entry.name)).toEqual(['Ana Souza']);
    expect(current?.[0]?.firstSeenAt).toBe(firstSeen);
    expect(current?.[0]?.lastSeenAt).toBe((firstSeen ?? 0) + 5_000);
  });

  it('mantém duas pessoas com o mesmo primeiro nome quando os tiles diferem', () => {
    render(`
      <div data-participant-id="ana-a"><span data-participant-name="Ana Souza">Ana Souza</span></div>
      <div data-participant-id="ana-b"><span data-participant-name="Ana Lima">Ana Lima</span></div>
    `);
    expect(new GoogleMeetProvider().getParticipants()?.map((entry) => entry.name)).toEqual([
      'Ana Souza',
      'Ana Lima',
    ]);
  });

  it('rejeita status/botões e aceita conta pessoal exibida como e-mail', () => {
    render(`
      <div role="listitem" data-user-id="status"><span data-participant-name="Microfone desativado">Microfone desativado</span></div>
      <div role="listitem" data-user-id="personal"><span data-participant-name="conta.pessoal@gmail.com">conta.pessoal@gmail.com</span></div>
    `);
    const participants = new GoogleMeetProvider().getParticipants();
    expect(participants).toHaveLength(1);
    expect(participants?.[0]).toMatchObject({
      providerParticipantId: 'personal',
      source: 'meet_roster',
      confidence: 0.95,
    });
    expect(participants?.[0]?.name.toLowerCase()).toBe('conta.pessoal@gmail.com');
  });
});

describe('GoogleMeetProvider — captura degradada explícita', () => {
  it('preserva a fala com speaker desconhecido e avisa que o parser degradou', () => {
    render(`
      <div role="region" aria-label="Legendas">
        <div>fala preservada sem inventar um participante</div>
      </div>
    `);
    const provider = new GoogleMeetProvider();
    const health: Array<[boolean, string | undefined]> = [];
    const chunks: Array<{ speaker: string | null; text: string }> = [];
    provider.onCaptureHealth((healthy, reason) => health.push([healthy, reason]));
    provider.onCaptionChunk((chunk) => chunks.push(chunk));
    const internals = provider as unknown as {
      captionRegion: Element | null;
      scanCaptions(): void;
    };
    internals.captionRegion = document.querySelector('[role="region"]');
    internals.scanCaptions();

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      speaker: null,
      text: 'fala preservada sem inventar um participante',
    });
    expect(health).toContainEqual([false, 'parser']);
  });
});
