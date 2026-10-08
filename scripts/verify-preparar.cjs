// A página "Preparar" (perfil de condução e briefing da reunião)
// contra a extensão RODANDO — HOME larga e HOME estreita.
//
// Dados [TESTE] semeados direto no storage. Nenhuma chamada de IA: o que se
// verifica é a tela, o preenchimento à mão, o que cada botão grava e se o que
// foi gravado volta ao recarregar. "Organizar o que entendi" depende do
// servidor e do provedor, e fica fora daqui (testado com modelo roteirizado).
// Perfil isolado: nunca escreve no perfil pessoal do navegador.
//
//   npx vite build --mode development --outDir <pasta>
//   node scripts/verify-preparar.cjs <playwright-core> <pasta>
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || process.argv[2] || 'playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const extensao = path.resolve(process.argv[3] || 'dist-dev');
const saida = path.resolve('docs/verification/preparar');
fs.mkdirSync(saida, { recursive: true });

const REUNIAO = {
  id: 'teste-preparar',
  title: '[TESTE] Descoberta com a Prefeitura',
  startedAt: Date.parse('2026-10-06T13:00:00Z'),
  endedAt: Date.parse('2026-10-06T13:30:00Z'),
  durationSeconds: 1800,
  participants: [{ name: 'Júlia — teste', isHost: true }],
  segments: [
    { captionId: 't-0', speaker: 'Júlia — teste', text: 'Acho que precisamos de um aplicativo.', startOffsetMs: 0, endOffsetMs: 4000 },
  ],
  status: 'ready',
  metadata: { capturedCaptions: true, droppedSegments: 0, reconnectCount: 0, wasDiscardedAndRestarted: false },
};

const verificacoes = {};
const falhas = [];

