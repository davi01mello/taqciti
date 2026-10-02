// @vitest-environment node
/**
 * TESTE AO VIVO — as jornadas dos especialistas de trabalho contra o servidor
 * e o provedor DE VERDADE, com um conjunto "Demonstração" INVENTADO.
 *
 * Pulado por padrão. Roda com o servidor no ar:
 *
 *   cd server; npx next build; npx next start -p 3100      (noutro terminal)
 *   $env:TAQ_LIVE_URL = 'http://localhost:3100'
 *   $env:TAQ_LIVE_KEY = '<o DOCCITI_SHARED_KEY do servidor>'
 *   npx vitest run src/features/taq/trabalho.live.test.ts
 *
 * Tudo é código de produção, menos o storage (mock com as reuniões sintéticas
 * abaixo). Como são sintéticas, o adaptador declara `sintetica: true`. Os
 * casos rodam EM SEQUÊNCIA sobre o mesmo storage, como a demonstração da
 * seção 16: o que um registra, o seguinte usa.
 *
 * O modelo não é determinístico. As asserções checam o que o CÓDIGO garante
 * (o que foi gravado, com que fonte, o que não foi oferecido) e imprimem a
 * resposta para leitura humana.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { STORAGE_KEYS } from '@/shared/config/constants';
import type { MeetingRecord } from '@/shared/types/domain';
import { lerTrabalho } from '@/features/trabalho/store';
import { armazenamentoLocal } from './armazenamento';
import { criarAdaptadorHttp } from './modelo';
import { criarOrquestrador, type ExecucaoDoTaq } from './orquestrador';
import { normalizar } from './busca';

const URL_AO_VIVO = process.env.TAQ_LIVE_URL;
const CHAVE = process.env.TAQ_LIVE_KEY;

function reuniao(id: string, title: string, falas: Array<[string, string]>, dia: number): MeetingRecord {
  const inicio = Date.UTC(2026, 8, dia, 13);
  return {
    id,
    title,
    startedAt: inicio,
    endedAt: inicio + falas.length * 20_000,
    durationSeconds: falas.length * 20,
    participants: [...new Set(falas.map(([f]) => f))].map((name) => ({ name, isHost: null })),
    segments: falas.map(([speaker, text], i) => ({
      captionId: `${id}-${i}`,
      speaker,
      text,
      startOffsetMs: i * 20_000,
      endOffsetMs: i * 20_000 + 18_000,
    })),
    status: 'ready',
    metadata: { capturedCaptions: true, droppedSegments: 0, reconnectCount: 0, wasDiscardedAndRestarted: false },
  };
}

/** Demonstração: três reuniões relacionadas de um projeto fictício, e a decisão revista. */
const COMERCIAL = reuniao(
  'demo-comercial',
  'Demonstração — Comercial: kickoff Painel Aurora',
  [
    ['Rita Campos', 'Combinado com o cliente: o Painel Aurora vai ter exportação em PDF dos relatórios.'],
    ['Rita Campos', 'O cliente quer a primeira versão no fim de outubro.'],
    ['Otávio Lins', 'Eu mando a proposta revisada para o cliente até quinta.'],
  ],
  22,
);
const PRODUTO = reuniao(
  'demo-produto',
  'Demonstração — Produto: escopo do Painel Aurora',
  [
    ['Júlia Prado', 'O escopo da fase 1 é só a visualização dos relatórios na tela.'],
    ['Júlia Prado', 'Exportação não entra na fase 1.'],
    ['Marcos Teles', 'Eu fico com o protótipo navegável até sexta-feira.'],
    ['Júlia Prado', 'Alguém precisa escrever os critérios de aceite.'],
    ['Marcos Teles', 'Proponho fazer testes com usuários, mas não fechamos isso.'],
  ],
  23,
);
const DADOS = reuniao(
  'demo-dados',
  'Demonstração — Dados: integração do Painel Aurora',
  [
    ['Lia Sato', 'A carga dos relatórios depende do acesso ao banco do cliente.'],
    ['Lia Sato', 'Sem esse acesso, a gente não consegue testar nada.'],
    ['Caio Neri', 'Eu peço o acesso ao TI do cliente amanhã.'],
  ],
  24,
);
const ALINHAMENTO = reuniao(
  'demo-alinhamento',
  'Demonstração — Alinhamento Comercial e Produto',
  [
    ['Rita Campos', 'Conversei com o cliente sobre a exportação.'],
    ['Júlia Prado', 'Decidido: a exportação em PDF fica para a fase 2; a fase 1 segue só com visualização.'],
    ['Rita Campos', 'Combinado, o cliente aceitou.'],
  ],
  29,
);

