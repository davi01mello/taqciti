/**
 * A página "Preparar": o resumo do assistente e o briefing da reunião.
 *
 * Seguram: nada é salvo até "Usar este assistente"; o resumo também se escreve
 * à mão, sem a IA; falha do modelo é dita e não vira perfil de exemplo; o
 * objetivo da reunião é da pessoa (sem objetivo, não há objetivo aprovado); e a
 * reunião preparada mantém a versão do assistente que usava.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { salvarPerfil, type Conducao } from '@/features/conducao/store';
import type { MeetingRecord } from '@/shared/types/domain';

const proporPerfil = vi.fn();
vi.mock('@/features/conducao/proposta', () => ({ proporPerfil: (...a: unknown[]) => proporPerfil(...a) }));
const reproduzirReuniao = vi.fn();
vi.mock('@/features/calibracao/historico', () => ({ reproduzirReuniao: (...a: unknown[]) => reproduzirReuniao(...a) }));

import { PaginaPreparar } from './Preparar';

let host: HTMLDivElement;
let root: Root;
let storage: ReturnType<typeof installChromeStorageMock>;

const q = <T extends Element>(s: string) => host.querySelector<T>(s)!;
const botao = (texto: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(texto));
const esperar = async (cond: () => boolean) => {
  for (let i = 0; i < 50 && !cond(); i += 1) await act(async () => new Promise((r) => setTimeout(r, 10)));
};
const digitar = async (el: HTMLInputElement | HTMLTextAreaElement, valor: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, valor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const campo = (rotulo: string) =>
  [...host.querySelectorAll<HTMLLabelElement>('label.tq-c-campo')]
    .find((l) => l.textContent?.includes(rotulo))!
    .querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;
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
  proporPerfil.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('organiza o texto da pessoa em resumo, mas só salva em "Usar este assistente"', async () => {
  proporPerfil.mockResolvedValue({
    tipo: 'ok',
    comentario: 'Entendi que você conduz reuniões de descoberta.',
    proposta: {
      missao: 'Entender a necessidade real do cliente.',
      observar: ['Impacto', 'Processo atual'],
      intervencao: { modo: 'discreto', estilo: 'Pergunta curta' },
      contexto: [],
      preferencias: [],
    },
  });
  await montar();

  await digitar(campo('Conte com suas palavras'), 'Conduzo reuniões de descoberta.');
  await act(async () => botao('Organizar')!.click());
  await esperar(() => (campo('Em que vou ajudar') as HTMLInputElement).value !== '');

  expect((campo('Em que vou ajudar') as HTMLInputElement).value).toBe('Entender a necessidade real do cliente.');
  expect(host.textContent).toContain('Entendi que você conduz reuniões de descoberta.');
  // A proposta ainda não é o assistente da pessoa.
  expect(conducao()?.perfil ?? null).toBeNull();

  await act(async () => botao('Usar este assistente')!.click());
  await esperar(() => !!conducao()?.perfil);
  expect(conducao()!.perfil).toMatchObject({ revisao: 1, missao: 'Entender a necessidade real do cliente.' });
  expect(conducao()!.perfil!.observar).toEqual(['Impacto', 'Processo atual']);
});

it('"ler ao encerrar" é opção da pessoa: vem desligada e só vale depois de salva', async () => {
  proporPerfil.mockResolvedValue({
    tipo: 'ok',
    comentario: '',
    proposta: { missao: 'Apoiar reuniões.', observar: [], intervencao: { modo: 'discreto', estilo: '' }, contexto: [], preferencias: [] },
  });
  await montar();
  const caixa = () => q<HTMLInputElement>('.tq-prep-opcao input');
  expect(caixa().checked).toBe(false);
  await act(async () => caixa().click());
  await digitar(campo('Conte com suas palavras'), 'Conduzo reuniões.');
  await act(async () => botao('Organizar')!.click());
  await esperar(() => (campo('Em que vou ajudar') as HTMLInputElement).value !== '');
  // A proposta do modelo não desfaz a escolha da pessoa.
  expect(caixa().checked).toBe(true);
  expect(conducao()?.perfil ?? null).toBeNull();
  await act(async () => botao('Usar este assistente')!.click());
  await esperar(() => !!conducao()?.perfil);
  expect(conducao()!.perfil!.lerAoEncerrar).toBe(true);
});

it('sem IA, o resumo escrito à mão vale igual', async () => {  await montar();
  await digitar(campo('Em que vou ajudar'), 'Apoiar reuniões de planejamento.');
  await act(async () => botao('Usar este assistente')!.click());
  await esperar(() => !!conducao()?.perfil);
  expect(conducao()!.perfil!.missao).toBe('Apoiar reuniões de planejamento.');
  expect(proporPerfil).not.toHaveBeenCalled();
});

it('falha do modelo é dita, com a saída de escrever à mão, e nada é salvo', async () => {
  proporPerfil.mockResolvedValue({ tipo: 'erro', codigo: 'limite_do_provedor', mensagem: 'A cota acabou.' });
  await montar();
  await digitar(campo('Conte com suas palavras'), 'qualquer coisa');
  await act(async () => botao('Organizar')!.click());
  await esperar(() => host.querySelector('[role="alert"]') !== null);
  expect(q('[role="alert"]').textContent).toMatch(/A cota acabou\..*à mão/);
  expect((campo('Em que vou ajudar') as HTMLInputElement).value).toBe('');
  expect(conducao()?.perfil ?? null).toBeNull();
});

it('"Usar este assistente" fica desligado sem a missão', async () => {
  await montar();
  expect(botao('Usar este assistente')!.disabled).toBe(true);
});

it('o briefing guarda o objetivo que a pessoa escreveu, e sem objetivo não há objetivo aprovado', async () => {
  await montar();
  await act(async () => {
    const sel = q<HTMLSelectElement>('select');
    sel.value = 'm-1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await esperar(() => host.textContent!.includes('O resultado que queremos alcançar'));

  await digitar(campo('O que já sabemos'), 'O cliente relatou filas, sem medição.');
  await act(async () => botao('Salvar a preparação')!.click());
  await esperar(() => (conducao()?.briefings.length ?? 0) === 1);
  expect(conducao()!.briefings[0]).toMatchObject({ reuniaoId: 'm-1', objetivo: '', aprovado: false });
  expect(host.textContent).toContain('o Taq não vai supor um');

  await digitar(campo('O resultado que queremos alcançar'), 'Decidir se o piloto começa com uma ou duas unidades.');
  await digitar(campo('O que não pode ficar sem encaminhamento'), 'Quem levanta os dados?\nQuando revisamos?');
  await act(async () => botao('Salvar a preparação')!.click());
  await esperar(() => conducao()!.briefings[0]!.aprovado);
  expect(conducao()!.briefings[0]).toMatchObject({
    objetivo: 'Decidir se o piloto começa com uma ou duas unidades.',
    prioridades: ['Quem levanta os dados?', 'Quando revisamos?'],
  });
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
    expect(r).toContain('sobre “Prazo da entrega” · falas 4, 5 · o Taq tinha lido até a fala 5');
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

describe('ajustes sugeridos e custo do apoio', () => {
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
      { missao: 'Apoiar a descoberta.', observar: [], intervencao: { modo: 'participativo', estilo: '' }, contexto: [], preferencias: [] },
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

  it('poucos retornos: diz que não há ajuste e que é preciso haver vários do mesmo tipo', async () => {
    await comPerfilParticipativo(retornos('descartada', 1, 1_000));
    await montar();
    expect(host.textContent).toContain('Ajustes sugeridos');
    expect(host.textContent).toContain('Nenhum ajuste por enquanto');
    expect(host.textContent).toContain('1 retorno');
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

  it('o custo do apoio medido na reunião aparece com contagens, tempo e tokens', async () => {
    await comPerfilParticipativo([], {
      medicoes: {
        'm-1': {
          avaliacoes: 4, silencios: 2, sugestoesGeradas: 2, retiradas: 1, recusadas: 0, erros: 1,
          latenciaTotalMs: 9000, tokensEntrada: 8000, tokensSaida: 900,
        },
      },
    });
    await montar();
    await act(async () => {
      const sel = q<HTMLSelectElement>('.tq-prep select');
      sel.value = 'm-1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await esperar(() => host.querySelector('[data-testid="custo-do-apoio"]') !== null);
    const t = host.querySelector('[data-testid="custo-do-apoio"]')!.textContent!;
    expect(t).toContain('4 avaliações');
    expect(t).toContain('2 com sugestão, 2 em silêncio, 1 com erro');
    expect(t).toContain('cerca de 3,0 s cada');
    expect(t).toContain((8900).toLocaleString('pt-BR'));
  });
});

it('o modo só desta reunião aparece com perfil salvo, é escolha explícita e não muda o perfil', async () => {
  await montar();
  await digitar(campo('Em que vou ajudar'), 'Apoiar reuniões de planejamento.');
  await act(async () => botao('Usar este assistente')!.click());
  await esperar(() => !!conducao()?.perfil);

  await act(async () => {
    const sel = q<HTMLSelectElement>('.tq-prep select');
    sel.value = 'm-1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await esperar(() => host.textContent!.includes('Como o Taq ajuda nesta reunião'));
  const seletor = [...host.querySelectorAll<HTMLSelectElement>('.tq-prep select')].find((s) =>
    s.parentElement?.textContent?.includes('Como o Taq ajuda nesta reunião'),
  )!;
  // Por padrão é o mesmo do assistente: o Taq não escolhe por ele.
  expect(seletor.value).toBe('');
  expect(seletor.options[0]!.textContent).toContain('O mesmo do meu assistente');

  await act(async () => {
    seletor.value = 'participativo';
    seletor.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => botao('Salvar a preparação')!.click());
  await esperar(() => (conducao()?.briefings.length ?? 0) === 1);
  expect(conducao()!.briefings[0]!.modo).toBe('participativo');
  expect(conducao()!.perfil!.intervencao.modo).toBe('discreto');
});

it('retomar: lista só encontros anteriores, a pessoa marca, e o vínculo é guardado por id', async () => {
  const anterior = {
    ...REUNIAO,
    id: 'm-0',
    title: 'Descoberta — 1º encontro',
    startedAt: new Date('2026-10-01T12:00:00Z').getTime(),
  } as unknown as MeetingRecord;
  const posterior = {
    ...REUNIAO,
    id: 'm-2',
    title: 'Descoberta — 3º encontro',
    startedAt: new Date('2026-10-20T12:00:00Z').getTime(),
  } as unknown as MeetingRecord;
  await act(async () => root.render(<PaginaPreparar registros={[anterior, REUNIAO, posterior]} />));
  await esperar(() => host.querySelector('#tq-prep-reuniao') !== null);
  await act(async () => {
    const sel = q<HTMLSelectElement>('select');
    sel.value = 'm-1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await esperar(() => host.textContent!.includes('Retomar de encontros anteriores'));

  const caixas = [...host.querySelectorAll<HTMLInputElement>('.tq-prep-modos input[type="checkbox"]')];
  const rotulos = caixas.map((c) => c.parentElement!.textContent);
  // Só o encontro ANTERIOR à reunião escolhida aparece: o posterior e a própria reunião não.
  expect(rotulos).toHaveLength(1);
  expect(rotulos[0]).toContain('Descoberta — 1º encontro');
  expect(host.textContent).toContain('o Taq não liga encontros por nome nem por semelhança');
  // Nada marcado por padrão: o Taq não escolhe por ele.
  expect(caixas[0]!.checked).toBe(false);

  await act(async () => caixas[0]!.click());
  await act(async () => botao('Salvar a preparação')!.click());
  await esperar(() => (conducao()?.briefings.length ?? 0) === 1);
  expect(conducao()!.briefings[0]!.retomar).toEqual(['m-0']);
});

it('sem reuniões, a página diz isso em vez de oferecer um formulário vazio', async () => {
  await act(async () => root.render(<PaginaPreparar registros={[]} />));
  await esperar(() => host.querySelector('#tq-prep-reuniao') !== null);
  expect(host.textContent).toContain('Ainda não há reuniões');
  expect(host.querySelector('select')).toBeNull();
});