(async () => {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'taqciti-preparar-'));
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
  const guardado = (page) =>
    page.evaluate(async () => (await chrome.storage.local.get('taq:conducao'))['taq:conducao'] ?? null);
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
    const raiz = `chrome-extension://${new URL(worker.url()).host}`;
    const page = await context.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await page.goto(`${raiz}/src/home/index.html`);
    await page.locator('.tq-home').waitFor();
    await page.evaluate(async (r) => chrome.storage.local.set({ 'taq:history': [r] }), REUNIAO);

    await tentar('Preparar: abre pela navegação e mostra as duas partes', async () => {
      await page.goto(`${raiz}/src/home/index.html?secao=preparar`);
      await page.getByRole('heading', { name: 'Como você quer conduzir suas reuniões?' }).waitFor({ timeout: 10000 });
      verificacoes.titulo_da_pagina = await page.locator('.tq-pagina-topo h1').innerText();
      verificacoes.tem_preparar_uma_reuniao = (await page.getByRole('heading', { name: 'Preparar uma reunião' }).count()) === 1;
      verificacoes.usar_desligado_sem_missao = await page.getByRole('button', { name: 'Usar este assistente' }).isDisabled();
      verificacoes.organizar_desligado_sem_texto = await page.getByRole('button', { name: /Organizar o que entendi/ }).isDisabled();
      verificacoes.nada_salvo_ao_abrir = (await guardado(page)) === null;
      await page.screenshot({ path: path.join(saida, 'preparar-vazio.png'), fullPage: true });
    });

    await tentar('Preparar: resumo à mão, "Usar este assistente" grava', async () => {
      await page.getByLabel('Em que vou ajudar').fill('[TESTE] Entender a necessidade real antes de falar de funcionalidades.');
      await page.getByLabel('O que vou observar (um por linha)').fill('Processo atual\nImpacto');
      await page.getByLabel(/Discreto/).check();
      await page.getByLabel('O jeito, em suas palavras').fill('Uma pergunta curta por vez');
      verificacoes.nada_salvo_antes_de_usar = (await guardado(page)) === null;
      await page.getByRole('button', { name: 'Usar este assistente' }).click();
      await page.waitForTimeout(500);
      const g = await guardado(page);
      verificacoes.perfil_gravado = {
        revisao: g?.perfil?.revisao,
        missao: g?.perfil?.missao,
        observar: g?.perfil?.observar,
        modo: g?.perfil?.intervencao?.modo,
      };
      verificacoes.diz_que_esta_salvo = (await page.getByText(/Salvo \(versão 1\)/).count()) === 1;
      await page.screenshot({ path: path.join(saida, 'preparar-perfil-salvo.png'), fullPage: true });
    });

    await tentar('Preparar: o perfil volta ao recarregar', async () => {
      await page.reload();
      await page.getByLabel('Em que vou ajudar').waitFor();
      await page.waitForTimeout(400);
      verificacoes.perfil_voltou = await page.getByLabel('Em que vou ajudar').inputValue();
      verificacoes.usar_desligado_sem_edicao = await page.getByRole('button', { name: 'Usar este assistente' }).isDisabled();
    });

    await tentar('Preparar: briefing sem objetivo não finge objetivo', async () => {
      await page.locator('.tq-prep select').selectOption(REUNIAO.id);
      await page.getByLabel('O que já sabemos').fill('[TESTE] O cliente relatou filas, sem medição.');
      await page.getByRole('button', { name: 'Salvar a preparação' }).click();
      await page.waitForTimeout(500);
      const b = (await guardado(page))?.briefings?.[0];
      verificacoes.briefing_sem_objetivo = { objetivo: b?.objetivo, aprovado: b?.aprovado };
      verificacoes.diz_que_nao_supoe = (await page.getByText(/o Taq não vai supor um/).count()) === 1;
    });

    await tentar('Preparar: briefing com objetivo, prioridades e perfil fixado', async () => {
      await page.getByLabel('O resultado que queremos alcançar').fill('[TESTE] Decidir se o piloto começa com uma ou duas unidades.');
      await page.getByLabel(/O que não pode ficar sem encaminhamento/).fill('Quem levanta os dados?\nQuando revisamos?');
      await page.getByRole('button', { name: 'Salvar a preparação' }).click();
      await page.waitForTimeout(500);
      const g = await guardado(page);
      const b = g?.briefings?.[0];
      verificacoes.briefing_gravado = {
        aprovado: b?.aprovado,
        prioridades: b?.prioridades,
        perfilRevisao: b?.perfilRevisao,
        perfilUsadoMissao: b?.perfilUsado?.missao,
      };
      await page.screenshot({ path: path.join(saida, 'preparar-briefing.png'), fullPage: true });
    });

    await tentar('Preparar: mudar o perfil não muda a reunião já preparada', async () => {
      await page.getByLabel('Em que vou ajudar').fill('[TESTE] Missão NOVA depois da reunião preparada.');
      await page.getByRole('button', { name: 'Usar este assistente' }).click();
      await page.waitForTimeout(500);
      const b = (await guardado(page))?.briefings?.[0];
      verificacoes.reuniao_mantem_perfil_antigo = b?.perfilUsado?.missao?.startsWith('[TESTE] Entender') === true;
      verificacoes.oferece_usar_versao_atual = (await page.getByRole('button', { name: 'Usar a versão atual' }).count()) === 1;
      await page.getByRole('button', { name: 'Usar a versão atual' }).click();
      await page.waitForTimeout(500);
      const b2 = (await guardado(page))?.briefings?.[0];
      verificacoes.passou_a_usar_o_atual = b2?.perfilUsado?.missao?.includes('Missão NOVA') === true;
    });

    await tentar('Preparar: a navegação lista "Preparar"', async () => {
      await page.locator('.tq-edge').click();
      // A barra recolhida esconde o texto de `innerText`; `textContent` lê o que está no DOM.
      const rotulos = await page.locator('.tq-navlinks button').evaluateAll((bs) => bs.map((b) => b.textContent));
      verificacoes.secoes_da_navegacao = rotulos.map((t) => t.trim());
    });

    await tentar('HOME estreita (390px)', async () => {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(`${raiz}/src/home/index.html?secao=preparar`);
      await page.getByLabel('Em que vou ajudar').waitFor();
      await page.waitForTimeout(500);
      verificacoes.sem_rolagem_lateral_390 = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      await page.screenshot({ path: path.join(saida, 'preparar-390.png'), fullPage: true });
    });

    verificacoes.erros_de_pagina = erros;
  } finally {
    await context.close();
  }

  fs.writeFileSync(path.join(saida, 'resultado.json'), JSON.stringify({ verificacoes, falhas }, null, 2));
  console.log(JSON.stringify({ verificacoes, falhas }, null, 2));
  process.exit(falhas.length ? 1 : 0);
})();
