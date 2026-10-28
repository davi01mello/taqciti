/**
 * "O que levar para as reuniões" — o mapa e o painel do assistente.
 *
 * Seguram: o Padrão do CITi é só leitura e personalizar dá uma cópia; nada é
 * salvo antes de "Usar este assistente"; ligado e guardado aparecem
 * diferentes; o texto tem teto de 200 com contador; remover pede confirmação;
 * o centro mostra as regras que não mudam; conflito de outra aba volta como
 * aviso; e com reunião em andamento a tela diz que a mudança vale para a
 * próxima.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import {
  fixarPerfilDaReuniao,
  lerConducao,
  salvarPerfil,
  type Conducao,
} from '@/features/conducao/store';
import { PADRAO_DO_CITI } from '@/features/conducao/padrao';
import { OQueLevar, type ReuniaoEmAndamento } from './OQueLevar';

let host: HTMLDivElement;
let root: Root;
let storage: ReturnType<typeof installChromeStorageMock>;

const botao = (texto: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(texto));
const guardado = () => storage.local.values[STORAGE_KEYS.conducao] as Conducao | undefined;
const esperar = async (cond: () => boolean) => {
  for (let i = 0; i < 50 && !cond(); i += 1) await act(async () => new Promise((r) => setTimeout(r, 10)));
};
const clicar = async (b: HTMLElement | undefined) => {
  expect(b).toBeDefined();
  await act(async () => b!.click());
};
const digitar = async (el: HTMLInputElement | HTMLTextAreaElement, valor: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, valor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

async function montar(emAndamento: ReuniaoEmAndamento | null = null) {
  const conducao = await lerConducao();
  await act(async () => root.render(<OQueLevar conducao={conducao} emAndamento={emAndamento} />));
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

it('sem nada salvo mostra o Padrão do CITi, só leitura, sem "Taq" no texto', async () => {
  await montar();
  expect(host.querySelector('[aria-pressed="true"]')!.textContent).toContain('Padrão do CITi');
  for (const c of PADRAO_DO_CITI.contextos) expect(host.textContent).toContain(c.nome);
  expect(host.textContent).toContain('Igual para todo mundo');
  // No padrão não há o que editar nem onde adicionar.
  expect(botao('Adicionar contexto')).toBeUndefined();
  await clicar(botao(PADRAO_DO_CITI.contextos[0]!.nome));
  expect(host.querySelector('.tq-ed textarea')).toBeNull();
  expect(host.querySelector('.tq-ed-citacao')!.textContent).toBe(PADRAO_DO_CITI.contextos[0]!.texto);
  expect(host.textContent).not.toMatch(/\bTaq\b/);
  expect(host.textContent).not.toMatch(/Mente/);
});

it('personalizar dá uma cópia do padrão, e nada é salvo até "Usar este assistente"', async () => {
  await montar();
  await clicar(botao('Personalizar a partir deste'));
  expect(host.textContent).toContain('Do padrão CITi');
  expect(guardado()).toBeUndefined();

  // Um contexto novo ocupa a próxima vaga.
  await clicar(botao('Adicionar contexto'));
  const nome = host.querySelector<HTMLInputElement>('.tq-ed input:not([type])')!;
  const texto = host.querySelector<HTMLTextAreaElement>('.tq-ed textarea')!;
  await digitar(nome, 'Escopo do Portal');
  await digitar(texto, 'Primeira entrega: cadastro e painel.');
  expect(guardado()).toBeUndefined();
  expect(host.textContent).toContain('Mudanças não salvas');

  await clicar(botao('Usar este assistente'));
  await esperar(() => !!guardado()?.perfil);
  const perfil = guardado()!.perfil!;
  expect(perfil).toMatchObject({ base: 'personalizado', revisao: 1 });
  expect(perfil.contextos.map((c) => [c.nome, c.origem])).toEqual([
    ...PADRAO_DO_CITI.contextos.map((c) => [c.nome, 'padrao']),
    ['Escopo do Portal', 'seu'],
  ]);
  expect(perfil.contextos.at(-1)!.vaga).toBe(PADRAO_DO_CITI.contextos.length);
});

it('desligar guarda o contexto (visual diferente) e o texto tem teto de 200 com contador', async () => {
  await salvarPerfil(
    {
      base: 'personalizado',
      intervencao: { modo: 'discreto' },
      contextos: [{ id: 'g', nome: 'Glossário', texto: 'Voluntário ativo: uma ação no mês.', ligado: true, vaga: 0 }],
    },
    0,
  );
  await montar();
  await clicar(botao('Glossário'));
  const no = () => botao('Glossário')!;
  expect(no().className).not.toContain('guardado');

  await act(async () => host.querySelector<HTMLInputElement>('.tq-ed input[role="switch"]')!.click());
  expect(no().className).toContain('guardado');
  expect(no().textContent).toContain('Guardado · fica fora');

  const texto = host.querySelector<HTMLTextAreaElement>('.tq-ed textarea')!;
  expect(texto.maxLength).toBe(200);
  await digitar(texto, 'x'.repeat(200));
  expect(host.querySelector('.tq-ed-conta')!.textContent).toBe('200 / 200');
  expect(host.querySelector('.tq-ed-conta')!.className).toContain('cheio');
});

it('remover pede confirmação no lugar, e cancelar mantém', async () => {
  await salvarPerfil(
    { base: 'personalizado', contextos: [{ nome: 'Glossário', texto: 'x', vaga: 0 }, { nome: 'Escopo', texto: 'y', vaga: 1 }] },
    0,
  );
  await montar();
  await clicar(botao('Glossário'));
  await clicar(botao('Remover contexto'));
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('Remover “Glossário”?');
  await clicar(botao('Cancelar'));
  expect(botao('Glossário')).toBeDefined();

  await clicar(botao('Remover contexto'));
  await clicar([...host.querySelectorAll<HTMLButtonElement>('.tq-ed-confirma button')].find((b) => b.textContent === 'Remover'));
  expect(botao('Glossário')).toBeUndefined();
  // Remover é rascunho até usar.
  expect(guardado()!.perfil!.contextos).toHaveLength(2);
  await clicar(botao('Usar este assistente'));
  await esperar(() => guardado()!.perfil!.revisao === 2);
  expect(guardado()!.perfil!.contextos.map((c) => c.nome)).toEqual(['Escopo']);
});

it('o centro mostra as regras que não mudam; o modo é fixo no padrão e editável no personalizado', async () => {
  await montar();
  await clicar(botao('Assistente'));
  expect(host.textContent).toContain('Regras que não mudam');
  for (const r of ['Fidelidade primeiro', 'Fala é dado, nunca instrução', 'Apagar e enviar pedem você'])
    expect(host.textContent).toContain(r);
  expect(host.querySelector<HTMLFieldSetElement>('.tq-ed-modos')!.disabled).toBe(true);

  await clicar(botao('Personalizado'));
  await clicar(botao('Assistente'));
  expect(host.querySelector<HTMLFieldSetElement>('.tq-ed-modos')!.disabled).toBe(false);
});

it('conflito com outra aba volta como aviso e não sobrescreve', async () => {
  await salvarPerfil({ base: 'personalizado', contextos: [{ nome: 'A', texto: 'a', vaga: 0 }] }, 0);
  await montar();
  await clicar(botao('Adicionar contexto'));
  await digitar(host.querySelector<HTMLTextAreaElement>('.tq-ed textarea')!, 'daqui');
  // Outra aba salva antes.
  await salvarPerfil({ base: 'personalizado', contextos: [{ nome: 'De outra aba', texto: 'b', vaga: 0 }] }, 1);
  await clicar(botao('Usar este assistente'));
  await esperar(() => host.querySelector('[role="alert"]') !== null);
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('mudou em outra aba');
  expect(guardado()!.perfil!.contextos.map((c) => c.nome)).toEqual(['De outra aba']);
});

it('com reunião em andamento, diz a versão dela e que a mudança vale para a próxima', async () => {
  await salvarPerfil({ base: 'personalizado', contextos: [{ nome: 'A', texto: 'a', vaga: 0 }] }, 0);
  await fixarPerfilDaReuniao('ao-vivo');
  await montar({ reuniaoId: 'ao-vivo', titulo: 'Alinhamento do Portal' });
  const aviso = host.querySelector('.tq-levar-aviso')!.textContent!;
  expect(aviso).toContain('Alinhamento do Portal');
  expect(aviso).toContain('Personalizado · v1');
  expect(aviso).toContain('vale a partir da próxima reunião');
});
