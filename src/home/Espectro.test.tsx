/**
 * O que a direção "Espectro" acrescentou à HOME e que é fácil de regredir:
 *
 *  1. o acompanhamento registra à mão ("Novo") e exclui confirmando no lugar;
 *  2. a carta NÃO finge envio: sem canal conectado, "Enviar" fica desligado e
 *     a própria carta diz o que falta;
 *  3. o pedido livre da caixinha da IA vai para a conversa, não para um tipo
 *     de documento escolhido por suposição.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import type { MeetingRecord } from '@/shared/types/domain';
import type { Trabalho } from '@/features/trabalho/store';
import { PaginaAcompanhamento } from './Acompanhamento';
import { Carta } from './Carta';
import { GerarDocumento } from './GerarDocumento';

let host: HTMLDivElement;
let root: Root;
let storage: ReturnType<typeof installChromeStorageMock>;

const q = <T extends Element>(s: string) => host.querySelector<T>(s)!;
const porTexto = (s: string, texto: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(s)].find((b) => b.textContent?.includes(texto));
const esperar = async (cond: () => boolean) => {
  for (let i = 0; i < 50 && !cond(); i += 1)
    await act(async () => new Promise((r) => setTimeout(r, 10)));
};
const digitar = async (el: HTMLInputElement, valor: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, valor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

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

const trabalho = () => storage.local.values[STORAGE_KEYS.trabalho] as Trabalho | undefined;

it('"Novo" registra um compromisso à mão, e excluir pede confirmação no lugar', async () => {
  await act(async () => root.render(<PaginaAcompanhamento onAbrirFonte={() => {}} />));
  await esperar(() => host.querySelector('.tq-acomp-novo') !== null);

  await act(async () => q<HTMLButtonElement>('.tq-acomp-novo').click());
  const campos = [...host.querySelectorAll<HTMLInputElement>('.tq-acomp-form input')];
  await digitar(campos[0]!, 'Revisar o contrato');
  await digitar(campos[1]!, 'Carla');
  await act(async () => q<HTMLFormElement>('.tq-acomp-form').requestSubmit());
  await esperar(() => (trabalho()?.compromissos.length ?? 0) === 1);

  const c = trabalho()!.compromissos[0]!;
  expect(c.descricao).toBe('Revisar o contrato');
  expect(c.responsavel).toEqual({ nome: 'Carla', confirmado: true });
  // Nasceu da pessoa, sem trecho de reunião inventado.
  expect(c.evidencias).toEqual([]);
  expect(c.historico[0]!.origem).toBe('pessoa');

  await esperar(() => host.textContent!.includes('Revisar o contrato'));
  await act(async () => q<HTMLButtonElement>('.tq-acomp-lixo').click());
  // O primeiro clique só pergunta.
  expect(trabalho()!.compromissos).toHaveLength(1);
  expect(q('.tq-acomp-confirma').textContent).toContain('Revisar o contrato');

  await act(async () => porTexto('.tq-acomp-confirma button', 'Excluir')!.click());
  await esperar(() => trabalho()!.compromissos.length === 0);
  expect(trabalho()!.compromissos).toHaveLength(0);
});

it('a carta não envia sem canal conectado, e diz isso nela mesma', async () => {
  const irConexoes = vi.fn();
  await act(async () =>
    root.render(<Carta assunto="Ata" corpo="Oi" onFechar={() => {}} onIrConexoes={irConexoes} />),
  );

  expect(q<HTMLButtonElement>('.tq-carta-enviar').disabled).toBe(true);
  expect(q('.tq-carta-aviso').textContent).toContain('conecte o Gmail');

  await act(async () => porTexto('.tq-carta-canais button', 'Mensagem')!.click());
  expect(q('.tq-carta-aviso').textContent).toContain('conecte o WhatsApp');
  expect(q<HTMLButtonElement>('.tq-carta-enviar').disabled).toBe(true);

  await act(async () => q<HTMLButtonElement>('.tq-carta-aviso button').click());
  expect(irConexoes).toHaveBeenCalled();
});

it('o pedido livre da caixinha da IA segue como texto, sem gerar nada', async () => {
  const registro: MeetingRecord = {
    id: 'm-1',
    title: 'Planning',
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
  const pedir = vi.fn();
  await act(async () =>
    root.render(
      <GerarDocumento registro={registro} onAbrirDocumento={() => {}} onPedirLivre={pedir} />,
    ),
  );
  await act(async () => porTexto('button', 'Criar documento')!.click());
  expect(q('.tq-caixa-ia').textContent).toContain('Qual documento você quer criar?');

  await digitar(q<HTMLInputElement>('.tq-caixa-ia-campo input'), 'um resumo para o cliente');
  await act(async () => q<HTMLFormElement>('.tq-caixa-ia-campo').requestSubmit());

  expect(pedir).toHaveBeenCalledWith('um resumo para o cliente');
  expect(host.querySelector('.tq-caixa-ia')).toBeNull();
});
