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
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import type { Conducao } from '@/features/conducao/store';
import type { MeetingRecord } from '@/shared/types/domain';

const proporPerfil = vi.fn();
vi.mock('@/features/conducao/proposta', () => ({ proporPerfil: (...a: unknown[]) => proporPerfil(...a) }));

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

it('sem IA, o resumo escrito à mão vale igual', async () => {
  await montar();
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

it('sem reuniões, a página diz isso em vez de oferecer um formulário vazio', async () => {
  await act(async () => root.render(<PaginaPreparar registros={[]} />));
  await esperar(() => host.querySelector('#tq-prep-reuniao') !== null);
  expect(host.textContent).toContain('Ainda não há reuniões');
  expect(host.querySelector('select')).toBeNull();
});
