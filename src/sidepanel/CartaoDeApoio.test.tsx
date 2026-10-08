/**
 * O cartão de apoio — storage real (mock), dados sintéticos.
 *
 * Seguram: sem perfil ou "só quando eu chamar" não há cartão; a sugestão vem
 * rotulada e a pergunta diz que não é fala registrada; cada gesto muda o estado
 * e deixa o feedback; "Ver fonte" mostra as falas; pausar liga e desliga; e uma
 * guardada só volta se nada estiver na tela.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { lerApoio, mudarEstado, registrarSugestao, type Apoio } from '@/features/apoio/store';
import type { ApoioAoVivo } from '@/features/apoio/useApoio';
import { CartaoDeApoio } from './CartaoDeApoio';

let host: HTMLDivElement;
let root: Root;
let storage: ReturnType<typeof installChromeStorageMock>;

const botao = (texto: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(texto));
const esperar = async (cond: () => boolean) => {
  for (let i = 0; i < 40 && !cond(); i += 1) await act(async () => new Promise((r) => setTimeout(r, 10)));
};

async function sugerir(ponto: string, extra: Partial<Parameters<typeof registrarSugestao>[0]> = {}) {
  const r = await registrarSugestao({
    reuniaoId: 'm-1',
    revisao: 12,
    tipo: 'pergunta',
    natureza: 'recomendacao',
    texto: `Vale esclarecer ${ponto}.`,
    pergunta: `Como funciona ${ponto} hoje?`,
    motivo: 'O cliente propôs uma solução antes de descrever o problema.',
    ponto,
    evidencias: [{ segmento: 9, trecho: 'Acho que precisamos de um aplicativo.' }],
    ...extra,
  });
  if (r.tipo !== 'ok') throw new Error('esperava ok');
  return r.sugestao;
}

const aoVivo = (a: Apoio, modo: ApoioAoVivo['modo'] = 'discreto'): ApoioAoVivo => {
  const doMeeting = a.sugestoes.filter((s) => s.reuniaoId === 'm-1');
  return {
    naTela: doMeeting.find((s) => s.estado === 'mostrada') ?? null,
    guardadas: doMeeting.filter((s) => s.estado === 'guardada'),
    pausado: a.pausadas['m-1'] === true,
    modo,
  };
};

async function montar(modo: ApoioAoVivo['modo'] = 'discreto') {
  const a = await lerApoio();
  await act(async () => root.render(<CartaoDeApoio meetingId="m-1" apoio={aoVivo(a, modo)} />));
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

it('sem perfil ou no modo "só quando eu chamar", não há cartão nem linha', async () => {
  const s = await sugerir('a espera');
  await mudarEstado(s.id, 'mostrada');
  await montar(null);
  expect(host.textContent).toBe('');
  await montar('sob_demanda');
  expect(host.textContent).toBe('');
});

it('sem sugestão, só a linha quieta com a pausa: o silêncio é o estado normal', async () => {
  await montar();
  expect(host.querySelector('.tq-apoio-cartao')).toBeNull();
  expect(host.textContent).toContain('Apoio discreto');
  expect(botao('Pausar sugestões')).toBeTruthy();
});

it('a sugestão vem rotulada, e a pergunta diz que não é uma fala registrada', async () => {
  const s = await sugerir('a espera', { natureza: 'inferencia' });
  await mudarEstado(s.id, 'mostrada');
  await montar();
  expect(host.textContent).toContain('Pergunta sugerida');
  expect(host.textContent).toContain('Interpretação');
  expect(host.textContent).toContain('Sugestão de pergunta — não é uma fala registrada');
  expect(host.textContent).toContain('“Como funciona a espera hoje?”');
  expect(host.textContent).toContain('O cliente propôs uma solução');
});

it('"Ver fonte" mostra as falas que sustentam; fechada por padrão', async () => {
  const s = await sugerir('a espera');
  await mudarEstado(s.id, 'mostrada');
  await montar();
  expect(host.querySelector('.tq-apoio-fonte')).toBeNull();
  await act(async () => botao('Ver fonte')!.click());
  expect(host.querySelector('.tq-apoio-fonte')!.textContent).toContain('Fala 10');
  expect(host.querySelector('.tq-apoio-fonte')!.textContent).toContain('Acho que precisamos de um aplicativo.');
});

it('"Usei esta pergunta" marca como usada e deixa feedback útil, sem dizer que foi respondida', async () => {
  const s = await sugerir('a espera');
  await mudarEstado(s.id, 'mostrada');
  await montar();
  await act(async () => botao('Usei esta pergunta')!.click());
  await esperar(() => storage.local.values[STORAGE_KEYS.apoio] !== undefined && (storage.local.values[STORAGE_KEYS.apoio] as Apoio).feedback.length === 1);
  const { sugestoes, feedback } = await lerApoio();
  expect(sugestoes[0]).toMatchObject({ estado: 'usada', encerradaPor: 'pessoa' });
  expect(feedback[0]).toMatchObject({ tipo: 'util', alcance: 'agora' });
});

it('cada gesto leva ao estado e ao feedback certos', async () => {
  const casos: Array<[string, string, string]> = [
    ['Isso já foi resolvido', 'resolvida', 'ja_respondido'],
    ['Guardar para depois', 'guardada', 'adiada'],
    ['Descartar', 'descartada', 'descartada'],
  ];
  for (const [rotulo, estado, tipo] of casos) {
    installChromeStorageMock();
    const s = await sugerir(`ponto ${rotulo}`);
    await mudarEstado(s.id, 'mostrada');
    await montar();
    await act(async () => botao(rotulo)!.click());
    await esperar(() => false || true);
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    const { sugestoes, feedback } = await lerApoio();
    expect(sugestoes[0]!.estado, rotulo).toBe(estado);
    expect(feedback[0]!.tipo, rotulo).toBe(tipo);
  }
});

it('pausar e retomar gravam a pausa daquela reunião', async () => {
  await montar();
  await act(async () => botao('Pausar sugestões')!.click());
  await act(async () => new Promise((r) => setTimeout(r, 30)));
  expect((await lerApoio()).pausadas).toEqual({ 'm-1': true });
  await montar();
  expect(host.textContent).toContain('pausado');
  await act(async () => botao('Retomar sugestões')!.click());
  await act(async () => new Promise((r) => setTimeout(r, 30)));
  expect((await lerApoio()).pausadas).toEqual({});
});

it('guardadas: listadas à parte, e só voltam com a tela livre', async () => {
  const g = await sugerir('o prazo');
  await mudarEstado(g.id, 'mostrada');
  await mudarEstado(g.id, 'guardada', 'pessoa');
  await montar();
  expect(host.querySelector('.tq-apoio-cartao')).toBeNull();
  await act(async () => botao('Guardadas para depois (1)')!.click());
  expect(host.textContent).toContain('Como funciona o prazo hoje?');
  const mostrar = botao('Mostrar agora')!;
  expect(mostrar.disabled).toBe(false);

  // Com outra sugestão na tela, "Mostrar agora" fica desligado.
  const outra = await sugerir('a espera');
  await mudarEstado(outra.id, 'mostrada');
  await montar();
  // A lista continua aberta: é a mesma instância, só com sugestões novas.
  expect(botao('Mostrar agora')!.disabled).toBe(true);
});
