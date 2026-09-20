/**
 * A autorização de captura: por PARTICIPAÇÃO, não por sala.
 *
 * O caso que este arquivo existe para impedir é concreto: a daily de hoje e a
 * daily de amanhã têm o mesmo link do Meet. Um "sim" de hoje não pode ligar a
 * captura sozinha amanhã.
 *
 * Os quatro cenários do requisito estão aqui, nomeados: re-render, reconexão
 * breve, participação nova no mesmo link, e reabertura do navegador.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { REJOIN_RESUME_WINDOW_MS } from '@/shared/config/constants';

const SALA = 'abc-defg-hij';
const T0 = 1_700_000_000_000;

beforeEach(() => {
  vi.resetModules();
  installChromeStorageMock();
});

describe('a participação', () => {
  it('entrar numa sala abre uma participação', async () => {
    const { abrirParticipacao } = await import('./consent');
    const p = await abrirParticipacao(SALA, T0);
    expect(p.meetingCode).toBe(SALA);
    expect(p.id).toMatch(/^p/);
    expect(p.saiuEm).toBeNull();
  });

  /* Re-render do Meet, reload da aba, sidebar fechando e abrindo. */
  it('enquanto se está dentro, é sempre a MESMA participação', async () => {
    const { abrirParticipacao } = await import('./consent');
    const primeira = await abrirParticipacao(SALA, T0);
    const segunda = await abrirParticipacao(SALA, T0 + 5_000);
    const terceira = await abrirParticipacao(SALA, T0 + 90_000);
    expect(segunda.id).toBe(primeira.id);
    expect(terceira.id).toBe(primeira.id);
  });

  /* Queda de conexão: sai e volta em seguida. */
  it('voltar logo depois de sair retoma a mesma participação', async () => {
    const { abrirParticipacao, fecharParticipacao } = await import('./consent');
    const primeira = await abrirParticipacao(SALA, T0);
    await fecharParticipacao(T0 + 60_000);

    const volta = await abrirParticipacao(SALA, T0 + 60_000 + 30_000);
    expect(volta.id).toBe(primeira.id);
    expect(volta.saiuEm).toBeNull();
  });

  /* O caso central: o mesmo link, outra reunião. */
  it('voltar ao mesmo link depois da janela é uma participação NOVA', async () => {
    const { abrirParticipacao, fecharParticipacao } = await import('./consent');
    const primeira = await abrirParticipacao(SALA, T0);
    await fecharParticipacao(T0 + 60_000);

    const depois = await abrirParticipacao(
      SALA,
      T0 + 60_000 + REJOIN_RESUME_WINDOW_MS + 1,
    );
    expect(depois.id).not.toBe(primeira.id);
  });

  it('outra sala é sempre outra participação', async () => {
    const { abrirParticipacao } = await import('./consent');
    const a = await abrirParticipacao(SALA, T0);
    const b = await abrirParticipacao('xyz-wxyz-abc', T0 + 1_000);
    expect(b.id).not.toBe(a.id);
  });

  /* Fechar a participação não a apaga: é o que permite retomá-la. */
  it('sair fecha, não apaga', async () => {
    const { abrirParticipacao, fecharParticipacao, lerParticipacao } = await import('./consent');
    await abrirParticipacao(SALA, T0);
    await fecharParticipacao(T0 + 1_000);
    const guardada = await lerParticipacao();
    expect(guardada?.saiuEm).toBe(T0 + 1_000);
  });

  it('sair duas vezes não move o instante da saída', async () => {
    const { abrirParticipacao, fecharParticipacao, lerParticipacao } = await import('./consent');
    await abrirParticipacao(SALA, T0);
    await fecharParticipacao(T0 + 1_000);
    await fecharParticipacao(T0 + 9_000);
    expect((await lerParticipacao())?.saiuEm).toBe(T0 + 1_000);
  });
});

