/**
 * "Gerar documento" não para para perguntar: salva direto, e as perguntas da
 * geração vão para uma conversa nova com o Taq. A geração do servidor é
 * simulada (`requestGeneration`); o storage e a tela são os de verdade.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import type { MeetingRecord } from '@/shared/types/domain';
import { lerDocumentos } from '@/features/documents/store';
import type { Conversation } from './conversations';
import type * as Geracao from '@/document/generateDocument';

vi.mock('@/document/generateDocument', async (original) => ({
  ...(await original<typeof Geracao>()),
  requestGeneration: vi.fn(async () => ({
    status: 'success',
    documentType: 'ata',
    title: 'Ata — Sprint 12',
    content: '# Ata\n\n**Projeto:** **[A preencher: nome do projeto]**',
    html: '<h1>Ata</h1>',
    questions: [{ id: 'q1', question: 'Qual é o nome do projeto?' }],
    gaps: [],
    documentData: {},
  })),
}));
const { GerarDocumento } = await import('./GerarDocumento');

const REGISTRO: MeetingRecord = {
  id: 'm-sprint',
  title: 'Sprint 12',
  startedAt: 1,
  endedAt: 2,
  durationSeconds: 60,
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

let host: HTMLDivElement;
let root: Root;
let storage: ReturnType<typeof installChromeStorageMock>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  storage = installChromeStorageMock();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('salva direto, sem formulário, e as perguntas viram uma conversa do Taq', async () => {
  await act(async () =>
    root.render(<GerarDocumento registro={REGISTRO} onAbrirDocumento={() => {}} />),
  );
  await act(async () => host.querySelector<HTMLButtonElement>('.tq-acao')!.click());
  const ata = [...host.querySelectorAll<HTMLButtonElement>('.tq-gerar-menu button')].find(
    (b) => b.textContent === 'Ata de Reunião',
  )!;
  await act(async () => ata.click());
  for (let i = 0; i < 50 && !host.textContent!.includes('Salvo em Documentos'); i += 1) {
    await act(async () => new Promise((r) => setTimeout(r, 10)));
  }
  for (let i = 0; i < 50 && !host.textContent!.includes('conversa com o Taq'); i += 1) {
    await act(async () => new Promise((r) => setTimeout(r, 10)));
  }

  expect(host.querySelector('.tq-gerar-perguntas')).toBeNull();
  expect(host.textContent).toContain('Salvo em Documentos');
  expect(host.textContent).toContain('Uma pergunta ficou na conversa com o Taq');

  const [doc] = await lerDocumentos();
  expect(doc).toMatchObject({ title: 'Ata — Sprint 12', meetingId: 'm-sprint' });
  expect(doc!.content).toContain('[A preencher: nome do projeto]');

  const [conversa] = storage.local.values[STORAGE_KEYS.conversations] as Conversation[];
  expect(conversa!.meetingId).toBe('m-sprint');
  expect(conversa!.messages).toHaveLength(1);
  expect(conversa!.messages[0]).toMatchObject({
    role: 'assistant',
    pergunta: { motivo: 'informacao_indispensavel', opcoes: [] },
    documentos: [{ id: doc!.id, titulo: 'Ata — Sprint 12', acao: 'criado' }],
  });
  expect(conversa!.messages[0]!.text).toContain('- Qual é o nome do projeto?');
});
