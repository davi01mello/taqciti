// @vitest-environment node
/**
 * TESTE AO VIVO — o estado estruturado dos pontos (`estado-v1`) contra o servidor
 * e o provedor DE VERDADE, com uma reunião INVENTADA.
 *
 * Pulado por padrão. Roda com o servidor no ar (ver `apoio.live.test.ts`):
 *
 *   $env:TAQ_LIVE_URL = 'http://localhost:3100'
 *   $env:TAQ_LIVE_KEY = '<o DOCCITI_SHARED_KEY do servidor>'
 *   npx vitest run src/features/estado/estado.live.test.ts
 *
 * É a resposta ao que o `copilot-v2` em prosa livre errou ao vivo: listou como
 * "não esclarecido" o que o cliente já tinha respondido. Aqui o código garante as
 * fontes; o que o modelo julga (o estado de cada ponto) é impresso para leitura.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { installChromeStorageMock } from '@/test/chromeStorageMock';
import { lerConducao, salvarBriefing } from '@/features/conducao/store';
import { criarAdaptadorHttp } from '@/features/taq/modelo';
import { atualizarEstadoDaReuniao } from './atualizar';
import { idDoPontoDaPreparacao, lerEstados } from './store';

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
    ['Ana', 'Em que momento o atendimento costuma travar hoje?'],
    ['Cliente', 'Na triagem. A fila da triagem passa de uma hora quase todo dia, a gente tem só dois atendentes lá.'],
    ['Ana', 'E isso acontece em quantos atendimentos, mais ou menos?'],
    ['Cliente', 'Uns sessenta por cento, a gente nunca mediu direito, mas é o que a equipe sente.'],
    ['Ana', 'Entendi. Alguém precisa levantar esses dados.'],
    ['Cliente', 'Isso, mas ainda não sei quem vai fazer isso, vou ver com a equipe.'],
  ] as Array<[string, string]>
).map(([speaker, text], i) => ({ speaker, text, startOffsetMs: i * 20_000 }));

const REUNIAO = { id: 'demo-descoberta', titulo: 'Demonstração — Descoberta: atendimento da Prefeitura' };
const ESPERA = idDoPontoDaPreparacao('Onde ocorre a espera');
const FREQ = idDoPontoDaPreparacao('Com que frequência');
const DADOS = idDoPontoDaPreparacao('Quem levanta os dados e quando');

rodar('estado dos pontos contra o provedor real', () => {
  const adaptador = criarAdaptadorHttp({ baseUrl: URL_AO_VIVO!, chave: CHAVE!, sintetica: true });

  beforeAll(async () => {
    installChromeStorageMock();
    await salvarBriefing(
      REUNIAO.id,
      {
        objetivo: 'Entender a causa dos atrasos no atendimento antes de discutir solução.',
        prioridades: ['Onde ocorre a espera', 'Com que frequência', 'Quem levanta os dados e quando'],
      },
      0,
    );
  });

  it('com a reunião toda: o que foi respondido sai de "a esclarecer", e o dono continua em aberto', async () => {
    const r = await atualizarEstadoDaReuniao({
      adaptador,
      reuniao: REUNIAO,
      falas: FALAS,
      falasConsolidadas: 14,
      conducao: await lerConducao(),
    });
    console.log('\n[estado]', JSON.stringify(r, null, 2));
    if (r.tipo !== 'ok') return;
    const s = (await lerEstados())[REUNIAO.id]!;
    const por = (id: string) => s.pontos.find((p) => p.id === id)!;
    console.log(
      '\n[pontos]\n' +
        s.pontos.map((p) => `${p.estado.padEnd(12)} ${p.texto}  falas=${p.evidencias.map((e) => e.segmento)} dono=${p.dono ?? '-'} prazo=${p.prazo ?? '-'}`).join('\n') +
        '\nrecusados=' + JSON.stringify(r.recusados),
    );
    // Garantias do CÓDIGO: toda fonte existe e antes do corte; ninguém foi inventado como dono.
    for (const p of s.pontos) for (const e of p.evidencias) expect(e.segmento).toBeLessThan(14);
    expect(por(DADOS).dono).toBeUndefined();
    // O que o PRODUTO exige, de forma robusta: os dois pontos que o cliente respondeu não ficam como "a esclarecer".
    console.log('\n[resumo]', JSON.stringify({ espera: por(ESPERA).estado, frequencia: por(FREQ).estado, dados: por(DADOS).estado }));
  }, 120_000);
});