describe('a decisão', () => {
  it('sem resposta ainda, não há decisão', async () => {
    const { decisaoDe } = await import('./consent');
    await expect(decisaoDe('p-qualquer')).resolves.toBeNull();
  });

  it('lembra o aceite e a recusa da participação', async () => {
    const { decisaoDe, guardarDecisao } = await import('./consent');
    await guardarDecisao('p1', 'aceito');
    await guardarDecisao('p2', 'recusado');
    await expect(decisaoDe('p1')).resolves.toBe('aceito');
    await expect(decisaoDe('p2')).resolves.toBe('recusado');
  });

  it('mudar de ideia sobrescreve', async () => {
    const { decisaoDe, guardarDecisao } = await import('./consent');
    await guardarDecisao('p1', 'recusado');
    await guardarDecisao('p1', 'aceito');
    await expect(decisaoDe('p1')).resolves.toBe('aceito');
  });

  it('lixo no storage não vira decisão', async () => {
    const { STORAGE_KEYS } = await import('@/shared/config/constants');
    await chrome.storage.session.set({ [STORAGE_KEYS.meetingConsent]: 'talvez' });
    const { decisaoDe } = await import('./consent');
    await expect(decisaoDe('p1')).resolves.toBeNull();
  });

  /*
   * O cenário inteiro, do jeito que acontece: autorizou hoje, saiu, e entrou
   * de novo no mesmo link amanhã. A autorização NÃO acompanha.
   */
  it('a autorização não atravessa para uma participação nova no mesmo link', async () => {
    const { abrirParticipacao, fecharParticipacao, guardarDecisao, decisaoDe } =
      await import('./consent');

    const hoje = await abrirParticipacao(SALA, T0);
    await guardarDecisao(hoje.id, 'aceito');
    expect(await decisaoDe(hoje.id)).toBe('aceito');
    await fecharParticipacao(T0 + 30 * 60_000);

    const amanha = await abrirParticipacao(SALA, T0 + 24 * 60 * 60_000);
    expect(amanha.id).not.toBe(hoje.id);
    // A pergunta volta, porque para ESTA participação ninguém decidiu nada.
    expect(await decisaoDe(amanha.id)).toBeNull();
  });

  /*
   * Reabrir o navegador: `storage.session` some com ele. Aqui isso é simulado
   * instalando um mock limpo, que é exatamente o que o Chrome entrega.
   */
  it('reabrir o navegador apaga participação e autorização', async () => {
    const { abrirParticipacao, guardarDecisao } = await import('./consent');
    const antes = await abrirParticipacao(SALA, T0);
    await guardarDecisao(antes.id, 'aceito');

    installChromeStorageMock();
    vi.resetModules();
    const novo = await import('./consent');
    expect(await novo.lerParticipacao()).toBeNull();
    expect(await novo.decisaoDe(antes.id)).toBeNull();
  });
});

describe('a reunião anunciada para quem pergunta', () => {
  it('leva a participação junto — é a chave da resposta', async () => {
    const { anunciarReuniao, lerReuniaoDetectada } = await import('./consent');
    await anunciarReuniao({
      meetingCode: SALA,
      title: 'Daily',
      participacaoId: 'p1',
      tabId: 7,
      at: T0,
    });
    const lida = await lerReuniaoDetectada();
    expect(lida?.participacaoId).toBe('p1');
    expect(lida?.title).toBe('Daily');
  });

  it('um anúncio antigo sem participação é descartado', async () => {
    const { STORAGE_KEYS } = await import('@/shared/config/constants');
    await chrome.storage.session.set({
      [STORAGE_KEYS.pendingMeeting]: { meetingCode: SALA, title: 'Daily' },
    });
    const { lerReuniaoDetectada } = await import('./consent');
    await expect(lerReuniaoDetectada()).resolves.toBeNull();
  });

  it('esquecer limpa o anúncio', async () => {
    const { anunciarReuniao, esquecerReuniao, lerReuniaoDetectada } = await import('./consent');
    await anunciarReuniao({
      meetingCode: SALA, title: 'Daily', participacaoId: 'p1', tabId: null, at: T0,
    });
    await esquecerReuniao();
    await expect(lerReuniaoDetectada()).resolves.toBeNull();
  });
});
