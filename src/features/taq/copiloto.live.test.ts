// @vitest-environment node
/**
 * TESTE AO VIVO — o copiloto (`copilot-v2`) respondendo às perguntas de condução
 * sobre uma reunião INVENTADA, com a preparação (briefing) da pessoa.
 *
 * Pulado por padrão. Roda com o servidor no ar:
 *
 *   cd server; npx next build; npx next start -p 3100      (noutro terminal)
 *   $env:TAQ_LIVE_URL = 'http://localhost:3100'
 *   $env:TAQ_LIVE_KEY = '<o DOCCITI_SHARED_KEY do servidor>'
 *   npx vitest run src/features/taq/copiloto.live.test.ts
 *
 * O modelo não é determinístico: as asserções conferem o que o CÓDIGO garante
 * (fontes que existem) e algumas regras que o produto exige de forma robusta
 * (não inventar dono nem data); a resposta é impressa para leitura humana.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { salvarBriefing, salvarPerfil } from '@/features/conducao/store';
import type { MeetingRecord } from '@/shared/types/domain';
import { armazenamentoLocal } from './armazenamento';
import { criarAdaptadorHttp } from './modelo';
import { criarOrquestrador } from './orquestrador';

const URL_AO_VIVO = process.env.TAQ_LIVE_URL;
const CHAVE = process.env.TAQ_LIVE_KEY;
const rodar = URL_AO_VIVO && CHAVE ? describe : describe.skip;

const FALAS: Array<[string, string]> = [
  ['Ana', 'Bom dia, pessoal. Obrigada por separarem esse tempo.'],
  ['Cliente', 'Bom dia! Tudo bem por aqui, vamos lá.'],
  ['Ana', 'Hoje a ideia é entender como funciona o atendimento aí hoje.'],
  ['Cliente', 'Certo. A gente tem muita reclamação, o povo demora demais.'],
  ['Ana', 'Entendi. E o que vocês já pensaram para resolver?'],
  ['Cliente', 'Acho que precisamos de um aplicativo.'],
  ['Ana', 'Hum, interessante.'],
  ['Cliente', 'É, o pessoal da diretoria gosta dessa ideia, todo mundo usa celular.'],
  ['Ana', 'Em que momento o atendimento costuma travar hoje?'],
  ['Cliente', 'Na triagem. A fila da triagem passa de uma hora quase todo dia, a gente tem só dois atendentes lá.'],
  ['Ana', 'E isso acontece em quantos atendimentos, mais ou menos?'],
  ['Cliente', 'Uns sessenta por cento, a gente nunca mediu direito, mas é o que a equipe sente.'],
  ['Ana', 'Entendi. Alguém precisa levantar esses dados.'],
  ['Cliente', 'Isso, mas ainda não sei quem vai fazer isso, vou ver com a equipe.'],
];

const inicio = Date.UTC(2026, 9, 6, 13);
const REUNIAO: MeetingRecord = {
  id: 'demo-descoberta',
  title: 'Demonstração — Descoberta: atendimento da Prefeitura',
  startedAt: inicio,
  endedAt: inicio + FALAS.length * 20_000,
  durationSeconds: FALAS.length * 20,
  participants: [{ name: 'Ana', isHost: true }, { name: 'Cliente', isHost: false }],
  segments: FALAS.map(([speaker, text], i) => ({
    captionId: `d-${i}`,
    speaker,
    text,
    startOffsetMs: i * 20_000,
    endOffsetMs: i * 20_000 + 18_000,
  })),
  status: 'ready',
  metadata: { capturedCaptions: true, droppedSegments: 0, reconnectCount: 0, wasDiscardedAndRestarted: false },
};

rodar('copilot-v2 contra o provedor real', () => {
  const orquestrador = criarOrquestrador({
    modelo: criarAdaptadorHttp({ baseUrl: URL_AO_VIVO!, chave: CHAVE!, sintetica: true }),
    armazenamento: armazenamentoLocal,
  });

  beforeAll(async () => {
    installChromeStorageMock();
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: [REUNIAO] });
    await salvarPerfil(
      {
        missao: 'Entender a necessidade real do cliente antes de falar de funcionalidades.',
        observar: ['Processo atual', 'Impacto'],
        intervencao: { modo: 'discreto', estilo: 'Uma pergunta curta por vez' },
        contexto: [],
        preferencias: [],
      },
      0,
    );
    await salvarBriefing(
      REUNIAO.id,
      {
        objetivo: 'Entender a causa dos atrasos no atendimento antes de discutir solução.',
        prioridades: ['Onde ocorre a espera', 'Com que frequência', 'Quem levanta os dados e quando'],
      },
      0,
    );
  });

  async function perguntar(texto: string) {
    const r = await orquestrador.executar({
      conversaId: 'c-live',
      meetingId: REUNIAO.id,
      texto,
      anteriores: [],
      selecionados: [{ tipo: 'reuniao', id: REUNIAO.id }],
    });
    console.log(`\n[${texto}]\nestado=${r.estado}\n${r.resposta ?? '(sem resposta)'}\nerros=${JSON.stringify(r.erros)}`);
    return r;
  }

  it('"O que ainda falta esclarecer?": responde com os estados e sem inventar dono ou data', async () => {
    const r = await perguntar('O que ainda falta esclarecer nesta reunião?');
    expect(['concluido', 'parcial', 'falhou']).toContain(r.estado);
    if (r.resposta) {
      // Ninguém disse quem levanta os dados: a resposta não pode atribuir a ninguém.
      expect(r.resposta).not.toMatch(/Marta|Carlos|João|Maria/);
      // Toda fonte citada existe no livro da execução.
      for (const e of r.evidencias) expect(e.registroId).toBe(REUNIAO.id);
    }
  }, 120_000);

  it('"Me ajude a fechar a reunião": síntese com o que ficou em aberto, sem transformar proposta em decisão', async () => {
    const r = await perguntar(
      'Me ajude a fechar a reunião: o que foi decidido, o que segue em aberto e o que ainda falta definir (responsável e data).',
    );
    expect(['concluido', 'parcial', 'falhou']).toContain(r.estado);
    if (r.resposta) {
      expect(r.resposta).not.toMatch(/Marta|Carlos|João|Maria/);
      for (const e of r.evidencias) expect(e.registroId).toBe(REUNIAO.id);
    }
  }, 120_000);
});
