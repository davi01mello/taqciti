/**
 * Verificação no navegador dos botões de APAGAR da HOME: documento, conversa e
 * notas da reunião.
 *
 * Os testes de componente rodam em jsdom, que não faz layout: eles provam a
 * estrutura (o que existe, o que foi gravado), nunca que o botão está visível,
 * dentro da linha e fora de cima do título. É isso que esta passada cobre —
 * com `chrome.storage.local` de verdade, num perfil temporário isolado.
 *
 * Perfil isolado: nunca escreve no perfil pessoal do navegador.
 *
 *   node scripts/verify-apagar.cjs <caminho-do-playwright-core>
 *
 * `BROWSER_PATH` aponta para outro Chromium que aceite `--load-extension`.
 */
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE_PATH || process.argv[2] || 'playwright-core',
);
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');

const output = path.resolve('docs/verification/apagar');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'taqciti-apagar-'));
const extension = path.resolve('dist');

const REUNIAO = {
  id: 'teste-reuniao',
  title: '[TESTE] Planejamento do projeto',
  startedAt: Date.parse('2026-09-20T13:00:00Z'),
  endedAt: Date.parse('2026-09-20T13:40:00Z'),
  durationSeconds: 2400,
  participants: [{ name: 'Ana — teste', isHost: true }],
  segments: Array.from({ length: 12 }, (_, i) => ({
    captionId: `teste-${i}`,
    speaker: 'Ana — teste',
    text: '[TESTE] Combinado revisar o protótipo com a equipe até sexta-feira.',
    startOffsetMs: i * 35000,
    endOffsetMs: i * 35000 + 12000,
  })),
  status: 'ready',
  metadata: {
    capturedCaptions: true,
    droppedSegments: 0,
    reconnectCount: 0,
    wasDiscardedAndRestarted: false,
  },
};

const documento = (id, title) => ({
  id,
  title,
  content: `# ${title}\n\n[TESTE] Conteúdo de verificação.`,
  formato: 'markdown',
  createdAt: 1,
  updatedAt: Date.parse('2026-09-20T14:00:00Z'),
  meetingId: REUNIAO.id,
  tipo: 'Ata de Reunião',
  origem: 'gerado',
});

