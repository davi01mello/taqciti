import { describe, expect, it } from 'vitest';
import type { Participant } from '@/shared/types/domain';
import { cleanMeetingTitle, deriveMeetingTitle, isAutoTitle } from './naming';

describe('cleanMeetingTitle', () => {
  const CODE = 'gbx-hgdk-ywb';

  it('descarta o prefixo "Meet - " + código cru', () => {
    expect(cleanMeetingTitle('Meet - gbx-hgdk-ywb', CODE)).toBe('');
  });

  it('descarta o código cru com sufixo do Google Meet', () => {
    expect(cleanMeetingTitle('gbx-hgdk-ywb - Google Meet', CODE)).toBe('');
  });

  it('descarta o código nu', () => {
    expect(cleanMeetingTitle('gbx-hgdk-ywb', CODE)).toBe('');
  });

  it('preserva um nome de verdade dado pela pessoa', () => {
    expect(cleanMeetingTitle('Kickoff Sympla - Google Meet', CODE)).toBe('Kickoff Sympla');
    expect(cleanMeetingTitle('Reunião com a Acme', CODE)).toBe('Reunião com a Acme');
  });
});

describe('deriveMeetingTitle', () => {
  const host: Participant = { name: 'Bernardo Belfort', isHost: true };
  const p = (name: string): Participant => ({ name, isHost: null });

  it('null quando só há o anfitrião (ninguém para nomear)', () => {
    expect(deriveMeetingTitle([host])).toBeNull();
    expect(deriveMeetingTitle([])).toBeNull();
  });

  it('um cliente vira "Reunião com <primeiro nome>"', () => {
    expect(deriveMeetingTitle([host, p('Ana Costa')])).toBe('Reunião com Ana');
  });

  it('dois clientes são unidos por "e"', () => {
    expect(deriveMeetingTitle([host, p('Ana Costa'), p('Bruno Lima')])).toBe(
      'Reunião com Ana e Bruno',
    );
  });

  it('três ou mais resumem com "e mais N"', () => {
    expect(
      deriveMeetingTitle([host, p('Ana'), p('Bruno'), p('Carla')]),
    ).toBe('Reunião com Ana e mais 2');
  });
});

describe('isAutoTitle', () => {
  it('reconhece títulos gerados pela extensão', () => {
    expect(isAutoTitle('Reunião com Ana')).toBe(true);
    expect(isAutoTitle('Reunião de 21/07 às 14:00')).toBe(true);
  });

  it('não marca um nome digitado pela pessoa', () => {
    expect(isAutoTitle('Kickoff Sympla')).toBe(false);
  });
});
