import { describe, expect, it, vi } from 'vitest';
import { cartaoSchema } from './contratos';
import { efeitosDoPedido } from './politica';
import { especialistaIndicado } from './roteamento';
import {
  capturarQuadroDaTela,
  nomeDoArquivoDaCaptura,
  type AmbienteDeCaptura,
} from './capturaDeTela';

function fluxoFalso() {
  const parar = vi.fn();
  const fluxo = { getTracks: () => [{ stop: parar }, { stop: parar }] } as unknown as MediaStream;
  return { fluxo, parar };
}

const QUADRO = { dataUrl: 'data:image/jpeg;base64,AAAA', largura: 1280, altura: 720 };

describe('capturarQuadroDaTela', () => {
  it('lê UM quadro e para o compartilhamento', async () => {
    const { fluxo, parar } = fluxoFalso();
    const lerQuadro: AmbienteDeCaptura['lerQuadro'] = vi.fn(async () => QUADRO);
    const getDisplayMedia = vi.fn(async (opcoes?: DisplayMediaStreamOptions) => {
      void opcoes;
      return fluxo;
    });

    const r = await capturarQuadroDaTela({ getDisplayMedia, lerQuadro });

    expect(r).toEqual({ ok: true, ...QUADRO, fonte: 'tela' });
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(lerQuadro).toHaveBeenCalledTimes(1);
    // As duas faixas foram paradas: nada continua capturando.
    expect(parar).toHaveBeenCalledTimes(2);
    // Sem áudio.
    expect(getDisplayMedia.mock.calls[0]![0]).toMatchObject({ audio: false });
  });

  it('cancelar o seletor é um desfecho, não um erro, e nada é lido', async () => {
    const lerQuadro = vi.fn(async () => QUADRO);
    const negou = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    const r = await capturarQuadroDaTela({
      getDisplayMedia: vi.fn(async () => {
        throw negou;
      }),
      lerQuadro,
    });
    expect(r).toEqual({ ok: false, motivo: 'cancelado' });
    expect(lerQuadro).not.toHaveBeenCalled();
  });

  it('outra recusa vira "recusado"; sem a API vira "sem_suporte"', async () => {
    const r = await capturarQuadroDaTela({
      getDisplayMedia: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    expect(r).toEqual({ ok: false, motivo: 'recusado' });
    vi.stubGlobal('navigator', {});
    try {
      expect(await capturarQuadroDaTela({})).toEqual({ ok: false, motivo: 'sem_suporte' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fonte que não entrega quadro: falha, e o fluxo é parado mesmo assim', async () => {
    const { fluxo, parar } = fluxoFalso();
    const r = await capturarQuadroDaTela({
      getDisplayMedia: vi.fn(async () => fluxo),
      lerQuadro: vi.fn(async () => null),
    });
    expect(r).toEqual({ ok: false, motivo: 'sem_quadro' });
    expect(parar).toHaveBeenCalledTimes(2);
  });
});

describe('o pedido de captura de tela', () => {
  it('"capture a tela" é pedido de interface e vai para o operador', () => {
    for (const pedido of ['Capture a tela.', 'Registre esta tela na reunião', 'tire um print', 'faça um screenshot']) {
      expect(efeitosDoPedido(pedido), pedido).toContain('interface');
      expect(especialistaIndicado(pedido, ['app_assistant', 'capture_monitor']), pedido).toBe('app_assistant');
    }
  });

  it('captura de legendas não é captura de tela', () => {
    expect(efeitosDoPedido('a captura está funcionando?')).not.toContain('interface');
    expect(especialistaIndicado('a captura está funcionando?', ['app_assistant', 'capture_monitor'])).toBe(
      'capture_monitor',
    );
  });
});

describe('contrato e nome de arquivo', () => {
  it('o cartão é válido com e sem reunião', () => {
    expect(cartaoSchema.safeParse({ tipo: 'captura_de_tela', reuniaoId: 'm-1', titulo: 'Daily', emAndamento: true }).success).toBe(true);
    expect(cartaoSchema.safeParse({ tipo: 'captura_de_tela', emAndamento: false }).success).toBe(true);
  });

  it('o nome do arquivo não carrega acento nem caractere perigoso', () => {
    const nome = nomeDoArquivoDaCaptura('Reunião: Planejamento/Q3 ../x', new Date(2026, 9, 5, 14, 3, 9).getTime());
    expect(nome).toBe('tela-Reuniao-Planejamento-Q3-x-20261005-140309.jpg');
  });
});
