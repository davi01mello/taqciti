// Os cartões do Taq e a página "Acompanhamento"
// contra a extensão RODANDO — HOME larga, HOME estreita e sidebar.
//
// Dados [TESTE] semeados direto no storage (reunião, registros de trabalho e
// uma resposta do Taq com um cartão de cada tipo). Nenhuma chamada de IA: o
// que se verifica é a tela e as operações dos botões, que não usam modelo.
// Perfil isolado: nunca escreve no perfil pessoal do navegador.
//
//   npx vite build --mode development --outDir <pasta>
//   node scripts/verify-trabalho.cjs <playwright-core> <pasta>
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || process.argv[2] || 'playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const extensao = path.resolve(process.argv[3] || 'dist-dev');
const saida = path.resolve('docs/verification/trabalho');
fs.mkdirSync(saida, { recursive: true });

const agora = Date.now();
const REUNIAO = {
  id: 'teste-trabalho',
  title: '[TESTE] Escopo do Painel Aurora',
  startedAt: Date.parse('2026-09-23T13:00:00Z'),
  endedAt: Date.parse('2026-09-23T13:30:00Z'),
  durationSeconds: 1800,
  participants: [{ name: 'Júlia — teste', isHost: true }, { name: 'Marcos — teste', isHost: false }],
  segments: [
    ['Júlia — teste', 'O escopo da fase 1 é só a visualização dos relatórios na tela.'],
    ['Marcos — teste', 'Eu fico com o protótipo navegável até sexta-feira.'],
    ['Júlia — teste', 'Alguém precisa escrever os critérios de aceite.'],
  ].map(([speaker, text], i) => ({ captionId: `t-${i}`, speaker, text, startOffsetMs: i * 20000, endOffsetMs: i * 20000 + 9000 })),
  status: 'ready',
  metadata: { capturedCaptions: true, droppedSegments: 0, reconnectCount: 1, wasDiscardedAndRestarted: false },
};
const ev = (i) => ({
  tipo: 'reuniao',
  registroId: REUNIAO.id,
  titulo: REUNIAO.title,
  versao: `${REUNIAO.endedAt}:3`,
  trecho: REUNIAO.segments[i].text,
  segmento: i,
  offsetMs: REUNIAO.segments[i].startOffsetMs,
});
const hist = (acao, origem = 'taq') => [{ em: agora, acao, origem }];
const base = (id, chave, i) => ({ id, chave, revisao: 1, criadoEm: agora, atualizadoEm: agora, historico: hist('registrado'), evidencias: [ev(i)], reuniaoId: REUNIAO.id });
const TRABALHO = {
  versao: 1,
  compromissos: [
    { ...base('k-proto', 'compromisso:teste:1', 1), descricao: '[TESTE] Entregar o protótipo navegável', responsavel: { nome: 'Marcos — teste', confirmado: true }, prazo: { texto: 'até sexta-feira', data: '2026-09-26' }, estado: 'aberto', dependeDe: [] },
    { ...base('k-crit', 'compromisso:teste:2', 2), descricao: '[TESTE] Escrever os critérios de aceite', responsavel: null, prazo: null, estado: 'aberto', dependeDe: ['k-proto'] },
  ],
  decisoes: [
    { ...base('e-1', 'decisao:teste:1', 0), assunto: 'Exportação', texto: '[TESTE] PDF na fase 1', estado: 'substituida', substituidaPor: 'e-2' },
    { ...base('e-2', 'decisao:teste:2', 0), assunto: 'Exportação', texto: '[TESTE] PDF fica para a fase 2', estado: 'confirmada', substitui: 'e-1', motivo: 'prioridade da visualização' },
  ],
  achados: [
    {
      ...base('a-1', 'achado:teste:1', 0),
      tipo: 'desalinhamento',
      assunto: '[TESTE] Exportação em PDF',
      entendimentos: [
        { area: 'Comercial', texto: 'prometeu exportação em PDF', evidencia: ev(0) },
        { area: 'Produto', texto: 'fase 1 só com visualização', evidencia: ev(0) },
      ],
      impacto: 'o cliente pode esperar o PDF na primeira entrega',
      pergunta: 'O PDF entra na fase 1 ou na 2?',
      classificacao: 'possivel',
      estado: 'aberto',
    },
  ],
  analises: [
    {
      ...base('n-1', 'analise:teste', 0),
      versaoDaReuniao: `${REUNIAO.endedAt}:3`,
      instrucoes: 'meeting_analyst',
      cobertura: { lidos: 3, total: 3 },
      lacunas: ['A captura reconectou 1 vez(es); falas durante a reconexão podem faltar.'],
      secoes: {
        visaoGeral: [{ texto: '[TESTE] Definição do escopo da fase 1', evidencias: [ev(0)] }],
        decisoes: [{ texto: '[TESTE] Fase 1 só com visualização', evidencias: [ev(0)] }],
        questoes: [{ texto: '[TESTE] Quem escreve os critérios de aceite?', evidencias: [ev(2)] }],
        riscos: [],
        proximosPassos: [{ texto: '[TESTE] Protótipo navegável até sexta (Marcos)', evidencias: [ev(1)] }],
      },
    },
  ],
};
const CONVERSA = {
  id: 'c-teste-trabalho',
  title: '[TESTE] Próximos passos do Painel Aurora',
  createdAt: 1,
  updatedAt: agora,
  messages: [
    { id: 'u1', role: 'user', text: '[TESTE] Organize os próximos passos e prepare um e-mail para a Júlia', at: 1 },
    {
      id: 'r1',
      role: 'assistant',
      text: '[TESTE] Resposta semeada para a verificação da tela — sem IA.',
      at: 2,
      desfecho: 'concluido',
      cartoes: [
        { tipo: 'analise', id: 'n-1' },
        { tipo: 'sugestoes_de_compromisso', reuniaoId: REUNIAO.id, itens: [{ descricao: '[TESTE] Revisar o contrato', responsavel: null, prazo: null, evidencias: [ev(2)] }] },
        { tipo: 'compromissos', ids: ['k-proto', 'k-crit'] },
        { tipo: 'decisoes', ids: ['e-2', 'e-1'] },
        { tipo: 'achados', ids: ['a-1'] },
        {
          tipo: 'rascunho_de_mensagem',
          canal: 'email',
          publico: 'interno',
          destinatarios: [{ nome: 'Júlia — teste', endereco: 'julia@teste.invalid', situacao: 'informado' }, { nome: 'Ana', situacao: 'ambiguo', candidatos: ['Ana Souza', 'Ana Lima'] }],
          assunto: '[TESTE] Exportação em PDF',
          corpo: 'Oi, Júlia!\n\n[TESTE] O PDF ficou para a fase 2.',
          alertas: [],
        },
        {
          tipo: 'sugestao_de_evento',
          titulo: '[TESTE] Revisão do escopo',
          duracaoMin: 30,
          fuso: 'America/Recife',
          participantes: ['Júlia — teste'],
          opcoes: [{ inicio: '2026-10-02T17:00:00.000Z', fim: '2026-10-02T17:30:00.000Z', rotulo: 'sex., 02/10, 14:00' }],
        },
        { tipo: 'estado_da_captura', reuniaoId: REUNIAO.id, titulo: REUNIAO.title, situacao: 'encerrada', avaliacao: 'com_ressalvas', sinais: ['A captura reconectou 1 vez(es); falas durante a reconexão podem faltar.'], intervalos: [], segmentos: 3 },
      ],
    },
  ],
};

