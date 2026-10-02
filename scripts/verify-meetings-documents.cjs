// Perfil isolado: nunca escreve no perfil pessoal do navegador.
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE_PATH || process.argv[2] || 'playwright-core',
);
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const output = path.resolve('docs/verification/meetings-documents');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'taqciti-verification-'));
const extension = path.resolve('dist');
const options = {
  executablePath:
    process.env.BROWSER_PATH ||
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 1000 },
};
(async () => {
  let context = await chromium.launchPersistentContext(profile, options);
  const checks = [];
  const check = (name) => {
    checks.push(name);
    console.log('PASS', name);
  };
  const errors = [];
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
    console.log('Extension worker:', worker.url());
    const id = new URL(worker.url()).host;
    const base = `chrome-extension://${id}`;
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/src/home/index.html`);
    await page.locator('.tq-home').waitFor();
    const record = {
      id: 'teste-reuniao',
      title: '[TESTE] Planejamento do projeto',
      startedAt: Date.parse('2026-09-20T13:00:00Z'),
      endedAt: Date.parse('2026-09-20T13:40:00Z'),
      durationSeconds: 2400,
      participants: [
        { name: 'Ana — teste', isHost: true },
        { name: 'Bruno — teste', isHost: false },
      ],
      segments: Array.from({ length: 45 }, (_, i) => ({
        captionId: `teste-${i}`,
        speaker: i % 2 ? 'Bruno — teste' : 'Ana — teste',
        text: [
          'Vamos revisar as entregas da semana e confirmar os responsáveis por cada etapa.',
          'O protótipo está pronto para revisão. A próxima etapa é validar o fluxo com a equipe.',
          'Ficou combinado preparar os cenários de teste e registrar as decisões até sexta-feira.',
        ][i % 3],
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
    await page.evaluate(async (record) => {
      await chrome.storage.local.set({
        'taq:history': [record],
        'taq:notes': {
          primeira: {
            meetingId: record.id,
            texto:
              'Notas de teste — sem dados reais.\n\nDecisão: revisar o protótipo com a equipe.',
            updatedAt: 1,
          },
          segunda: {
            meetingId: record.id,
            texto:
              'Próximos passos\n• Ana: preparar a revisão.\n• Bruno: validar os cenários até sexta.',
            updatedAt: 2,
          },
        },
      });
    }, record);
    await page.goto(`${base}/src/document/index.html?meetingId=teste-reuniao`);
    await page.waitForURL('**/src/home/index.html?record=teste-reuniao');
    await page.getByLabel('Nome da reunião').waitFor();
    const cols = page.locator('.tq-coluna');
    const left = await cols.nth(0).boundingBox(),
      right = await cols.nth(1).boundingBox();
    assert(
      left.x < right.x &&
        Math.abs(left.y - right.y) < 2 &&
        left.width / right.width > 1.7,
    );
    assert((await page.locator('.tq-notas-campo').inputValue()).includes('---'));
    check('Link antigo abre a reunião atual; proporção 2:1; notas antigas agregadas');
    await page.screenshot({
      path: path.join(output, 'reuniao-larga.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: 'Transcrição', exact: true }).waitFor();
    await page.locator('.tq-coluna-corpo').evaluate((el) => {
      el.scrollTop = 260;
    });
    const scroll = await page.locator('.tq-coluna-corpo').evaluate((el) => el.scrollTop);
    await page.getByRole('tab', { name: 'Notas', exact: true }).click();
    await page
      .locator('.tq-notas-campo')
      .fill('[TESTE] Nota editada na HOME durante atualização da captura.');
    await page.evaluate(async () => {
      const data = await chrome.storage.local.get('taq:history');
      data['taq:history'][0].segments[0].text =
        '[TESTE] Transcrição atualizada pela captura simulada.';
      await chrome.storage.local.set(data);
    });
    await page.getByRole('tab', { name: 'Transcrição', exact: true }).click();
    assert.equal(
      await page.locator('.tq-coluna-corpo').evaluate((el) => el.scrollTop),
      scroll,
    );
    await page.getByRole('tab', { name: 'Notas', exact: true }).click();
    assert((await page.locator('.tq-notas-campo').inputValue()).includes('HOME durante'));
    await page
      .locator('.tq-notas-estado')
      .filter({ hasText: /^salvo$/ })
      .waitFor();
    await page.screenshot({
      path: path.join(output, 'reuniao-estreita.png'),
      fullPage: true,
    });
    check('Alternância estreita preserva rolagem e rascunho durante captura simulada');

    const side = await context.newPage();
    await side.setViewportSize({ width: 390, height: 844 });
    await side.goto(`${base}/src/sidepanel/index.html`);
    await side.locator('.tq-modo').first().click();
    await side.locator('.tq-lista button').first().click();
    await side.getByRole('tab', { name: 'Notas', exact: true }).click();
    await side.waitForFunction(() =>
      document.querySelector('#tq-editor-de-nota')?.value.includes('HOME durante'),
    );
    await side
      .locator('#tq-editor-de-nota')
      .fill('[TESTE] Atualizada pela sidebar; a HOME deve refletir esta edição.');
    await page.waitForFunction(() =>
      document.querySelector('.tq-notas-campo')?.value.includes('pela sidebar'),
    );
    await side.screenshot({
      path: path.join(output, 'sidebar-notas.png'),
      fullPage: true,
    });
    check('HOME e sidebar leem e editam a mesma nota após confirmação do salvamento');
    await side.close();

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByLabel('Nome da reunião').fill('[TESTE] Reunião renomeada');
    await page.getByLabel('Nome da reunião').press('Tab');
    await page.waitForTimeout(150);
    assert(
      (
        await page.evaluate(
          async () =>
            (await chrome.storage.local.get('taq:history'))['taq:history'][0].title,
        )
      ).includes('renomeada'),
    );
    assert((await page.locator('.tq-notas-campo').inputValue()).includes('pela sidebar'));
    check('Renomeação da reunião preserva vínculo com as notas');

    // Resposta sintética, explicitamente identificada: nenhuma chamada de IA.
    await page.route('**/api/generate', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          title: '[TESTE] Ata de validação — geração simulada',
          content:
            '# Documento de teste\n\nEste conteúdo veio de uma resposta simulada, sem IA.\n\n## Decisões\n\nValidar a persistência local.',
          html: '<h1>Documento de teste</h1><p>Resposta simulada, sem IA.</p>',
          questions: [],
          gaps: [],
        }),
      }),
    );
    await page.evaluate(() => {
      window.originalSet = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = (values) =>
        'taq:documents' in values
          ? Promise.reject(new Error('Falha de teste'))
          : window.originalSet(values);
    });
    await page.getByRole('button', { name: 'Gerar documento', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Ata de Reunião', exact: true }).click();
    await page
      .getByRole('button', { name: 'Tentar salvar de novo', exact: true })
      .waitFor();
    assert.equal(await page.getByText('Salvo em Documentos', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Reuniões', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Conclua a geração' }).waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Tentar salvar de novo', exact: true })
        .count(),
      1,
    );
    await page.evaluate(() => {
      chrome.storage.local.set = window.originalSet;
    });
    await page
      .getByRole('button', { name: 'Tentar salvar de novo', exact: true })
      .click();
    await page.getByText('Salvo em Documentos', { exact: true }).waitFor();
    check(
      'Geração simulada: falha preserva resultado, bloqueia perda e permite repetir persistência',
    );
    await page.getByRole('button', { name: 'Abrir documento', exact: true }).click();
    await page.locator('.tq-documento-campo').waitFor();
    await page.getByLabel('Nome do documento').fill('[TESTE] Ata revisada');
    const edited =
      '# Ata revisada — TESTE\n\nConteúdo editado localmente, sem IA.\n\n## Próximos passos\n\n- Conferir persistência após reiniciar o navegador.\n- Baixar esta versão salva.';
    await page.locator('.tq-documento-campo').fill(edited);
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page
      .locator('.tq-notas-estado')
      .filter({ hasText: /^salvo$/ })
      .waitFor();
    assert.equal(
      await page.evaluate(
        async () =>
          (await chrome.storage.local.get('taq:documents'))['taq:documents'][0]?.content,
      ),
      edited,
    );
    await page.screenshot({
      path: path.join(output, 'documento-editor.png'),
      fullPage: true,
    });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar .md', exact: true }).click();
    const download = await downloadPromise;
    const downloadPath = path.join(output, 'documento-teste.md');
    await download.saveAs(downloadPath);
    assert.equal(fs.readFileSync(downloadPath, 'utf8'), edited);
    check('Editor renomeia e salva; download contém exatamente a versão confirmada');

    await page.evaluate(() => {
      chrome.storage.local.set = (values) =>
        'taq:documents' in values
          ? Promise.reject(new Error('Falha de teste'))
          : window.originalSet(values);
    });
    await page
      .locator('.tq-documento-campo')
      .fill(edited + '\n\n[TESTE] Rascunho preservado após falha.');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page
      .getByRole('button', { name: 'Tentar salvar novamente', exact: true })
      .waitFor();
    await page.getByRole('button', { name: 'Documentos', exact: true }).click();
    assert.equal(await page.locator('.tq-documento-campo').count(), 1);
    assert(
      (await page.locator('.tq-documento-campo').inputValue()).includes(
        'Rascunho preservado',
      ),
    );
    await page.screenshot({
      path: path.join(output, 'documento-falha.png'),
      fullPage: true,
    });
    await page.evaluate(() => {
      chrome.storage.local.set = window.originalSet;
    });
    await page
      .getByRole('button', { name: 'Tentar salvar novamente', exact: true })
      .click();
    await page.getByRole('button', { name: 'Documentos', exact: true }).click();
    await page.locator('.tq-item').filter({ hasText: '[TESTE] Ata revisada' }).waitFor();
    await page.screenshot({
      path: path.join(output, 'documentos-lista.png'),
      fullPage: true,
    });
    check('Falha no editor mantém rascunho e não permite saída silenciosa');

    await context.close();
    context = await chromium.launchPersistentContext(profile, options);
    const reopened = await context.newPage();
    await reopened.goto(`${base}/src/home/index.html?secao=documentos`);
    await reopened
      .locator('.tq-item')
      .filter({ hasText: '[TESTE] Ata revisada' })
      .click();
    assert(
      (await reopened.locator('.tq-documento-campo').inputValue()).includes(
        'Rascunho preservado',
      ),
    );
    assert.equal(
      await reopened.getByLabel('Nome do documento').inputValue(),
      '[TESTE] Ata revisada',
    );
    await reopened
      .getByRole('button', { name: '[TESTE] Reunião renomeada', exact: true })
      .click();
    await reopened.locator('.tq-reuniao-corpo').waitFor();
    check('Reinício completo do navegador preserva documento, edições, título e origem');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, 'resultados.json'),
      JSON.stringify(
        {
          profile,
          browser: await context.browser().version(),
          checks,
          generation: 'SIMULADA; sem IA; dados [TESTE]',
          errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
