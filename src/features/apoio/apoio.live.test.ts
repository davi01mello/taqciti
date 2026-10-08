// @vitest-environment node
/**
 * TESTE AO VIVO — a proposta de perfil e as intervenções discretas contra o
 * servidor e o provedor DE VERDADE, com uma reunião INVENTADA.
 *
 * Pulado por padrão. Roda com o servidor no ar:
 *
 *   cd server; npx next build; npx next start -p 3100      (noutro terminal)
 *   $env:TAQ_LIVE_URL = 'http://localhost:3100'
 *   $env:TAQ_LIVE_KEY = '<o DOCCITI_SHARED_KEY do servidor>'
 *   npx vitest run src/features/apoio/apoio.live.test.ts
 *
 * O adaptador declara `sintetica: true` (a chave gratuita só aceita dado
 * inventado). O modelo não é determinístico: as asserções conferem o que o
 * CÓDIGO garante (fonte existente, nada depois do corte, formato) e o que o
 * produto exige de forma robusta (o silêncio quando não há o que dizer); o
 * resto é impresso para leitura humana, que é o que a Etapa 6 usa.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { lerConducao, salvarBriefing, salvarPerfil } from '@/features/conducao/store';
import { proporPerfil } from '@/features/conducao/proposta';
import { criarAdaptadorHttp } from '@/features/taq/modelo';
import { avaliarReuniao, type FalaDaReuniao } from './gerar';
import { criarLaco } from './laco';
import { registrarSugestao, lerApoio, mudarEstado, type Sugestao } from './store';

const URL_AO_VIVO = process.env.TAQ_LIVE_URL;
const CHAVE = process.env.TAQ_LIVE_KEY;
const rodar = URL_AO_VIVO && CHAVE ? describe : describe.skip;

const REUNIAO = { id: 'demo-descoberta', titulo: 'Demonstração — Descoberta: atendimento da Prefeitura' };

const FALAS: FalaDaReuniao[] = (
  [
    ['Ana', 'Bom dia, pessoal. Obrigada por separarem esse tempo.'],
    ['Cliente', 'Bom dia! Tudo bem por aqui, vamos lá.'],
    ['Ana', 'Hoje a ideia é entender como funciona o atendimento aí hoje.'],
    ['Cliente', 'Certo. A gente tem muita reclamação, o povo demora demais.'],
    ['Ana', 'Entendi. E o que vocês já pensaram para resolver?'],
    ['Cliente', 'Acho que precisamos de um aplicativo.'],
    ['Ana', 'Hum, interessante.'],
    ['Cliente', 'É, o pessoal da diretoria gosta dessa ideia, todo mundo usa celular.'],
    ['Ana', 'Certo. Vou anotar isso.'],
    ['Cliente', 'E tem a questão do orçamento também, que está apertado.'],
    ['Ana', 'Em que momento o atendimento costuma travar hoje?'],
    ['Cliente', 'Na triagem. A fila da triagem passa de uma hora quase todo dia, a gente tem só dois atendentes lá.'],
    ['Ana', 'E isso acontece em quantos atendimentos, mais ou menos?'],
    ['Cliente', 'Uns sessenta por cento, a gente nunca mediu direito, mas é o que a equipe sente.'],
    ['Ana', 'Entendi. Quem poderia levantar esses dados?'],
    ['Cliente', 'A Marta consegue levantar isso até a semana que vem.'],
  ] as Array<[string, string]>
).map(([speaker, text], i) => ({ speaker, text, startOffsetMs: i * 20_000 }));

rodar('apoio à condução contra o provedor real', () => {
  const adaptador = criarAdaptadorHttp({ baseUrl: URL_AO_VIVO!, chave: CHAVE!, sintetica: true });
  const resultados: Record<string, unknown> = {};

  beforeAll(async () => {
    installChromeStorageMock();
    await salvarPerfil(
      {
        missao: 'Entender a necessidade real do cliente antes de falar de funcionalidades.',
        observar: ['Processo atual', 'Impacto', 'Restrições'],
        intervencao: { modo: 'discreto', estilo: 'Uma pergunta curta por vez, sem interromper' },
        contexto: [],
        preferencias: ['Explicar o motivo só quando eu pedir'],
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

  async function avaliar(corte: number, sugestoes: Sugestao[] = []) {
    return avaliarReuniao({
      adaptador,
      reuniao: REUNIAO,
      falas: FALAS,
      falasConsolidadas: corte,
      quemConduz: 'Ana',
      conducao: await lerConducao(),
      sugestoes,
      modo: 'discreto',
    });
  }

  it('propõe um perfil a partir do texto livre, sem salvar', async () => {
    const r = await proporPerfil({
      texto:
        'Conduzo reuniões de descoberta. Quero entender a necessidade real do cliente antes de discutir funcionalidades. ' +
        'Costumo esquecer de perguntar sobre impacto e processo atual. Me ajude com perguntas curtas, sem interromper toda hora.',
      adaptador,
    });
    console.log('\n[proposta]', JSON.stringify(r, null, 2));
    resultados.proposta = r.tipo;
    expect(['ok', 'sem_proposta', 'erro']).toContain(r.tipo);
    if (r.tipo === 'ok') {
      expect(r.proposta.missao.length).toBeGreaterThan(0);
      // Nada foi salvo pela proposta: o perfil guardado continua o do beforeAll.
      expect((await lerConducao()).perfil?.revisao).toBe(1);
    }
  }, 60_000);

  it('conversa só de cumprimentos (falas 0 e 1): o padrão é o silêncio', async () => {
    const r = await avaliar(2);
    console.log('\n[corte 2 — cumprimentos]', JSON.stringify(r, null, 2));
    expect(r.tipo === 'ok' || r.tipo === 'erro').toBe(true);
    if (r.tipo === 'ok') {
      resultados.silencioNosCumprimentos = r.nova === null;
      // A fonte citada, quando houver, existe e está antes do corte.
      for (const e of r.nova?.evidencias ?? []) expect(e.segmento).toBeLessThan(2);
    }
  }, 60_000);

  /**
   * Varredura: a mesma reunião, avaliada do início ao fim em cortes sucessivos e
   * SEM sugestões existentes (cada avaliação isolada). É o que mede a taxa de
   * sugestão do modelo antes da política — a política só reduz esse número.
   */
  it('varredura: quantas avaliações terminam em sugestão, e sobre o quê', async () => {
    const linhas: Array<{ corte: number; sugeriu: boolean; ponto?: string; citou?: number[]; latenciaMs?: number }> = [];
    for (const corte of [2, 4, 6, 8, 10, 12, 14, 16]) {
      const r = await avaliar(corte);
      if (r.tipo !== 'ok') continue;
      linhas.push({
        corte,
        sugeriu: r.nova !== null,
        ...(r.nova ? { ponto: r.nova.ponto, citou: r.nova.evidencias.map((e) => e.segmento) } : {}),
        ...(r.uso ? { latenciaMs: r.uso.latenciaMs } : {}),
      });
    }
    console.log('\n[varredura]\n' + linhas.map((l) => JSON.stringify(l)).join('\n'));
    resultados.varredura = {
      avaliacoes: linhas.length,
      comSugestao: linhas.filter((l) => l.sugeriu).length,
    };
    expect(linhas.length).toBeGreaterThan(0);
  }, 180_000);

  /**
   * A medida que importa: o LAÇO COMPLETO (política, orçamento, sugestões
   * existentes) sobre a mesma reunião, com relógio simulado. É o que a pessoa
   * veria — a varredura acima, sem estado, só mede o apetite do modelo.
   */
  it('simulação do laço ao vivo: o que a pessoa realmente veria', async () => {
    installChromeStorageMock();
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
    let relogio = 1_760_000_000_000;
    const laco = criarLaco({ adaptador, agora: () => relogio });
    for (const total of [4, 6, 8, 10, 12, 14, 16]) {
      relogio += 70_000;
      await laco.aoMudar({
        reuniao: REUNIAO,
        quemConduz: 'Ana',
        falas: FALAS.slice(0, total),
        encerrada: false,
        gravando: true,
      });
    }
    const { sugestoes, medicoes } = await lerApoio();
    console.log(
      '\n[laço completo]\n' +
        sugestoes
          .slice()
          .reverse()
          .map((s) => `${s.estado.padEnd(10)} rev ${String(s.revisao).padStart(2)} · ${s.ponto} · ${s.pergunta ?? s.texto}`)
          .join('\n') +
        '\n' +
        JSON.stringify(medicoes[REUNIAO.id]),
    );
    resultados.lacoCompleto = {
      sugestoesCriadas: sugestoes.length,
      mostradas: sugestoes.filter((s) => s.mostradaEm !== undefined).length,
      avaliacoes: medicoes[REUNIAO.id]?.avaliacoes ?? 0,
      erros: medicoes[REUNIAO.id]?.erros ?? 0,
    };
    // Garantias do código: nunca mais de uma na tela, e o mesmo ponto não aparece duas vezes.
    expect(sugestoes.filter((s) => s.estado === 'mostrada').length).toBeLessThanOrEqual(1);
    const pontosMostrados = sugestoes.filter((s) => s.mostradaEm !== undefined).map((s) => s.ponto.toLowerCase());
    expect(new Set(pontosMostrados).size).toBe(pontosMostrados.length);
  }, 300_000);

  it('fala vaga ("precisamos de um aplicativo"): sugere esclarecer, com fonte', async () => {
    const r = await avaliar(8);
    console.log('\n[corte 8 — solução antes do problema]', JSON.stringify(r, null, 2));
    if (r.tipo === 'ok') {
      resultados.sugestaoNaFalaVaga = r.nova !== null;
      for (const e of r.nova?.evidencias ?? []) {
        expect(e.segmento).toBeLessThan(8);
        expect(e.trecho).toBe(FALAS[e.segmento]!.text.trim().replace(/\s+/g, ' '));
      }
      if (r.nova) expect(['pergunta', 'esclarecimento', 'lembranca', 'fechamento']).toContain(r.nova.tipo);
    }
  }, 60_000);

  it('depois de o cliente responder, retira a sugestão que a conversa já resolveu, citando fala posterior', async () => {
    const g = await registrarSugestao({
      reuniaoId: REUNIAO.id,
      revisao: 8,
      tipo: 'pergunta',
      natureza: 'recomendacao',
      texto: 'Vale esclarecer em que etapa o atendimento trava.',
      pergunta: 'Em que momento o atendimento costuma travar hoje?',
      motivo: 'O cliente propôs uma solução antes de descrever o problema.',
      ponto: 'Onde ocorre a espera',
      doObjetivo: true,
      evidencias: [{ segmento: 5, trecho: FALAS[5]!.text }],
    });
    if (g.tipo !== 'ok') throw new Error('esperava ok');
    await mudarEstado(g.sugestao.id, 'mostrada');
    const existentes = (await lerApoio()).sugestoes;
    const r = await avaliar(14, existentes);
    console.log('\n[corte 14 — o cliente já respondeu onde trava]', JSON.stringify(r, null, 2));
    if (r.tipo === 'ok') {
      resultados.retirouOQueFoiRespondido = r.retiradas.some((x) => x.id === g.sugestao.id);
      // Retirada aceita sempre cita fala POSTERIOR à sugestão e já consolidada.
      for (const x of r.retiradas) {
        expect(x.fala).toBeGreaterThanOrEqual(8);
        expect(x.fala).toBeLessThan(14);
      }
      // Não repete o mesmo ponto.
      if (r.nova) expect(r.nova.ponto.toLowerCase()).not.toContain('onde ocorre a espera');
    }
  }, 60_000);

  it('resumo', () => {
    console.log('\n[resumo ao vivo]', JSON.stringify(resultados, null, 2));
    expect(true).toBe(true);
  });
});
