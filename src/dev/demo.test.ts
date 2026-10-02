/**
 * A POPULAÇÃO DE DEMONSTRAÇÃO.
 *
 * O que estes testes protegem não é o conteúdo fictício — é o contrato dele
 * com o dado real: não duplicar, não encostar no que é verdadeiro ao sair, e
 * manter as referências coerentes entre reunião, nota, marcações, print e
 * conversas. Uma demonstração que apagasse uma reunião de verdade seria pior do
 * que não existir.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { MeetingRecord } from '@/shared/types/domain';
import type { Nota } from '@/features/annotations/notes';
import type { MarcasDaReuniao } from '@/features/annotations/marks';
import type { Print } from '@/features/annotations/shots';
import type { Conversation } from '@/home/conversations';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { PREFIXO_DEMO, REUNIAO_DEMO_ID, existeDemo, remover, semear } from './demo';

let storage: ReturnType<typeof installChromeStorageMock>;

/** Uma reunião de verdade, para provar que a demonstração não a atropela. */
const REAL: MeetingRecord = {
  id: 'reuniao-de-verdade',
  title: 'Daily do time',
  startedAt: Date.parse('2026-09-19T13:00:00Z'),
  endedAt: Date.parse('2026-09-19T13:15:00Z'),
  durationSeconds: 900,
  participants: [],
  segments: [],
  status: 'ready',
  metadata: {
    capturedCaptions: true,
    droppedSegments: 0,
    reconnectCount: 0,
    wasDiscardedAndRestarted: false,
  },
};

const ler = <T>(chave: string): T => storage.local.values[chave] as T;

beforeEach(() => {
  storage = installChromeStorageMock();
});

describe('semear', () => {
  it('escreve nas chaves reais, no formato real', async () => {
    await semear();

    const historico = ler<MeetingRecord[]>(STORAGE_KEYS.history);
    const reuniao = historico.find((r) => r.id === REUNIAO_DEMO_ID);
    expect(reuniao).toBeDefined();
    expect(reuniao!.status).toBe('ready');
    // Longa o bastante para a rolagem ter o que fazer numa coluna estreita.
    expect(reuniao!.segments.length).toBeGreaterThan(30);
    // Falantes diferentes, como numa reunião de verdade.
    expect(new Set(reuniao!.segments.map((s) => s.speaker)).size).toBeGreaterThan(2);
  });

  it('identifica tudo como demonstração, no título e no id', async () => {
    await semear();

    const historico = ler<MeetingRecord[]>(STORAGE_KEYS.history);
    const conversas = ler<Conversation[]>(STORAGE_KEYS.conversations);

    for (const registro of historico) {
      expect(registro.id.startsWith(PREFIXO_DEMO)).toBe(true);
      expect(registro.title).toContain('Demonstração');
    }
    for (const conversa of conversas) {
      expect(conversa.id.startsWith(PREFIXO_DEMO)).toBe(true);
      expect(conversa.title).toContain('Demonstração');
    }
  });

  /*
   * O selo tem de sobreviver ao storage. Uma resposta fictícia que perdesse a
   * marca ao ser relida viraria, para todos os efeitos, resposta real — e é
   * exatamente a confusão que a demonstração não pode produzir.
   */
  it('marca no registro toda resposta de agente que semeia', async () => {
    await semear();

    const conversas = ler<Conversation[]>(STORAGE_KEYS.conversations);
    const respostas = conversas.flatMap((c) =>
      c.messages.filter((m) => m.role === 'assistant'),
    );

    expect(respostas.length).toBeGreaterThan(0);
    expect(respostas.every((m) => m.demo === true)).toBe(true);
  });

  /* Uma conversa sem resposta nenhuma: a forma que o produto tem hoje. */
  it('inclui uma conversa só de rascunhos, como é em produção', async () => {
    await semear();

    const conversas = ler<Conversation[]>(STORAGE_KEYS.conversations);
    const soRascunhos = conversas.filter((c) =>
      c.messages.every((m) => m.role === 'user'),
    );

    expect(soRascunhos.length).toBeGreaterThan(0);
  });

  it('liga nota, marcações, print e conversas à MESMA reunião', async () => {
    await semear();

    const notas = ler<Record<string, Nota>>(STORAGE_KEYS.notes);
    const marcas = ler<Record<string, MarcasDaReuniao>>(STORAGE_KEYS.marks);
    const prints = ler<Print[]>(STORAGE_KEYS.shots);
    const conversas = ler<Conversation[]>(STORAGE_KEYS.conversations);
    const reuniao = ler<MeetingRecord[]>(STORAGE_KEYS.history).find(
      (r) => r.id === REUNIAO_DEMO_ID,
    )!;

    expect(notas[REUNIAO_DEMO_ID]?.meetingId).toBe(REUNIAO_DEMO_ID);
    expect(prints.every((p) => p.meetingId === REUNIAO_DEMO_ID)).toBe(true);
    expect(prints[0]!.dataUrl.startsWith('data:image/')).toBe(true);

    // As marcações apontam para trechos que EXISTEM na transcrição semeada.
    const ids = new Set(reuniao.segments.map((s) => s.captionId));
    const marcadas = Object.keys(marcas[REUNIAO_DEMO_ID] ?? {});
    expect(marcadas.length).toBeGreaterThan(0);
    expect(marcadas.every((id) => ids.has(id))).toBe(true);

    // E as conversas que nasceram da reunião apontam para ela.
    const daReuniao = conversas.filter((c) => c.meetingId !== undefined);
    expect(daReuniao.length).toBeGreaterThan(0);
    expect(daReuniao.every((c) => c.meetingId === REUNIAO_DEMO_ID)).toBe(true);
  });

  it('semear duas vezes não duplica nada', async () => {
    await semear();
    const primeira = JSON.stringify(storage.local.values);

    await semear();

    expect(JSON.stringify(storage.local.values)).toBe(primeira);
  });

  it('não mexe no que já estava guardado', async () => {
    await storage.local.set({ [STORAGE_KEYS.history]: [REAL] });

    await semear();

    const historico = ler<MeetingRecord[]>(STORAGE_KEYS.history);
    expect(historico.find((r) => r.id === REAL.id)).toEqual(REAL);
  });
});

