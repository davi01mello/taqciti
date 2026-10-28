/**
 * A página "Preparar": os ajustes sugeridos e o teste numa reunião passada. O
 * mapa do assistente tem o próprio teste (`OQueLevar.test.tsx`).
 *
 * Seguram: a página não prepara uma reunião específica; ajuste só muda o
 * assistente pelo botão; e o teste numa reunião passada avisa que envia
 * trechos ao provedor e só roda quando a pessoa clica.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { salvarPerfil, type Conducao } from '@/features/conducao/store';
import type { MeetingRecord } from '@/shared/types/domain';

const reproduzirReuniao = vi.fn();
vi.mock('@/features/calibracao/historico', () => ({ reproduzirReuniao: (...a: unknown[]) => reproduzirReuniao(...a) }));

import { PaginaPreparar } from './Preparar';

let host: HTMLDivElement;
let root: Root;
let storage: ReturnType<typeof installChromeStorageMock>;

const botao = (texto: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(texto));
const esperar = async (cond: () => boolean) => {
  for (let i = 0; i < 50 && !cond(); i += 1) await act(async () => new Promise((r) => setTimeout(r, 10)));
};
const conducao = () => storage.local.values[STORAGE_KEYS.conducao] as Conducao | undefined;

const REUNIAO = {
  id: 'm-1',
  title: 'Descoberta com a Prefeitura',
  startedAt: new Date('2026-10-06T12:00:00Z').getTime(),
  segments: [],
} as unknown as MeetingRecord;

async function montar() {
  await act(async () => root.render(<PaginaPreparar registros={[REUNIAO]} />));
  await esperar(() => host.querySelector('#tq-prep-perfil') !== null);
}

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
});

/*
 * 23/10/2026: o Preparar é 100% válido para todas as reuniões. Não há mais
 * escolher uma reunião para preparar (objetivo, prioridades, retomar) nem o
 * custo do apoio por reunião.
 */
it('não prepara uma reunião específica: nada de seletor de reunião nem briefing', async () => {
  await montar();
  expect(host.textContent).not.toContain('Preparar uma reunião');
  expect(host.textContent).not.toContain('Salvar a preparação');
  expect(host.textContent).not.toContain('Escolha uma reunião');
  expect(host.querySelector('[data-testid="custo-do-apoio"]')).toBeNull();
});