const verificacoes = {};
const falhas = [];

(async () => {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'taqciti-trabalho-'));
  const context = await chromium.launchPersistentContext(perfil, {
    executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: [`--disable-extensions-except=${extensao}`, `--load-extension=${extensao}`],
    viewport: { width: 1440, height: 1000 },
  });
  const tentar = async (etapa, fn) => {
    try {
      await fn();
    } catch (e) {
      falhas.push(`${etapa}: ${e.message.split('\n')[0]}`);
      console.log(`! ${etapa}: ${e.message.split('\n')[0]}`);
    }
  };
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
    const raiz = `chrome-extension://${new URL(worker.url()).host}`;
    const page = await context.newPage();
    await page.goto(`${raiz}/src/home/index.html`);
    await page.locator('.tq-home').waitFor();
    await page.evaluate(
      async ([r, t, c]) => chrome.storage.local.set({ 'taq:history': [r], 'taq:trabalho': t, 'taq:conversations': [c] }),
      [REUNIAO, TRABALHO, CONVERSA],
    );

    await tentar('HOME: cartões na conversa', async () => {
      await page.goto(`${raiz}/src/home/index.html?secao=assistente`);
      await page.locator('.tq-cartoes').waitFor({ timeout: 10000 });
      await page.waitForTimeout(600);
      const tipos = await page.locator('.tq-c h4').allInnerTexts();
      verificacoes.cartoes_na_home = tipos;
      verificacoes.botao_enviar_ausente = (await page.getByRole('button', { name: 'Enviar', exact: true }).count()) === 0;
      verificacoes.botao_agendar_ausente = (await page.getByRole('button', { name: 'Agendar', exact: true }).count()) === 0;
      const href = await page.getByRole('link', { name: 'Abrir no Google Agenda' }).getAttribute('href');
      verificacoes.agenda_sem_convidados = !new URL(href).searchParams.has('add');
      await page.screenshot({ path: path.join(saida, 'home-cartoes.png'), fullPage: true });
    });

    await tentar('HOME: concluir compromisso persiste ao recarregar', async () => {
      await page.getByRole('button', { name: 'Marcar como concluído' }).first().click();
      await page.waitForTimeout(400);
      await page.reload();
      await page.locator('.tq-cartoes').waitFor();
      await page.waitForTimeout(500);
      const estado = await page.evaluate(async () => {
        const t = (await chrome.storage.local.get('taq:trabalho'))['taq:trabalho'];
        return t.compromissos.find((c) => c.id === 'k-proto').estado;
      });
      verificacoes.compromisso_concluido_persistiu = estado === 'concluido';
      verificacoes.reabrir_visivel_apos_recarregar = (await page.getByRole('button', { name: 'Reabrir' }).count()) > 0;
    });

    await tentar('HOME: fonte abre o trecho', async () => {
      await page.locator('.tq-c-fonte').first().click();
      verificacoes.trecho_visivel = await page.locator('.tq-c-trecho q').first().isVisible();
    });

    await tentar('HOME: Acompanhamento', async () => {
      await page.goto(`${raiz}/src/home/index.html?secao=acompanhamento`);
      await page.getByRole('heading', { name: 'Acompanhamento' }).waitFor();
      await page.waitForTimeout(400);
      verificacoes.acompanhamento_secoes = await page.locator('.tq-acompanhamento .tq-c h4').allInnerTexts();
      await page.screenshot({ path: path.join(saida, 'home-acompanhamento.png'), fullPage: true });
      await page.getByRole('button', { name: 'Marcar resolvido' }).first().click();
      await page.getByLabel('O que resolveu?').fill('[TESTE] decisão: PDF na fase 2');
      await page.locator('.tq-c-motivo').getByRole('button', { name: 'Confirmar' }).click();
      await page.waitForTimeout(400);
      verificacoes.achado_resolvido_some_dos_abertos = (await page.getByText('Nenhum achado aberto.').count()) === 1;
    });

    await tentar('HOME estreita (390px)', async () => {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(`${raiz}/src/home/index.html?secao=assistente`);
      await page.locator('.tq-cartoes').waitFor();
      await page.waitForTimeout(500);
      verificacoes.sem_rolagem_lateral_390 = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      await page.screenshot({ path: path.join(saida, 'home-estreita-cartoes.png'), fullPage: true });
      await page.goto(`${raiz}/src/home/index.html?secao=acompanhamento`);
      await page.getByRole('heading', { name: 'Acompanhamento' }).waitFor();
      verificacoes.acompanhamento_sem_rolagem_lateral_390 = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );
      await page.screenshot({ path: path.join(saida, 'home-estreita-acompanhamento.png'), fullPage: true });
    });

    await tentar('Sidebar', async () => {
      const lado = await context.newPage();
      await lado.setViewportSize({ width: 400, height: 900 });
      await lado.goto(`${raiz}/src/sidepanel/index.html`);
      await lado.waitForTimeout(1200);
      const seletor = lado.getByRole('button', { name: 'Escolher conversa' });
      if (await seletor.count()) {
        await seletor.first().click();
        await lado.getByText(CONVERSA.title).first().click({ timeout: 5000 });
        await lado.waitForTimeout(600);
      }
      verificacoes.sidebar_cartoes = await lado.locator('.tq-c h4').allInnerTexts();
      verificacoes.sidebar_sem_rolagem_lateral = await lado.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      await lado.screenshot({ path: path.join(saida, 'sidebar-cartoes.png'), fullPage: true });
    });
  } finally {
    fs.writeFileSync(
      path.join(saida, 'resultado.json'),
      JSON.stringify({ quando: new Date().toISOString(), verificacoes, falhas }, null, 2),
    );
    console.log(JSON.stringify({ verificacoes, falhas }, null, 2));
    await context.close();
  }
})();