describe('remover', () => {
  it('tira a demonstração e deixa o resto intacto', async () => {
    await storage.local.set({ [STORAGE_KEYS.history]: [REAL] });
    await semear();
    expect(await existeDemo()).toBe(true);

    await remover();

    expect(await existeDemo()).toBe(false);
    expect(ler<MeetingRecord[]>(STORAGE_KEYS.history)).toEqual([REAL]);
    expect(ler<Conversation[]>(STORAGE_KEYS.conversations)).toEqual([]);
    expect(ler<Print[]>(STORAGE_KEYS.shots)).toEqual([]);
    expect(ler<Record<string, Nota>>(STORAGE_KEYS.notes)).toEqual({});
    expect(ler<Record<string, MarcasDaReuniao>>(STORAGE_KEYS.marks)).toEqual({});
  });

  /* O critério é UM: o prefixo. Nada mais decide o que sai. */
  it('preserva nota, marcação e print de reuniões reais', async () => {
    const notaReal: Nota = { meetingId: REAL.id, texto: 'não perder', updatedAt: 1 };
    const printReal: Print = {
      id: 'print-real',
      meetingId: REAL.id,
      dataUrl: 'data:image/jpeg;base64,AAAA',
      at: 1,
      largura: 10,
      altura: 10,
    };
    await storage.local.set({
      [STORAGE_KEYS.notes]: { [REAL.id]: notaReal },
      [STORAGE_KEYS.marks]: { [REAL.id]: { 'cap-1': 'destaque' } },
      [STORAGE_KEYS.shots]: [printReal],
    });

    await semear();
    await remover();

    expect(ler<Record<string, Nota>>(STORAGE_KEYS.notes)).toEqual({ [REAL.id]: notaReal });
    expect(ler<Record<string, MarcasDaReuniao>>(STORAGE_KEYS.marks)).toEqual({
      [REAL.id]: { 'cap-1': 'destaque' },
    });
    expect(ler<Print[]>(STORAGE_KEYS.shots)).toEqual([printReal]);
  });
});
