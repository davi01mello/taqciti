// A página "Preparar" (o que levar para todas as reuniões)
// contra a extensão RODANDO — HOME larga e HOME estreita.
//
// Dados [TESTE] semeados direto no storage. Nenhuma chamada de IA: o que se
// verifica é a tela, o preenchimento à mão, o que cada botão grava e se o que
// foi gravado volta ao recarregar, e a migração do perfil antigo (versão 4).
// Perfil isolado: nunca escreve no perfil pessoal do navegador.
//
//   npx vite build --mode development --outDir <pasta>
//   node scripts/verify-preparar.cjs <playwright-core> <pasta>
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || process.argv[2] || 'playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const extensao = path.resolve(process.argv[3] || 'dist-dev');
const saida = path.resolve(process.env.SAIDA || 'docs/verification/preparar');
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

    await tentar('Preparar: abre no Padrão do CITi, só leitura, e nada é salvo ao abrir', async () => {
      await page.goto(`${raiz}/src/home/index.html?secao=preparar`);
      await page.getByRole('heading', { name: 'O que levar para as reuniões' }).waitFor({ timeout: 10000 });
      await page.waitForTimeout(400);
      verificacoes.titulo_da_pagina = await page.locator('.tq-pagina-topo h1').innerText();
      verificacoes.padrao_escolhido = (await page.locator('.tq-levar-modos [aria-pressed="true"]').innerText()).trim();
      verificacoes.nos_do_padrao = await page.locator('.tq-mapa-no:not(.tq-mapa-vaga)').evaluateAll((ns) => ns.map((n) => n.querySelector('b')?.textContent));
      verificacoes.sem_adicionar_no_padrao = (await page.getByRole('button', { name: 'Adicionar contexto' }).count()) === 0;
      // 23/10/2026: 100% válido para todas as reuniões — sem escolher uma reunião.
      verificacoes.sem_preparar_uma_reuniao = (await page.getByRole('heading', { name: 'Preparar uma reunião' }).count()) === 0;
      verificacoes.sem_taq_no_texto = !/\bTaq\b|Mente/.test(await page.locator('.tq-levar').innerText());
      verificacoes.mapa_em_modo_mapa_1440 = (await page.locator('.tq-mapa-caixa.lista').count()) === 0;
      verificacoes.nada_salvo_ao_abrir = (await guardado(page))?.perfil ?? null;
      await page.screenshot({ path: path.join(saida, 'preparar-1440-padrao.png'), fullPage: true });
    });

    await tentar('Preparar: o centro mostra as regras que não mudam', async () => {
      await page.locator('.tq-mapa-centro').click();
      verificacoes.regras = await page.locator('.tq-ed-regras b').allInnerTexts();
      await page.locator('.tq-levar').screenshot({ path: path.join(saida, 'preparar-1440-centro.png') });
    });

    await tentar('Preparar: personalizar, adicionar e editar; só "Usar este assistente" grava', async () => {
      await page.getByRole('button', { name: /Personalizado/ }).click();
      await page.getByRole('button', { name: 'Adicionar contexto' }).click();
      await page.locator('.tq-ed-campo input').fill('[TESTE] Escopo do Portal');
      await page.locator('.tq-ed-campo textarea').fill('Primeira entrega: cadastro de voluntários e painel da coordenação. Ficam fora: app mobile e pagamentos.');
      verificacoes.contador = await page.locator('.tq-ed-conta').innerText();
      verificacoes.nada_salvo_antes_de_usar = (await guardado(page))?.perfil ?? null;
      verificacoes.status_pendente = await page.locator('.tq-levar-status').innerText();
      await page.screenshot({ path: path.join(saida, 'preparar-1440-editando.png'), fullPage: true });
      await page.getByRole('button', { name: 'Usar este assistente' }).click();
      await page.waitForTimeout(500);
      const g = await guardado(page);
      verificacoes.perfil_gravado = {
        base: g?.perfil?.base,
        revisao: g?.perfil?.revisao,
        contextos: g?.perfil?.contextos?.map((c) => `${c.nome} [${c.origem}${c.ligado ? '' : ', guardado'}] vaga ${c.vaga}`),
      };
      verificacoes.status_salvo = await page.locator('.tq-levar-status').innerText();
    });

    await tentar('Preparar: guardar um contexto muda o visual e o que vai', async () => {
      await page.locator('.tq-mapa-no', { hasText: 'Uma pergunta por vez' }).click();
      await page.locator('.tq-ed .tq-interruptor input').click();
      verificacoes.guardado_tem_classe = await page.locator('.tq-mapa-no', { hasText: 'Uma pergunta por vez' }).evaluate((n) => n.classList.contains('guardado'));
      await page.getByRole('button', { name: 'Usar este assistente' }).click();
      await page.waitForTimeout(500);
      verificacoes.guardado_gravado = (await guardado(page))?.perfil?.contextos?.find((c) => c.nome === 'Uma pergunta por vez')?.ligado === false;
      await page.screenshot({ path: path.join(saida, 'preparar-1440-personalizado.png'), fullPage: true });
    });

    await tentar('Preparar: o assistente volta ao recarregar', async () => {
      await page.reload();
      await page.getByRole('heading', { name: 'O que levar para as reuniões' }).waitFor();
      await page.waitForTimeout(400);
      verificacoes.voltou_personalizado = (await page.locator('.tq-levar-modos [aria-pressed="true"]').innerText()).includes('Personalizado');
      verificacoes.usar_desligado_sem_edicao = await page.getByRole('button', { name: 'Usar este assistente' }).isDisabled();
    });

    await tentar('HOME estreita (390px): o mapa vira lista, sem rolagem lateral', async () => {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(`${raiz}/src/home/index.html?secao=preparar`);
      await page.getByRole('heading', { name: 'O que levar para as reuniões' }).waitFor();
      await page.waitForTimeout(500);
      verificacoes.lista_em_390 = (await page.locator('.tq-mapa-caixa.lista').count()) === 1;
      verificacoes.sem_rolagem_lateral_390 = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      await page.screenshot({ path: path.join(saida, 'preparar-390.png'), fullPage: true });
      await page.locator('.tq-mapa-centro').click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(saida, 'preparar-390-centro.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    });

    /*
     * A migração da versão 4 contra a extensão de verdade: um perfil no formato
     * anterior, a versão do storage em 3, e a extensão recarregada (é no início
     * do background que as migrações rodam).
     */
    await tentar('Migração v4: o perfil antigo vira contextos ao reiniciar a extensão', async () => {
      await page.evaluate(async () =>
        chrome.storage.local.set({
          'taq:storageSchemaVersion': 3,
          'taq:conducao': {
            versao: 1,
            perfil: {
              missao: '[TESTE] Apoiar reuniões de descoberta.',
              observar: ['Impacto', 'Processo atual'],
              intervencao: { modo: 'participativo', estilo: 'Uma pergunta curta por vez' },
              contexto: [],
              preferencias: ['Explicar o motivo só quando eu pedir'],
              lerAoEncerrar: true,
              revisao: 4,
              criadoEm: 1,
              atualizadoEm: 2,
              historico: [],
            },
            briefings: [],
          },
        }),
      );
      const novoWorker = context.waitForEvent('serviceworker', { timeout: 20000 });
      await page.evaluate(() => chrome.runtime.reload()).catch(() => {});
      await novoWorker;
      // A aba antiga fechou junto com a extensão: espera fora dela.
      await new Promise((r) => setTimeout(r, 800));
      const nova = await context.newPage();
      await nova.goto(`${raiz}/src/home/index.html?secao=preparar`);
      await nova.getByRole('heading', { name: 'O que levar para as reuniões' }).waitFor();
      const bruto = await nova.evaluate(async () => chrome.storage.local.get(['taq:conducao', 'taq:storageSchemaVersion']));
      const p = bruto['taq:conducao']?.perfil;
      verificacoes.migracao_v4 = {
        versaoDoStorage: bruto['taq:storageSchemaVersion'],
        base: p?.base,
        revisao: p?.revisao,
        modo: p?.intervencao?.modo,
        lerAoEncerrar: p?.lerAoEncerrar,
        contextos: p?.contextos?.map((c) => `${c.nome}: ${c.texto}`),
        guardouOriginal: bruto['taq:conducao']?.perfilV1?.coubeInteiro,
      };
      await nova.waitForTimeout(400);
      await nova.screenshot({ path: path.join(saida, 'preparar-1440-migrado.png'), fullPage: true });
      await nova.close();
    });

    verificacoes.erros_de_pagina = erros;
  } finally {
    await context.close();
  }

  fs.writeFileSync(path.join(saida, 'resultado.json'), JSON.stringify({ verificacoes, falhas }, null, 2));
  console.log(JSON.stringify({ verificacoes, falhas }, null, 2));
  process.exit(falhas.length ? 1 : 0);
})();