const vivo = !!URL_AO_VIVO && !!CHAVE;
let conversa = 0;
let chamadas: string[] = [];

/** Pausa antes de cada caso — para a cota por minuto de provedores gratuitos. */
const PAUSA_MS = Number(process.env.TAQ_LIVE_PAUSA_MS ?? 0);

async function executar(texto: string, meetingId?: string): Promise<ExecucaoDoTaq> {
  if (PAUSA_MS) await new Promise((r) => setTimeout(r, PAUSA_MS));
  conversa += 1;
  chamadas = [];
  const taq = criarOrquestrador({
    modelo: criarAdaptadorHttp({ baseUrl: URL_AO_VIVO!, chave: CHAVE!, sintetica: true }),
    armazenamento: armazenamentoLocal,
    // O free tier é lento; as jornadas encadeiam especialista e leitura.
    limites: { tempoMaxMs: 300_000, maxPassos: 10, maxChamadasDeFerramenta: 20, maxTentativasTransitorias: 3 },
  });
  return taq.executar({
    conversaId: `demo-live-${conversa}`,
    ...(meetingId ? { meetingId } : {}),
    texto,
    anteriores: [],
    selecionados: [],
    aoEvento: (e) => {
      if (e.tipo === 'delegacao' && e.estado === 'iniciada') chamadas.push(`→ ${e.agenteId}`);
      if (e.tipo === 'ferramenta_inicio') chamadas.push(e.nome);
      if (e.tipo === 'ferramenta_fim') chamadas.push(`(${e.ok ? 'ok' : `erro ${e.codigoDeErro}`}: ${e.resumo})`);
    },
  });
}

function mostrar(titulo: string, r: ExecucaoDoTaq) {
  console.warn(
    `\n=== ${titulo} ===\nestado: ${r.estado} | ${r.metricas.duracaoMs} ms | ${chamadas.join(' ')}\n` +
      `cartões: ${(r.cartoes ?? []).map((c) => c.tipo).join(', ') || '—'}\n${r.resposta ?? '(sem resposta)'}\n` +
      (r.limitacoes.length ? `limitações: ${r.limitacoes.join(' | ')}\n` : '') +
      (r.erros.length
        ? `erros:\n${r.erros.map((e) => `  - ${e.ferramenta ?? e.agente ?? 'modelo'} ${e.codigo}: ${e.mensagem.slice(0, 300)}`).join('\n')}\n`
        : ''),
  );
}

const TRANSCRICOES = normalizar(
  [COMERCIAL, PRODUTO, DADOS, ALINHAMENTO].flatMap((m) => m.segments.map((s) => `${s.speaker} ${s.text}`)).join(' '),
);