describe('testar o assistente numa reunião passada', () => {
  const COM_FALAS = {
    ...REUNIAO,
    id: 'm-9',
    title: 'Planejamento passado',
    segments: Array.from({ length: 8 }, (_, i) => ({
      captionId: `c${i}`,
      speaker: 'Ana',
      text: `Fala ${i} sobre o planejamento da sprint.`,
      startOffsetMs: i * 20_000,
      endOffsetMs: i * 20_000 + 5_000,
    })),
  } as unknown as MeetingRecord;
  const comPerfil = async () =>
    salvarPerfil(
      { missao: 'Apoiar o planejamento.', observar: [], intervencao: { modo: 'discreto', estilo: '' }, contexto: [], preferencias: [] },
      0,
    );
  const montarCom = async (registros: MeetingRecord[]) => {
    await act(async () => root.render(<PaginaPreparar registros={registros} />));
    await esperar(() => host.querySelector('#tq-prep-reuniao') !== null);
  };
  const escolher = async () => {
    const sel = [...host.querySelectorAll<HTMLSelectElement>('select')].find((s) =>
      s.parentElement?.textContent?.includes('Reunião para reproduzir'),
    )!;
    await act(async () => {
      sel.value = 'm-9';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  it('só aparece com perfil salvo e com reunião que tenha falas, e avisa que envia trechos ao provedor', async () => {
    reproduzirReuniao.mockReset();
    await montarCom([COM_FALAS]);
    expect(host.textContent).not.toContain('Testar o assistente numa reunião passada');
    await comPerfil();
    await esperar(() => host.textContent!.includes('Testar o assistente numa reunião passada'));
    expect(host.textContent).toContain('Envia trechos da reunião ao provedor de IA');
    expect(host.textContent).toContain('só roda quando você clica');
    // Reunião sem falas suficientes não é candidata.
    await montarCom([REUNIAO]);
    expect(host.textContent).not.toContain('Reunião para reproduzir');
    expect(reproduzirReuniao).not.toHaveBeenCalled();
  });

  it('reproduz e mostra o relatório: o que sugeriria, quando, sobre o quê, com a fonte e até onde o Taq tinha lido', async () => {
    reproduzirReuniao.mockReset();
    reproduzirReuniao.mockImplementation(async (p: { aoAndar: (f: number, t: number) => void }) => {
      p.aoAndar(1, 2);
      p.aoAndar(2, 2);
      return {
        reuniaoId: 'm-9',
        passos: 2,
        avaliacoes: 2,
        sugestoesGeradas: 1,
        sugestoesMostradas: 1,
        erros: 0,
        paradoPeloTeto: false,
        fontesValidas: true,
        linhas: [
          { noInstanteMs: 60_000, falasVistas: 4, falasConsolidadas: 2, acao: 'silencio', chamouOModelo: true },
          {
            noInstanteMs: 120_000,
            falasVistas: 7,
            falasConsolidadas: 5,
            acao: 'mostrou',
            chamouOModelo: true,
            sugestao: { tipo: 'pergunta', ponto: 'Prazo da entrega', texto: 'Vale esclarecer o prazo.', pergunta: 'Qual é o prazo da entrega?', falasCitadas: [3, 4] },
          },
        ],
      };
    });
    await comPerfil();
    await montarCom([COM_FALAS]);
    await esperar(() => host.textContent!.includes('Reunião para reproduzir'));
    await escolher();
    await act(async () => botao('Reproduzir')!.click());
    await esperar(() => host.querySelector('[aria-label="Relatório do teste"]') !== null);

    const r = host.querySelector('[aria-label="Relatório do teste"]')!.textContent!;
    expect(r).toContain('2 avaliações, 1 sugestão que apareceria');
    expect(r).toContain('Todas as fontes citadas existiam no corte');
    expect(r).toContain('1:00 — Silêncio');
    expect(r).toContain('2:00 — Sugeriria');
    expect(r).toContain('“Qual é o prazo da entrega?”');
    expect(r).toContain('sobre “Prazo da entrega” · falas 4, 5 · o assistente tinha lido até a fala 5');
    // O teste usa a reunião escolhida e a transcrição dela, nunca grava nada na reunião.
    const arg = reproduzirReuniao.mock.calls[0]![0] as { reuniao: { id: string }; falas: unknown[] };
    expect(arg.reuniao.id).toBe('m-9');
    expect(arg.falas).toHaveLength(8);
  });

  it('cancelar aborta o teste, e um erro do reprodutor é dito', async () => {
    reproduzirReuniao.mockReset();
    let sinal: AbortSignal | undefined;
    let liberar!: () => void;
    reproduzirReuniao.mockImplementation(
      (p: { sinal: AbortSignal }) =>
        new Promise((resolve) => {
          sinal = p.sinal;
          liberar = () => resolve({ reuniaoId: 'm-9', passos: 0, avaliacoes: 0, sugestoesGeradas: 0, sugestoesMostradas: 0, erros: 0, paradoPeloTeto: false, fontesValidas: true, linhas: [] });
        }),
    );
    await comPerfil();
    await montarCom([COM_FALAS]);
    await esperar(() => host.textContent!.includes('Reunião para reproduzir'));
    await escolher();
    await act(async () => botao('Reproduzir')!.click());
    await esperar(() => botao('Cancelar') !== undefined);
    expect(botao('Reproduzir')).toBeUndefined(); // desligado: virou "Reproduzindo…"
    await act(async () => botao('Cancelar')!.click());
    expect(sinal!.aborted).toBe(true);
    await act(async () => liberar());

    reproduzirReuniao.mockReset();
    reproduzirReuniao.mockRejectedValue(new Error('O provedor caiu.'));
    await escolher();
    await act(async () => botao('Reproduzir')!.click());
    await esperar(() => host.querySelector('[role="alert"]') !== null);
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('O provedor caiu.');
  });
});

describe('ajustes sugeridos', () => {
  const retornos = (tipo: string, quantos: number, desde: number) =>
    Array.from({ length: quantos }, (_, i) => ({
      id: `f-${tipo}-${desde}-${i}`,
      sugestaoId: `s-${i}`,
      reuniaoId: 'm-1',
      em: desde + i * 1000,
      tipo,
      alcance: 'agora',
    }));
  const comPerfilParticipativo = async (feedback: unknown[], extra: Record<string, unknown> = {}) => {
    await salvarPerfil(
      { base: 'personalizado', intervencao: { modo: 'participativo' }, contextos: [{ nome: 'Em que ajudar', texto: 'Apoiar a descoberta.', vaga: 0 }] },
      0,
    );
    await chrome.storage.local.set({
      [STORAGE_KEYS.apoio]: { versao: 1, sugestoes: [], feedback, pausadas: {}, medicoes: {}, ajustes: {}, ...extra },
    });
  };

  it('sem retorno nenhum, a seção nem aparece', async () => {
    await comPerfilParticipativo([]);
    await montar();
    expect(host.textContent).not.toContain('Ajustes sugeridos');
  });

  // A explicação "você deu N retornos…" saiu em 18/10/2026 (auto-explicação);
  // fica a frase de estado.
  it('poucos retornos: diz que não há ajuste', async () => {
    await comPerfilParticipativo(retornos('descartada', 1, 1_000));
    await montar();
    expect(host.textContent).toContain('Ajustes sugeridos');
    expect(host.textContent).toContain('Nenhum ajuste por enquanto');
    expect(botao('Aplicar ao meu assistente')).toBeUndefined();
  });

  it('descartes demais: mostra o porquê com os números e o antes → depois; só o botão aplica', async () => {
    await comPerfilParticipativo(retornos('descartada', 3, 1_000));
    await montar();
    expect(host.textContent).toContain('Sugerir menos vezes');
    expect(host.textContent).toContain('3 dos seus últimos 3 retornos');
    expect(host.textContent).toContain('Hoje: Participativo');
    expect(host.textContent).toContain('Passaria a: Discreto');
    // Nada mudou só por a proposta existir.
    expect(conducao()!.perfil!.intervencao.modo).toBe('participativo');

    await act(async () => botao('Aplicar ao meu assistente')!.click());
    await esperar(() => conducao()!.perfil!.intervencao.modo === 'discreto');
    expect(conducao()!.perfil!.revisao).toBe(2);
    expect(conducao()!.perfil!.historico.at(-1)!.acao).toContain('proposto pelo Taq e aprovado');
    // Decidida, a proposta some até haver retorno novo.
    await esperar(() => !host.textContent!.includes('Passaria a:'));
    expect(host.textContent).not.toContain('Passaria a:');
  });

  it('"Agora não" recusa sem mudar o perfil, e a proposta não volta', async () => {
    await comPerfilParticipativo(retornos('descartada', 3, 1_000));
    await montar();
    await act(async () => botao('Agora não')!.click());
    await esperar(() => !host.textContent!.includes('Passaria a:'));
    expect(conducao()!.perfil!.intervencao.modo).toBe('participativo');
    expect(conducao()!.perfil!.revisao).toBe(1);
    expect(host.textContent).toContain('Nenhum ajuste por enquanto');
  });
});

