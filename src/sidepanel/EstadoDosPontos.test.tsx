/**
 * O cartão "O que falta fechar" — storage real (mock), dados sintéticos.
 *
 * Seguram: o estado de cada ponto vem rotulado e ordenado pelo que pede mais
 * atenção; responsável e prazo ausentes aparecem como não definidos; "Ver
 * fonte" mostra as falas; a correção da pessoa é gravada; e o botão atualizar
 * só vale com o assistente conectado.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import type { ResultadoDoRegistro } from '@/features/estado/registrar';
import { lerEstados, snapshotInicial, transacaoDoEstado, mesclar, type Ponto, type Snapshot } from '@/features/estado/store';
import type { EstadoDaReuniao } from '@/features/estado/useEstado';
import { EstadoDosPontos } from './EstadoDosPontos';

let host: HTMLDivElement;
let root: Root;

const TRANSCRICAO = [
  { speaker: 'Ana', text: 'Em que momento o atendimento costuma travar hoje?' },
  { speaker: 'Cliente', text: 'Na triagem. A fila da triagem passa de uma hora quase todo dia.' },
  { speaker: 'Cliente', text: 'A Marta consegue levantar esses dados até sexta-feira, pode ficar com ela.' },
];

function snapshot(): Snapshot {
  const s = snapshotInicial('m-1', ['Onde ocorre a espera', 'Com que frequência', 'Quem levanta os dados e quando'], 0, 1);
  const ids = s.pontos.map((p) => p.id);
  return mesclar({
    anterior: s,
    corte: 3,
    agora: 2,
    transcricao: TRANSCRICAO,
    proposta: {
      assunto: { texto: 'Quem levanta os dados', falas: [2] },
      pontos: [
        { id: ids[0]!, estado: 'discutido', falas: [1], nota: 'parece que é na triagem' },
        { id: ids[2]!, estado: 'a_confirmar', falas: [2], dono: 'Marta', prazo: 'sexta-feira' },
      ],
    },
  }).snapshot;
}

const estado = (s: Snapshot | null, extra: Partial<EstadoDaReuniao> = {}): EstadoDaReuniao => ({
  snapshot: s,
  atualizando: false,
  erro: null,
  lidoAte: s?.revisao ?? null,
  atualizar: async () => undefined,
  ...extra,
});

const render = async (e: EstadoDaReuniao, extra: { aberto?: boolean; taqPronto?: boolean } = {}) =>
  act(async () =>
    root.render(
      <EstadoDosPontos
        meetingId="m-1"
        estado={e}
        aberto={extra.aberto ?? true}
        onAlternar={() => undefined}
        taqPronto={extra.taqPronto ?? true}
      />,
    ),
  );
const botao = (t: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(t));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installChromeStorageMock();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('fechado, mostra só a contagem dos pontos em aberto', async () => {
  await render(estado(snapshot()), { aberto: false });
  expect(host.textContent).toContain('O que falta fechar');
  expect(host.textContent).toContain('3 em aberto');
  expect(host.querySelector('.tq-estado-lista')).toBeNull();
});

it('os pontos vêm ordenados pelo que pede atenção: a confirmar, a esclarecer, discutido', async () => {
  await render(estado(snapshot()));
  const textos = [...host.querySelectorAll('.tq-estado-texto')].map((n) => n.textContent);
  expect(textos).toEqual(['Quem levanta os dados e quando', 'Com que frequência', 'Onde ocorre a espera']);
  expect([...host.querySelectorAll<HTMLSelectElement>('select')].map((s) => s.value)).toEqual([
    'a_confirmar',
    'a_esclarecer',
    'discutido',
  ]);
});

it('responsável e prazo aparecem quando a fala trouxe, e como "não definido" quando não', async () => {
  const s = snapshot();
  await render(estado(s));
  const dados = [...host.querySelectorAll('.tq-estado-ponto')].find((n) => n.textContent?.includes('Quem levanta'))!;
  expect(dados.textContent).toContain('Responsável: Marta');
  expect(dados.textContent).toContain('Prazo: sexta-feira');
  // O ponto "discutido" sem dono nem prazo não mostra a linha de responsável (não é um combinado).
  const espera = [...host.querySelectorAll('.tq-estado-ponto')].find((n) => n.textContent?.includes('Onde ocorre'))!;
  expect(espera.textContent).not.toContain('Responsável');
  // Um combinado "a confirmar" sem dono diz que não foi definido, em vez de calar.
  const semDono = mesclar({
    anterior: snapshotInicial('m-1', ['Quem avisa o cliente'], 0, 1),
    corte: 3,
    agora: 2,
    transcricao: TRANSCRICAO,
    proposta: { pontos: [{ id: snapshotInicial('m-1', ['Quem avisa o cliente'], 0, 1).pontos[0]!.id, estado: 'a_confirmar', falas: [1] }] },
  }).snapshot;
  await render(estado(semDono));
  expect(host.textContent).toContain('Responsável não definido · Prazo não definido');
});

it('o assunto atual é dito como hipótese, e a nota do modelo aparece', async () => {
  await render(estado(snapshot()));
  expect(host.textContent).toContain('Parece que estão falando de: Quem levanta os dados');
  expect(host.textContent).toContain('parece que é na triagem');
});

it('"Ver fonte" mostra a fala citada, fechada por padrão', async () => {
  await render(estado(snapshot()));
  expect(host.querySelector('.tq-estado-fonte')).toBeNull();
  await act(async () => botao('Ver fonte')!.click());
  expect(host.querySelector('.tq-estado-fonte')!.textContent).toContain('Fala');
  expect(host.querySelector('.tq-estado-fonte')!.textContent).toContain('A Marta consegue levantar esses dados');
});

it('a correção da pessoa é gravada e fica marcada', async () => {
  await transacaoDoEstado((m) => {
    m['m-1'] = snapshot();
    return { resultado: undefined, mudou: true };
  });
  await render(estado(snapshot()));
  const select = [...host.querySelectorAll<HTMLSelectElement>('select')].find((s) => s.value === 'discutido')!;
  await act(async () => {
    select.value = 'decidido';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => new Promise((r) => setTimeout(r, 30)));
  const gravado = (await lerEstados())['m-1']!.pontos.find((p) => p.texto === 'Onde ocorre a espera')!;
  expect(gravado).toMatchObject({ estado: 'decidido', pessoaNaRevisao: 3 });
  expect(gravado.historico.at(-1)).toMatchObject({ por: 'pessoa', estado: 'decidido' });
});

it('sem leitura ainda: convida a ler; sem o assistente conectado, o botão fica desligado e diz por quê', async () => {
  const atualizar = vi.fn(async () => undefined);
  await render(estado(null, { atualizar }));
  expect(host.textContent).toContain('Ainda não foi lido');
  await act(async () => botao('Ler a reunião')!.click());
  expect(atualizar).toHaveBeenCalledTimes(1);
  await render(estado(null, { atualizar }), { taqPronto: false });
  expect(botao('Ler a reunião')!.disabled).toBe(true);
  expect(host.textContent).toContain('O assistente não está conectado');
});

it('falha ao atualizar é dita sem apagar o que estava guardado; atualizando mostra o andamento', async () => {
  await render(estado(snapshot(), { erro: 'A cota acabou.' }));
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('A cota acabou. O que estava guardado continua.');
  expect(host.querySelectorAll('.tq-estado-ponto')).toHaveLength(3);
  await render(estado(snapshot(), { atualizando: true }));
  expect(botao('Lendo a reunião')!.disabled).toBe(true);
});

describe('Fechar a reunião', () => {
  const comFechamento = (): Snapshot => ({
    ...snapshot(),
    fechamento: { texto: 'Quem levanta os dados e até quando?', revisao: 3 },
  });
  const renderF = async (s: Snapshot, onRegistrar: (p: Ponto) => Promise<ResultadoDoRegistro>, falasAgora = 3) =>
    act(async () =>
      root.render(
        <EstadoDosPontos
          meetingId="m-1"
          estado={estado(s)}
          aberto
          onAlternar={() => undefined}
          taqPronto
          falasAgora={falasAgora}
          onRegistrar={onRegistrar}
          fechamentoAberto
          onAlternarFechamento={() => undefined}
        />,
      ),
    );
  const ok = async (): Promise<ResultadoDoRegistro> => ({ tipo: 'recusado', motivo: 'x' });

  it('a síntese agrupa por estado, mostra dono e prazo quando a fala trouxe; a frase vem rotulada como sugestão', async () => {
    await renderF(comFechamento(), ok);
    const f = host.querySelector('.tq-fechamento')!;
    expect(f.textContent).toContain('A confirmar (proposto, ninguém fechou)');
    expect(f.textContent).toContain('Quem levanta os dados e quando (Marta, sexta-feira)');
    expect(f.textContent).toContain('Em aberto');
    // Todo combinado aqui tem responsável e prazo: nada a listar como "sem definir".
    expect(f.textContent).not.toContain('Ainda sem definir');
    expect(f.textContent).toContain('Sugestão de fechamento — não é uma fala registrada');
    expect(f.textContent).toContain('“Quem levanta os dados e até quando?”');
  });

  it('um combinado sem responsável nem prazo aparece em "Ainda sem definir", e nada é preenchido', async () => {
    const s = comFechamento();
    // "Com que frequência" vira um combinado (a confirmar) cuja fala não traz dono nem prazo.
    const freq = s.pontos.find((p) => p.texto === 'Com que frequência')!;
    freq.estado = 'a_confirmar';
    freq.evidencias = [{ segmento: 1, trecho: 'Na triagem. A fila da triagem passa de uma hora quase todo dia.' }];
    await renderF(s, ok);
    const f = host.querySelector('.tq-fechamento')!;
    expect(f.textContent).toContain('Ainda sem definir');
    expect(f.textContent).toContain('Com que frequência: responsável e prazo não definidos');
    expect(f.textContent).not.toContain('Com que frequência (');
  });

  it('diz que a leitura ficou para trás quando a transcrição já tem mais falas', async () => {
    await renderF(comFechamento(), ok, 40);
    expect(host.querySelector('.tq-fechamento')!.textContent).toContain('A leitura vai até a fala 3 de 40');
  });

  it('o registro é por clique, mostra o recibo, e diz quando já estava registrado', async () => {
    const chamadas: string[] = [];
    let jaExistia = false;
    const onRegistrar = async (p: Ponto): Promise<ResultadoDoRegistro> => {
      chamadas.push(p.texto);
      return { tipo: 'ok', jaExistia, compromisso: {} as never };
    };
    await renderF(comFechamento(), onRegistrar);
    // Só o que foi combinado ou decidido tem o botão: "Quem levanta os dados" (a confirmar).
    const botoes = [...host.querySelectorAll<HTMLButtonElement>('.tq-fechamento-registrar button')];
    expect(botoes).toHaveLength(1);
    expect(chamadas).toEqual([]);
    await act(async () => botoes[0]!.click());
    expect(chamadas).toEqual(['Quem levanta os dados e quando']);
    expect(host.querySelector('.tq-fechamento-registrar [role="status"]')!.textContent).toBe('Registrado em Acompanhamento.');
    jaExistia = true;
    await act(async () => botoes[0]!.click());
    expect(host.querySelector('.tq-fechamento-registrar [role="status"]')!.textContent).toBe('Já estava em Acompanhamento.');
  });

  it('um registro recusado mostra o motivo, e o texto avisa que dono e prazo só entram se ditos', async () => {
    await renderF(comFechamento(), async () => ({ tipo: 'recusado', motivo: 'Sem fala da reunião que o sustente.' }));
    await act(async () => host.querySelector<HTMLButtonElement>('.tq-fechamento-registrar button')!.click());
    expect(host.querySelector('.tq-fechamento-registrar [role="status"]')!.textContent).toContain('Sem fala da reunião');
    expect(host.querySelector('.tq-fechamento')!.textContent).toContain('Responsável e prazo entram só se foram ditos');
  });

  it('sem leitura, a síntese diz que não há o que sintetizar e não inventa nada', async () => {
    await act(async () =>
      root.render(
        <EstadoDosPontos
          meetingId="m-1"
          estado={estado(null)}
          aberto
          onAlternar={() => undefined}
          taqPronto
          onRegistrar={ok}
          fechamentoAberto
          onAlternarFechamento={() => undefined}
        />,
      ),
    );
    expect(host.querySelector('.tq-fechamento')!.textContent).toContain('ainda não foi lida');
    expect(host.querySelector('.tq-fechamento-registrar')).toBeNull();
  });
});

it('com a preparação sem pontos e nada lido, diz onde escrever o que não pode ficar sem encaminhamento', async () => {
  await render(estado(snapshotInicial('m-1', [], 4, 1)));
  expect(host.textContent).toContain('Nenhum ponto ainda');
  expect(host.textContent).toContain('Preparar');
});