describe.skipIf(!vivo).sequential('demonstração ao vivo — especialistas de trabalho', () => {
  beforeAll(() => {
    installChromeStorageMock({ local: { [STORAGE_KEYS.history]: [COMERCIAL, PRODUTO, DADOS, ALINHAMENTO] } });
  });

  it('organizar os próximos passos: sugere, sem gravar', async () => {
    const r = await executar('Organize os próximos passos da reunião de escopo do Painel Aurora.');
    mostrar('sugerir compromissos', r);
    expect(['concluido', 'parcial']).toContain(r.estado);
    expect((await lerTrabalho()).compromissos).toHaveLength(0);
  }, 320_000);

  it('registrar os próximos passos: grava com fonte, sem dono inventado', async () => {
    const r = await executar('Registre os próximos passos da reunião de escopo do Painel Aurora.');
    mostrar('registrar compromissos', r);
    const { compromissos } = await lerTrabalho();
    expect(compromissos.length).toBeGreaterThan(0);
    for (const c of compromissos) {
      expect(c.evidencias.length).toBeGreaterThan(0);
      if (c.responsavel) expect(TRANSCRICOES).toContain(normalizar(c.responsavel.nome).split(' ')[0]!);
    }
    const criterios = compromissos.find((c) => normalizar(c.descricao).includes('criterio'));
    if (criterios) expect(criterios.responsavel).toBeNull();
  }, 320_000);

  it('registrar de novo não duplica', async () => {
    const antes = (await lerTrabalho()).compromissos.length;
    const r = await executar('Registre os próximos passos da reunião de escopo do Painel Aurora.');
    mostrar('registrar de novo', r);
    expect((await lerTrabalho()).compromissos.length).toBeLessThanOrEqual(antes + 1);
  }, 320_000);

  it('analisar a reunião de dados: análise salva com cobertura', async () => {
    const r = await executar('Analise a reunião de integração de dados do Painel Aurora.');
    mostrar('analisar', r);
    const a = (await lerTrabalho()).analises.find((x) => x.reuniaoId === 'demo-dados');
    expect(a).toBeTruthy();
    expect(a!.cobertura.total).toBe(3);
  }, 320_000);

  it('comparar Comercial e Produto: achado com as duas fontes', async () => {
    const r = await executar(
      'Compare o que o Comercial prometeu ao cliente no kickoff com o escopo registrado por Produto, e registre os desalinhamentos.',
    );
    mostrar('comparar fontes', r);
    const { achados } = await lerTrabalho();
    expect(achados.length).toBeGreaterThan(0);
    const fontes = new Set(achados[0]!.entendimentos.map((e) => e.evidencia.registroId));
    expect(fontes.size).toBeGreaterThanOrEqual(2);
  }, 320_000);

  it('decisão revista resolve o achado, preservando o histórico', async () => {
    const r = await executar(
      'Na reunião de alinhamento ficou decidido que o PDF fica para a fase 2. Registre essa decisão e resolva o desalinhamento da exportação.',
    );
    mostrar('decisão revista', r);
    const { decisoes, achados } = await lerTrabalho();
    expect(decisoes.some((d) => normalizar(d.texto).includes('fase 2'))).toBe(true);
    const resolvido = achados.find((a) => a.estado === 'resolvido');
    expect(resolvido?.historico.length).toBeGreaterThan(1);
  }, 320_000);

  it('rascunho de mensagem: nada é enviado', async () => {
    const r = await executar('Prepare um e-mail para a Rita explicando que o PDF ficou para a fase 2.');
    mostrar('rascunho', r);
    expect(r.cartoes?.some((c) => c.tipo === 'rascunho_de_mensagem')).toBe(true);
    expect(normalizar(r.resposta ?? '')).not.toMatch(/\b(enviei|foi enviado|mandei)\b/);
  }, 320_000);

  it('horário: sugestão no fuso, sem evento criado', async () => {
    const r = await executar('Sugira um horário amanhã à tarde para revisar o escopo do Painel Aurora com a Júlia.');
    mostrar('horário', r);
    expect(r.cartoes?.some((c) => c.tipo === 'sugestao_de_evento')).toBe(true);
    expect(normalizar(r.resposta ?? '')).not.toMatch(/\b(agendei|evento criado|convite enviado)\b/);
  }, 320_000);

  it('captura: estado da reunião de dados, sem chamada extra ao modelo', async () => {
    const r = await executar('A captura da reunião de integração de dados está confiável?');
    mostrar('captura', r);
    expect(r.cartoes?.some((c) => c.tipo === 'estado_da_captura')).toBe(true);
  }, 320_000);
});
