/**
 * A leitura ao encerrar — dados sintéticos.
 *
 * Segura: só roda para quem marcou no perfil, uma vez por reunião, só com o
 * assistente conectado, e não repete quando o estado já cobre todas as falas.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { salvarPerfil } from '@/features/conducao/store';
import type { MeetingState } from '@/shared/types/domain';

const atualizarEstadoDaReuniao = vi.fn();
vi.mock('./atualizar', () => ({ atualizarEstadoDaReuniao: (...a: unknown[]) => atualizarEstadoDaReuniao(...a) }));

import { useEstadoDosPontos } from './useEstado';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PERFIL = {
  missao: 'Apoiar a condução de reuniões de descoberta.',
  observar: [],
  intervencao: { modo: 'discreto', estilo: '' },
  contexto: [],
  preferencias: [],
};

const reuniao = (phase: MeetingState['phase'], id = 'm-1'): MeetingState =>
  ({
    phase,
    session: {
      meetingId: id,
      title: 'Descoberta',
      segments: [{ id: 's1', speaker: 'Ana', text: 'Vamos decidir o prazo.', startedAt: 1 }],
    },
  }) as unknown as MeetingState;

function Sonda({ state, pronto }: { state: MeetingState; pronto: boolean }) {
  useEstadoDosPontos(state, pronto);
  return null;
}

async function montar(state: MeetingState, pronto = true) {
  const raiz = createRoot(document.createElement('div'));
  await act(async () => raiz.render(<Sonda state={state} pronto={pronto} />));
  const mudar = async (s: MeetingState, p = pronto) => act(async () => raiz.render(<Sonda state={s} pronto={p} />));
  return { mudar, fechar: () => act(async () => raiz.unmount()) };
}

const esperar = () => act(async () => new Promise((r) => setTimeout(r, 30)));

beforeEach(() => {
  installChromeStorageMock();
  atualizarEstadoDaReuniao.mockReset();
  atualizarEstadoDaReuniao.mockResolvedValue({ tipo: 'ok' });
});

describe('leitura ao encerrar', () => {
  it('não lê sem a pessoa ter pedido no perfil', async () => {
    await salvarPerfil(PERFIL, 0);
    const m = await montar(reuniao('recording'));
    await m.mudar(reuniao('ended'));
    await esperar();
    expect(atualizarEstadoDaReuniao).not.toHaveBeenCalled();
    await m.fechar();
  });

  it('lê uma única vez ao encerrar quando a pessoa pediu', async () => {
    await salvarPerfil({ ...PERFIL, lerAoEncerrar: true }, 0);
    const m = await montar(reuniao('recording'));
    await m.mudar(reuniao('ended'));
    await esperar();
    expect(atualizarEstadoDaReuniao).toHaveBeenCalledTimes(1);
    await m.mudar(reuniao('ended'));
    await esperar();
    expect(atualizarEstadoDaReuniao).toHaveBeenCalledTimes(1);
    await m.fechar();
  });

  it('não lê com o assistente desconectado', async () => {
    await salvarPerfil({ ...PERFIL, lerAoEncerrar: true }, 0);
    const m = await montar(reuniao('recording'), false);
    await m.mudar(reuniao('ended'), false);
    await esperar();
    expect(atualizarEstadoDaReuniao).not.toHaveBeenCalled();
    await m.fechar();
  });
});
