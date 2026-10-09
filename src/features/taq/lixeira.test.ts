/**
 * A lixeira — guardar, apagar a reunião, desfazer. Storage real (mock).
 *
 * Segura o que a auditoria de integridade achou: o "Desfazer" devolvia a nota, as
 * marcações e os prints, mas NÃO o briefing que a pessoa escreveu, o estado dos
 * pontos nem as sugestões — que a exclusão tinha levado. Aqui o ciclo é provado de
 * ponta a ponta, e o que já existir agora nunca é sobrescrito.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { limparVinculosDaReuniao } from '@/features/annotations/vinculos';
import { briefingDaReuniao, lerConducao, salvarBriefing } from '@/features/conducao/store';
import { lerEstados, snapshotInicial, transacaoDoEstado } from '@/features/estado/store';
import { lerApoio, mudarEstado, registrarFeedback, registrarSugestao } from '@/features/apoio/store';
import type { MeetingRecord } from '@/shared/types/domain';
import { guardarNaLixeira, restaurarDaLixeira } from './lixeira';

const REGISTRO = {
  id: 'm-1',
  title: 'Descoberta com a Prefeitura',
  startedAt: Date.parse('2026-10-06T12:00:00Z'),
  endedAt: Date.parse('2026-10-06T13:00:00Z'),
  durationSeconds: 3600,
  participants: [],
  segments: [{ captionId: 'a', speaker: 'Ana', text: 'Oi para todos aqui hoje.', startOffsetMs: 0, endOffsetMs: 1000 }],
  status: 'ready',
  metadata: { capturedCaptions: true, droppedSegments: 0, reconnectCount: 0, wasDiscardedAndRestarted: false },
} as unknown as MeetingRecord;

const restauraNoBackground = async () => ({ ok: true });

async function semear() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.history]: [REGISTRO],
    [STORAGE_KEYS.notes]: { 'm-1': { meetingId: 'm-1', texto: 'o que eu anotei', updatedAt: 1 } },
  });
  await salvarBriefing(
    'm-1',
    { objetivo: 'Entender a causa dos atrasos.', contexto: 'Cliente novo.', prioridades: ['Onde ocorre a espera'] },
    0,
  );
  await transacaoDoEstado((m) => {
    m['m-1'] = snapshotInicial('m-1', ['Onde ocorre a espera'], 3, 1);
    return { resultado: undefined, mudou: true };
  });
  const s = await registrarSugestao({
    reuniaoId: 'm-1',
    revisao: 8,
    tipo: 'pergunta',
    natureza: 'recomendacao',
    texto: 'Vale esclarecer onde trava.',
    pergunta: 'Onde o atendimento trava hoje?',
    motivo: 'Ainda não ficou claro.',
    ponto: 'Onde ocorre a espera',
    evidencias: [{ segmento: 2, trecho: 'A gente tem muita reclamação.' }],
  });
  if (s.tipo !== 'ok') throw new Error('esperava ok');
  await mudarEstado(s.sugestao.id, 'mostrada');
  await registrarFeedback({ sugestaoId: s.sugestao.id, tipo: 'util' });
}

beforeEach(() => {
  installChromeStorageMock();
});

describe('o ciclo guardar → apagar → desfazer', () => {
  it('o retrato guarda o briefing, o estado e as sugestões, além da nota', async () => {
    await semear();
    const item = await guardarNaLixeira(REGISTRO);
    expect(item.notas).toHaveLength(1);
    expect(item.briefing).toMatchObject({ reuniaoId: 'm-1', objetivo: 'Entender a causa dos atrasos.' });
    expect(item.estado).toMatchObject({ reuniaoId: 'm-1' });
    expect(item.apoio!.sugestoes).toHaveLength(1);
    expect(item.apoio!.feedback).toHaveLength(1);
  });

  it('apagar leva tudo; desfazer devolve o briefing, o estado, as sugestões e o feedback', async () => {
    await semear();
    await guardarNaLixeira(REGISTRO);
    await limparVinculosDaReuniao('m-1');
    // A exclusão levou tudo, inclusive o que a pessoa escreveu.
    expect(briefingDaReuniao(await lerConducao(), 'm-1')).toBeNull();
    expect((await lerEstados())['m-1']).toBeUndefined();
    expect((await lerApoio()).sugestoes).toEqual([]);

    const r = await restaurarDaLixeira('m-1', restauraNoBackground);
    expect(r.ok).toBe(true);
    const briefing = briefingDaReuniao(await lerConducao(), 'm-1');
    expect(briefing).toMatchObject({ objetivo: 'Entender a causa dos atrasos.', contexto: 'Cliente novo.', prioridades: ['Onde ocorre a espera'] });
    expect((await lerEstados())['m-1']!.pontos).toHaveLength(1);
    const apoio = await lerApoio();
    expect(apoio.sugestoes).toHaveLength(1);
    expect(apoio.sugestoes[0]).toMatchObject({ ponto: 'Onde ocorre a espera', estado: 'mostrada' });
    expect(apoio.feedback).toHaveLength(1);
    // A nota também volta (o que já funcionava).
    expect((await chrome.storage.local.get(STORAGE_KEYS.notes))[STORAGE_KEYS.notes]['m-1'].texto).toBe('o que eu anotei');
  });

  it('o que já existe agora não é sobrescrito: briefing novo, estado novo e sugestões já presentes ficam como estão', async () => {
    await semear();
    await guardarNaLixeira(REGISTRO);
    await limparVinculosDaReuniao('m-1');
    // Nesse meio-tempo a pessoa preparou a reunião de novo e o Taq leu os pontos.
    await salvarBriefing('m-1', { objetivo: 'OBJETIVO NOVO' }, 0);
    await transacaoDoEstado((m) => {
      m['m-1'] = snapshotInicial('m-1', ['Ponto novo'], 9, 2);
      return { resultado: undefined, mudou: true };
    });
    await restaurarDaLixeira('m-1', restauraNoBackground);
    expect(briefingDaReuniao(await lerConducao(), 'm-1')!.objetivo).toBe('OBJETIVO NOVO');
    expect((await lerEstados())['m-1']!.pontos.map((p) => p.texto)).toEqual(['Ponto novo']);
  });

  it('as sugestões não duplicam se já estiverem lá (restaurar duas vezes não cria cópias)', async () => {
    await semear();
    await guardarNaLixeira(REGISTRO);
    await limparVinculosDaReuniao('m-1');
    await restaurarDaLixeira('m-1', restauraNoBackground);
    // Segunda ida à lixeira com o mesmo conteúdo e nova restauração.
    await guardarNaLixeira(REGISTRO);
    await restaurarDaLixeira('m-1', restauraNoBackground);
    const apoio = await lerApoio();
    expect(apoio.sugestoes).toHaveLength(1);
    expect(apoio.feedback).toHaveLength(1);
  });

  it('sem o aplicativo confirmar a restauração, nada é devolvido', async () => {
    await semear();
    await guardarNaLixeira(REGISTRO);
    await limparVinculosDaReuniao('m-1');
    const r = await restaurarDaLixeira('m-1', async () => ({ ok: false }));
    expect(r.ok).toBe(false);
    expect(briefingDaReuniao(await lerConducao(), 'm-1')).toBeNull();
  });

  it('reunião sem briefing, estado nem sugestões: o retrato não carrega nada disso', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [REGISTRO] });
    const item = await guardarNaLixeira(REGISTRO);
    expect(item.briefing).toBeUndefined();
    expect(item.estado).toBeUndefined();
    expect(item.apoio).toBeUndefined();
  });
});
