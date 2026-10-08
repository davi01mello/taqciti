// @vitest-environment node
/**
 * TESTE AO VIVO — o teste histórico por cortes e a frase de fechamento do estado,
 * contra o servidor e o provedor DE VERDADE, com uma reunião INVENTADA.
 *
 * Pulado por padrão. Roda com o servidor no ar (ver `apoio.live.test.ts`):
 *
 *   $env:TAQ_LIVE_URL = 'http://localhost:3100'
 *   $env:TAQ_LIVE_KEY = '<o DOCCITI_SHARED_KEY do servidor>'
 *   npx vitest run src/features/calibracao/historico.live.test.ts
 *
 * O modelo não é determinístico: o que o CÓDIGO garante é conferido (fontes antes
 * do corte, nada deixado gravado, teto de chamadas); o resto é impresso.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { lerConducao, salvarBriefing, salvarPerfil } from '@/features/conducao/store';
import { criarAdaptadorHttp } from '@/features/taq/modelo';
import { atualizarEstadoDaReuniao } from '@/features/estado/atualizar';
import { lerEstados } from '@/features/estado/store';
import { lerApoio } from '@/features/apoio/store';
import { reproduzirReuniao } from './historico';

const URL_AO_VIVO = process.env.TAQ_LIVE_URL;
const CHAVE = process.env.TAQ_LIVE_KEY;
const rodar = URL_AO_VIVO && CHAVE ? describe : describe.skip;

const FALAS = (
  [
    ['Ana', 'Bom dia, pessoal. Obrigada por separarem esse tempo.'],
    ['Cliente', 'Bom dia! Tudo bem por aqui, vamos lá.'],
    ['Ana', 'Hoje a ideia é entender como funciona o atendimento aí hoje.'],
    ['Cliente', 'Certo. A gente tem muita reclamação, o povo demora demais.'],
    ['Ana', 'Entendi. E o que vocês já pensaram para resolver?'],
    ['Cliente', 'Acho que precisamos de um aplicativo.'],
    ['Ana', 'Hum, interessante.'],
    ['Cliente', 'É, o pessoal da diretoria gosta dessa ideia, todo mundo usa celular.'],
    ['Ana', 'Certo. Vou anotar isso e a gente volta nesse ponto.'],
    ['Cliente', 'E tem a questão do orçamento também, que está bem apertado este ano.'],
    ['Ana', 'Em que momento o atendimento costuma travar hoje?'],
    ['Cliente', 'Na triagem. A fila da triagem passa de uma hora quase todo dia, a gente tem só dois atendentes lá.'],
    ['Ana', 'E isso acontece em quantos atendimentos, mais ou menos?'],
    ['Cliente', 'Uns sessenta por cento, a gente nunca mediu direito, mas é o que a equipe sente.'],
    ['Ana', 'Entendi. Alguém precisa levantar esses dados.'],
    ['Cliente', 'Isso, mas ainda não sei quem vai fazer isso, vou ver com a equipe.'],
  ] as Array<[string, string]>
).map(([speaker, text], i) => ({ speaker, text, startOffsetMs: i * 20_000 }));

const REUNIAO = { id: 'demo-descoberta', titulo: 'Demonstração — Descoberta: atendimento da Prefeitura' };

rodar('histórico e fechamento contra o provedor real', () => {
  const adaptador = criarAdaptadorHttp({ baseUrl: URL_AO_VIVO!, chave: CHAVE!, sintetica: true });

  beforeAll(async () => {
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
  });

  it('reproduz a reunião por cortes: só o passado em cada corte, e nada fica gravado', async () => {
    const r = await reproduzirReuniao({ adaptador, reuniao: REUNIAO, falas: FALAS, passoMs: 60_000, maxAvaliacoes: 5 });
    console.log(
      '\n[histórico]\n' +
        r.linhas
          .map(
            (l) =>
              `${String(Math.round(l.noInstanteMs / 1000)).padStart(4)}s falas=${String(l.falasVistas).padStart(2)} lidas=${String(l.falasConsolidadas).padStart(2)} ${l.acao.padEnd(9)} ${l.sugestao ? `${l.sugestao.ponto} — ${l.sugestao.pergunta ?? l.sugestao.texto} (falas ${l.sugestao.falasCitadas})` : ''}`,
          )
          .join('\n') +
        `\navaliacoes=${r.avaliacoes} mostradas=${r.sugestoesMostradas} erros=${r.erros} teto=${r.paradoPeloTeto} fontesValidas=${r.fontesValidas}`,
    );
    expect(r.fontesValidas).toBe(true);
    expect(r.avaliacoes).toBeLessThanOrEqual(5);
    // O teste não deixou nada gravado, nem sob o id real.
    const apoio = await lerApoio();
    expect(apoio.sugestoes).toEqual([]);
    expect(apoio.medicoes).toEqual({});
  }, 300_000);

  it('o estado dos pontos devolve uma frase de fechamento coerente com o que ficou em aberto', async () => {
    const r = await atualizarEstadoDaReuniao({
      adaptador,
      reuniao: REUNIAO,
      falas: FALAS,
      falasConsolidadas: FALAS.length,
      conducao: await lerConducao(),
    });
    const s = (await lerEstados())[REUNIAO.id];
    console.log('\n[estado]', r.tipo, JSON.stringify(s?.pontos.map((p) => `${p.estado}: ${p.texto} dono=${p.dono ?? '-'}`)), '\n[fechamento]', JSON.stringify(s?.fechamento), '\n[recusados]', r.tipo === 'ok' ? JSON.stringify(r.recusados) : '');
    if (r.tipo === 'ok' && s) {
      for (const p of s.pontos) for (const e of p.evidencias) expect(e.segmento).toBeLessThan(FALAS.length);
      expect(s.fechamento?.revisao ?? FALAS.length).toBe(FALAS.length);
    }
  }, 120_000);
});
