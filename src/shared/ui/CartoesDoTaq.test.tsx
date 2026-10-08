/**
 * Os cartões do Taq na árvore, contra o storage (mock com `onChanged`).
 *
 * O que estes casos seguram é a honestidade dos controles: cada botão faz a
 * operação real e a tela mostra o estado gravado; não existe botão de enviar
 * nem de agendar; o link de agenda não leva convidados; a fonte de uma reunião
 * apagada não finge abrir. Dados sintéticos.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import type { MeetingRecord } from '@/shared/types/domain';
import { lerTrabalho, registrarCompromissos } from '@/features/trabalho/store';
import type { CartaoDaResposta } from '@/features/taq/contratos';
import type { ResultadoDaConfirmacao } from '@/features/taq/orquestrador';
import { CartoesDoTaq } from './CartoesDoTaq';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REUNIAO: MeetingRecord = {
  id: 'm-1',
  title: '[TESTE] Planejamento',
  startedAt: 0,
  endedAt: 1,
  durationSeconds: 60,
  participants: [],
  segments: [{ captionId: 'c0', speaker: 'Ana', text: 'Eu envio o relatório até sexta.', startOffsetMs: 0, endOffsetMs: 1 }],
  status: 'ready',
  metadata: { capturedCaptions: true, droppedSegments: 0, reconnectCount: 0, wasDiscardedAndRestarted: false },
};

const ev = (registroId: string) => ({
  tipo: 'reuniao' as const,
  registroId,
  titulo: '[TESTE] Planejamento',
  versao: '1:1',
  trecho: 'Eu envio o relatório até sexta.',
  segmento: 0,
});

let raiz: Root;
let palco: HTMLDivElement;

beforeEach(() => {
  installChromeStorageMock({ local: { [STORAGE_KEYS.history]: [REUNIAO] } });
  palco = document.createElement('div');
  document.body.append(palco);
  raiz = createRoot(palco);
});

afterEach(() => {
  act(() => raiz.unmount());
  palco.remove();
});

async function montar(
  cartoes: CartaoDaResposta[],
  onAbrirFonte = vi.fn(),
  onConfirmarAcao?: (chave: string, repetir?: boolean) => Promise<ResultadoDaConfirmacao>,
) {
  await act(async () => {
    raiz.render(
      <CartoesDoTaq
        cartoes={cartoes}
        mensagemId="msg-1"
        conversaId="c-1"
        onAbrirFonte={onAbrirFonte}
        onAbrirDocumento={vi.fn()}
        {...(onConfirmarAcao ? { onConfirmarAcao } : {})}
      />,
    );
  });
  // O storage responde em microtarefas: mais uma volta para os observadores.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const botao = (texto: string) =>
  [...palco.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined;

describe('compromissos', () => {
  it('“Marcar como concluído” grava, e a tela passa a oferecer “Reabrir”', async () => {
    const { criados } = await registrarCompromissos(
      [{ descricao: 'Enviar o relatório', responsavel: null, prazo: null, reuniaoId: 'm-1', evidencias: [ev('m-1')] }],
      { origem: 'taq' },
    );
    await montar([{ tipo: 'compromissos', ids: [criados[0]!.id] }]);
    expect(palco.textContent).toContain('Sem responsável definido');
    expect(palco.textContent).toContain('Sem prazo acordado');

    await act(async () => botao('Marcar como concluído')!.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect((await lerTrabalho()).compromissos[0]!.estado).toBe('concluido');
    expect(botao('Reabrir')).toBeTruthy();
  });

  it('compromisso apagado e fonte de reunião apagada: dito, sem botão fingindo abrir', async () => {
    const { criados } = await registrarCompromissos(
      [{ descricao: 'Ligar para o cliente', responsavel: null, prazo: null, reuniaoId: 'm-apagada', evidencias: [ev('m-apagada')] }],
      { origem: 'taq' },
    );
    await montar([{ tipo: 'compromissos', ids: [criados[0]!.id, 'k-inexistente'] }]);
    expect(palco.textContent).toContain('origem indisponível');
    expect(palco.textContent).toMatch(/1 compromisso\(s\) desta resposta não está mais guardado/);
  });

  it('sugestões: nada é gravado até “Registrar selecionados”, e o desmarcado fica de fora', async () => {
    await montar([
      {
        tipo: 'sugestoes_de_compromisso',
        reuniaoId: 'm-1',
        itens: [
          { descricao: 'Enviar o relatório', responsavel: 'Ana', prazo: 'até sexta', evidencias: [ev('m-1')] },
          { descricao: 'Revisar o contrato', responsavel: null, prazo: null, evidencias: [ev('m-1')] },
        ],
      },
    ]);
    expect((await lerTrabalho()).compromissos).toHaveLength(0);
    const caixas = palco.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => caixas[1]!.click());
    await act(async () => botao('Registrar selecionados')!.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect((await lerTrabalho()).compromissos.map((c) => c.descricao)).toEqual(['Enviar o relatório']);
    expect(palco.textContent).toContain('Registrado(s): 1.');
  });
});

describe('sem integração, sem botão de integração', () => {
  it('rascunho: só copiar — o envio é do Taq no chat, sem botão nem mailto', async () => {
    await montar([
      {
        tipo: 'rascunho_de_mensagem',
        canal: 'email',
        publico: 'interno',
        destinatarios: [{ nome: 'Bruno', endereco: 'bruno@citi.org.br', situacao: 'informado' }],
        assunto: 'Relatório',
        corpo: 'Oi, Bruno!',
        alertas: [],
      },
    ]);
    expect(botao('Enviar')).toBeUndefined();
    expect(palco.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(palco.textContent).toContain('Nada foi enviado');
  });

  it('rascunho sem endereço: dado sensível digitado gera alerta na hora', async () => {
    await montar([
      {
        tipo: 'rascunho_de_mensagem',
        canal: 'email',
        publico: 'externo',
        destinatarios: [{ nome: 'Ana', situacao: 'ambiguo', candidatos: ['Ana Souza', 'Ana Lima'] }],
        corpo: 'Olá!',
        alertas: [],
      },
    ]);
    expect(palco.textContent).toContain('mais de uma pessoa com esse nome: Ana Souza, Ana Lima');
    const texto = palco.querySelector('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(texto, 'Meu CPF é 529.982.247-25');
      texto.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(palco.textContent).toMatch(/CPF/);
  });

  it('horário: link do Google Agenda sem convidados, e o aviso de disponibilidade não verificada', async () => {
    await montar([
      {
        tipo: 'sugestao_de_evento',
        titulo: 'Revisão do escopo',
        duracaoMin: 30,
        fuso: 'America/Recife',
        participantes: ['Ana Souza'],
        opcoes: [{ inicio: '2026-10-02T17:00:00.000Z', fim: '2026-10-02T17:30:00.000Z', rotulo: 'sex., 02/10, 14:00' }],
      },
    ]);
    expect(palco.textContent).toContain('disponibilidade não verificada');
    const link = [...palco.querySelectorAll('a')].find((a) => a.textContent === 'Abrir no Google Agenda')!;
    expect(new URL(link.href).searchParams.has('add')).toBe(false);
    expect(botao('Agendar')).toBeUndefined();
  });
});

describe('ação externa: o botão é a confirmação', () => {
  const rascunho = (chave?: string): CartaoDaResposta => ({
    tipo: 'rascunho_de_mensagem',
    canal: 'email',
    publico: 'interno',
    destinatarios: [{ nome: 'Bruno', endereco: 'bruno@citi.org.br', situacao: 'verificado' }],
    assunto: 'Relatório',
    corpo: 'Oi, Bruno!',
    alertas: [],
    ...(chave ? { chaveDoRascunho: chave } : {}),
  });
  const resposta = (estado: 'aceito' | 'falhou' | 'desconhecido', texto: string): ResultadoDaConfirmacao => ({
    execucaoId: 'x1',
    ok: true,
    texto,
    cartoes: [
      { tipo: 'acao_externa', operacao: 'email', estado, titulo: 'Relatório', linhas: [], alertas: [], chaveDoRascunho: 'email:k1' },
    ],
  });

  it('sem chave ou sem a ação da tela, não há botão de enviar', async () => {
    await montar([rascunho()], vi.fn(), vi.fn());
    expect(botao('Enviar')).toBeUndefined();
    await montar([rascunho('email:k1')]);
    expect(botao('Enviar')).toBeUndefined();
  });

  it('“Enviar” chama a ação com a chave, fica desabilitado enquanto roda, e só diz o que o desfecho real disse', async () => {
    let concluir!: (r: ResultadoDaConfirmacao) => void;
    const confirmar = vi.fn(() => new Promise<ResultadoDaConfirmacao>((r) => (concluir = r)));
    await montar([rascunho('email:k1')], vi.fn(), confirmar);
    expect(palco.textContent).not.toMatch(/aceitou|Aceito pelo Google/);
    expect(botao('Descartar')).toBeTruthy();

    await act(async () => botao('Enviar')!.click());
    expect(confirmar).toHaveBeenCalledWith('email:k1', undefined);
    expect(palco.querySelector<HTMLButtonElement>('button[disabled]')).toBeTruthy();
    // Um segundo clique no meio do envio não chama de novo.
    await act(async () => palco.querySelector<HTMLButtonElement>('button[disabled]')!.click());
    expect(confirmar).toHaveBeenCalledTimes(1);

    await act(async () => concluir(resposta('aceito', 'O Google aceitou o e-mail “Relatório”.')));
    expect(palco.textContent).toContain('O Google aceitou o e-mail');
    expect(botao('Enviar')).toBeUndefined();
  });

  it('resultado desconhecido: avisa para conferir Enviados e só reenvia com “Reenviar mesmo assim” (repetir)', async () => {
    const confirmar = vi
      .fn<(chave: string, repetir?: boolean) => Promise<ResultadoDaConfirmacao>>()
      .mockResolvedValueOnce(resposta('desconhecido', 'Não sei se o e-mail “Relatório” foi feito.'))
      .mockResolvedValueOnce(resposta('aceito', 'O Google aceitou o e-mail “Relatório”.'));
    await montar([rascunho('email:k1')], vi.fn(), confirmar);
    await act(async () => botao('Enviar')!.click());
    expect(palco.textContent).toContain('Não sei se o e-mail');
    expect(palco.textContent).toMatch(/confira a pasta Enviados/);
    expect(botao('Enviar')).toBeUndefined();
    await act(async () => botao('Reenviar mesmo assim')!.click());
    expect(confirmar).toHaveBeenLastCalledWith('email:k1', true);
    expect(palco.textContent).toContain('O Google aceitou');
  });

  it('recusa da ação aparece como erro, e o botão continua para tentar de novo', async () => {
    const confirmar = vi.fn(async () => ({
      execucaoId: 'x1',
      ok: false,
      cartoes: [],
      erro: { codigo: 'anexo_mudou', mensagem: 'O documento mudou depois da prévia.' },
      texto: 'Não foi feito: O documento mudou depois da prévia.',
    }));
    await montar([rascunho('email:k1')], vi.fn(), confirmar);
    await act(async () => botao('Enviar')!.click());
    expect(palco.querySelector('[role="alert"]')?.textContent).toContain('mudou depois da prévia');
    expect(botao('Enviar') ?? botao('Tentar de novo')).toBeTruthy();
  });

  it('cartão de evento em prévia: “Marcar” e “Descartar”; cancelamento: “Cancelar o evento”', async () => {
    const confirmar = vi.fn();
    await montar(
      [
        { tipo: 'acao_externa', operacao: 'evento_criar', estado: 'aguardando_confirmacao', titulo: 'Retro', linhas: [], alertas: [], chaveDoRascunho: 'evento:k2' },
        { tipo: 'acao_externa', operacao: 'evento_cancelar', estado: 'aguardando_confirmacao', titulo: 'Alinhamento', linhas: [], alertas: [], chaveDoRascunho: 'cancelar:k3' },
      ],
      vi.fn(),
      confirmar,
    );
    expect(botao('Marcar')).toBeTruthy();
    expect(botao('Cancelar o evento')).toBeTruthy();
    expect(palco.textContent).not.toMatch(/diga “envie”/);
  });
});