const conversa = (id, title, at) => ({
  id,
  title,
  createdAt: at,
  updatedAt: at,
  messages: [{ id: `m-${id}`, role: 'user', text: title, at }],
});

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath:
      process.env.BROWSER_PATH ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1440, height: 1000 },
  });

  const checks = [];
  const check = (nome) => {
    checks.push(nome);
    console.log('PASS', nome);
  };
  const errors = [];

  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
    const id = new URL(worker.url()).host;
    const base = `chrome-extension://${id}`;

    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/src/home/index.html`);
    await page.locator('.tq-home').waitFor();

    const ler = (chave) =>
      page.evaluate(async (k) => (await chrome.storage.local.get(k))[k], chave);

    await page.evaluate(
      async ([reuniao, docs, conversas]) => {
        await chrome.storage.local.set({
          'taq:history': [reuniao],
          'taq:documents': docs,
          'taq:conversations': conversas,
          'taq:notes': {
            [reuniao.id]: {
              meetingId: reuniao.id,
              texto: '[TESTE] Decisão: revisar o protótipo com a equipe.',
              updatedAt: 1,
            },
          },
        });
      },
      [
        REUNIAO,
        [documento('d-1', '[TESTE] Ata que fica'), documento('d-2', '[TESTE] Ata que some')],
        [conversa('c-1', '[TESTE] conversa aberta', 2), conversa('c-2', '[TESTE] conversa antiga', 1)],
      ],
    );
    // ------------------------------------------------------------ documentos
    await page.goto(`${base}/src/home/index.html?secao=documentos`);
    await page.locator('.tq-item-linha').first().waitFor();

    const linhas = page.locator('.tq-item-linha');
    assert.equal(await linhas.count(), 2);

    // O que o jsdom não vê: o botão TEM caixa, está à direita do item e não o
    // cobre. Aninhado ou sobreposto, o clique acertaria o alvo errado.
    const linha = linhas.filter({ hasText: 'Ata que some' });
    const item = await linha.locator('.tq-item').boundingBox();
    const lixeira = await linha.locator('.tq-item-apagar').boundingBox();
    assert(lixeira.width > 20 && lixeira.height > 20, 'lixeira sem caixa');
    assert(lixeira.x >= item.x + item.width - 1, 'lixeira sobre o item');
    assert(Math.abs(lixeira.y - item.y) < 2, 'lixeira desalinhada da linha');
    assert(await linha.locator('.tq-item-apagar').isVisible());
    check('Documentos: a lixeira é irmã do item, visível e à direita dele');

    await page.screenshot({ path: path.join(output, 'documentos-lista.png'), fullPage: true });

    await linha.locator('.tq-item-apagar').click();
    const pergunta = page.getByRole('alertdialog');
    await pergunta.waitFor();
    assert.equal(await page.locator('.tq-confirma').count(), 1);
    assert((await pergunta.textContent()).includes('Ata que some'));
    assert((await pergunta.textContent()).includes('reunião de origem não é afetada'));
    // O outro item continua item — só o apontado virou pergunta.
    assert.equal(await page.locator('.tq-item-linha').count(), 1);
    await page.screenshot({ path: path.join(output, 'documento-confirma.png'), fullPage: true });

    await pergunta.getByRole('button', { name: 'Cancelar' }).click();
    assert.equal(await page.locator('.tq-item-linha').count(), 2);
    assert.equal((await ler('taq:documents')).length, 2);
    check('Documentos: cancelar devolve o item e não apaga nada');

    await linha.locator('.tq-item-apagar').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Apagar' }).click();
    await page.waitForFunction(
      async () => (await chrome.storage.local.get('taq:documents'))['taq:documents'].length === 1,
    );
    assert.equal((await ler('taq:documents'))[0].id, 'd-1');
    assert.equal((await ler('taq:history')).length, 1, 'a reunião de origem foi junto');
    check('Documentos: apagar tira só o documento; a reunião de origem fica');

    // ----------------------------------------------------------------- notas
    await page.goto(`${base}/src/home/index.html?record=${REUNIAO.id}`);
    await page.getByLabel('Nome da reunião').waitFor();

    const notasColuna = page.locator('.tq-notas-coluna');
    const topo = await notasColuna.locator('.tq-coluna-topo').boundingBox();
    const iconeApagar = notasColuna.locator('.tq-icone-apagar');
    const caixa = await iconeApagar.boundingBox();
    assert(caixa.width > 20 && caixa.height > 20, 'ícone de apagar nota sem caixa');
    assert(caixa.y >= topo.y - 1 && caixa.y + caixa.height <= topo.y + topo.height + 1);
    // Ele não invade o campo: o campo começa abaixo do topo da coluna.
    const campo = await notasColuna.locator('.tq-notas-campo').boundingBox();
    assert(caixa.y + caixa.height <= campo.y + 1, 'o ícone invade o campo de notas');
    check('Notas: o ícone mora no topo da coluna, fora do campo');

    await iconeApagar.click();
    const perguntaNota = notasColuna.getByRole('alertdialog');
    await perguntaNota.waitFor();
    assert((await perguntaNota.textContent()).includes('A transcrição não é afetada'));
    // A confirmação não empurra o campo para fora da coluna.
    const colunaBox = await notasColuna.boundingBox();
    const campoDepois = await notasColuna.locator('.tq-notas-campo').boundingBox();
    assert(
      campoDepois.y + campoDepois.height <= colunaBox.y + colunaBox.height + 1,
      'a confirmação empurrou o campo para fora da coluna',
    );
    assert(campoDepois.height > 60, 'o campo de notas encolheu demais');
    await page.screenshot({ path: path.join(output, 'nota-confirma.png'), fullPage: true });

    await perguntaNota.getByRole('button', { name: 'Cancelar' }).click();
    assert((await notasColuna.locator('.tq-notas-campo').inputValue()).includes('Decisão'));
    check('Notas: cancelar mantém a nota, e a confirmação não espremeu o campo');

    /*
     * O defeito que esta parte tranca: o gravador tem respiro de 700ms. A
     * última tecla digitada antes de apagar reescreveria a nota logo depois da
     * remoção — ela reapareceria sozinha, no storage de verdade.
     */
    await notasColuna
      .locator('.tq-notas-campo')
      .fill('[TESTE] última tecla, digitada e não salva');
    await iconeApagar.click();
    await notasColuna.getByRole('alertdialog').getByRole('button', { name: 'Apagar' }).click();
    await page.waitForFunction(
      async () =>
        !((await chrome.storage.local.get('taq:notes'))['taq:notes'] ?? {})['teste-reuniao'],
    );
    await page.waitForTimeout(1500);
    assert.equal(((await ler('taq:notes')) ?? {})['teste-reuniao'], undefined);
    assert.equal(await notasColuna.locator('.tq-notas-campo').inputValue(), '');
    assert.equal(await iconeApagar.count(), 0, 'nota vazia ainda oferece apagar');
    // A transcrição ao lado continua inteira.
    assert.equal((await ler('taq:history'))[0].segments.length, REUNIAO.segments.length);
    check('Notas: apagar remove o registro, e a tecla pendente não a ressuscita');
    await page.screenshot({ path: path.join(output, 'nota-apagada.png'), fullPage: true });

    // ------------------------------------------------------------- conversas
    await page.goto(`${base}/src/home/index.html`);
    await page.locator('.tq-turnos').waitFor();
    assert((await page.locator('.tq-turnos').textContent()).includes('conversa aberta'));

    await page.locator('.tq-conversas-botao').click();
    const menu = page.locator('.tq-conversas-lista');
    await menu.waitFor();
    const linhaAntiga = menu.locator('li.tq-conversas-linha').filter({ hasText: 'antiga' });
    const escolher = await linhaAntiga.locator('[role="menuitemradio"]').boundingBox();
    const lixeiraConversa = await linhaAntiga.locator('.tq-conversas-apagar').boundingBox();
    assert(lixeiraConversa.width > 10, 'lixeira da conversa sem caixa');
    assert(lixeiraConversa.x >= escolher.x + escolher.width - 1, 'lixeira sobre o título');
    // Dentro do menu, sem transbordar pela direita.
    const menuBox = await menu.boundingBox();
    assert(
      lixeiraConversa.x + lixeiraConversa.width <= menuBox.x + menuBox.width + 1,
      'a lixeira transborda o menu',
    );
    check('Conversas: a lixeira cabe na linha, sem cobrir o título nem sair do menu');
    await page.screenshot({ path: path.join(output, 'conversas-menu.png'), fullPage: true });

    await linhaAntiga.locator('.tq-conversas-apagar').click();
    await menu.getByRole('alertdialog').waitFor();
    assert((await menu.getByRole('alertdialog').textContent()).includes('conversa antiga'));

    // Apagar e Cancelar lado a lado, e não dois blocos de largura inteira:
    // a regra dos itens da lista dá `width: 100%` a todo botão daqui.
    const acoes = menu.locator('.tq-conversas-confirma-acoes button');
    const [apagarBox, cancelarBox] = [
      await acoes.nth(0).boundingBox(),
      await acoes.nth(1).boundingBox(),
    ];
    assert(cancelarBox.x > apagarBox.x + apagarBox.width - 1, 'as ações se empilharam');
    assert(Math.abs(apagarBox.y - cancelarBox.y) < 2, 'as ações desalinharam');
    assert(
      cancelarBox.x + cancelarBox.width <= menuBox.x + menuBox.width + 1,
      'as ações transbordam o menu',
    );
    check('Conversas: Apagar e Cancelar cabem lado a lado dentro do menu');

    await page.keyboard.press('Escape');
    assert.equal(await menu.getByRole('alertdialog').count(), 0);
    assert.equal(await menu.count(), 1, 'Escape fechou o menu junto com a pergunta');
    check('Conversas: Escape desfaz a pergunta sem fechar o menu');

    await linhaAntiga.locator('.tq-conversas-apagar').click();
    await menu.getByRole('alertdialog').getByRole('button', { name: 'Apagar' }).click();
    await page.waitForFunction(
      async () =>
        (await chrome.storage.local.get('taq:conversations'))['taq:conversations'].length === 1,
    );
    assert.equal(await menu.count(), 1, 'o menu fechou ao apagar');
    check('Conversas: apagar remove do storage e o menu continua aberto');

    // A conversa ABERTA: a tela cai na mais recente que sobrou.
    await page
      .locator('li.tq-conversas-linha')
      .filter({ hasText: 'aberta' })
      .locator('.tq-conversas-apagar')
      .click();
    await menu.getByRole('alertdialog').getByRole('button', { name: 'Apagar' }).click();
    await page.waitForFunction(
      async () =>
        (await chrome.storage.local.get('taq:conversations'))['taq:conversations'].length === 0,
    );
    await page.locator('.tq-conversas-vazio').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.tq-abertura').waitFor();
    assert(!(await page.locator('.tq-palco').textContent()).includes('conversa aberta'));
    check('Conversas: apagar a última deixa a tela de abertura, sem mensagens órfãs');
    await page.screenshot({ path: path.join(output, 'conversas-vazio.png'), fullPage: true });

    assert.deepEqual(errors, [], `erros de página: ${errors.join(' | ')}`);
    console.log(`\n${checks.length} verificações aprovadas.`);
    fs.writeFileSync(
      path.join(output, 'resultados.json'),
      `${JSON.stringify({ quando: new Date().toISOString(), checks, errors }, null, 2)}\n`,
    );
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exitCode = 1;
});
