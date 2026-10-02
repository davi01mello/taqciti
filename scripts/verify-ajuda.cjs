// A referência de ajuda (`src/features/taq/ajuda.ts`) contra a extensão RODANDO.
//
// Percorre a HOME e a sidebar de uma build de desenvolvimento (a que tem o
// simulador de reunião) com dados [TESTE], e anota quais rótulos da referência
// aparecem de verdade na tela — texto, aria-label, title ou placeholder. O
// resultado vai para `docs/verification/ajuda/resultado.json`, que o
// `ajuda.test.ts` usa para cobrar as entradas marcadas `verificacao: 'interface'`.
//
// Nenhuma chamada de IA: a geração de documento é uma resposta simulada.
// Perfil isolado: nunca escreve no perfil pessoal do navegador.
//
//   npx vite build --mode development --outDir <pasta>
//   node scripts/verify-ajuda.cjs <playwright-core> <pasta>
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE_PATH || process.argv[2] || 'playwright-core',
);
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const extensao = path.resolve(process.argv[3] || 'dist-dev');
const saida = path.resolve('docs/verification/ajuda');
fs.mkdirSync(saida, { recursive: true });

// ---------------------------------------------- os rótulos da referência
// Lidos do fonte: cada entrada de FUNCIONALIDADES tem `id: '...'` e, adiante,
// `rotulos: [...]`. O arquivo é dado, com forma fixa — o teste da referência
// quebra antes de esta leitura ficar errada.
const fonte = fs.readFileSync('src/features/taq/ajuda.ts', 'utf8');
const inicio = fonte.indexOf('export const FUNCIONALIDADES');
const fim = fonte.indexOf('export const FORA_DO_APP');
const bloco = fonte.slice(inicio, fim);
const entradas = [];
for (const m of bloco.matchAll(/\n {4}id: '([a-z_]+)',[\s\S]*?\n {4}rotulos: \[([\s\S]*?)\],/g)) {
  const rotulos = [...m[2].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]);
  entradas.push({ id: m[1], rotulos });
}
if (entradas.length < 20) throw new Error(`Li só ${entradas.length} entradas da referência.`);
// Montados na tela, sem forma literal no código.
const COMPOSTOS = ['Baixar .md', 'Baixar .txt'];
const procurados = [...new Set([...entradas.flatMap((e) => e.rotulos), ...COMPOSTOS])];

// ---------------------------------------------------------------- a volta
const vistos = new Set();
const ondeVisto = {};
/** O que a volta confere além dos rótulos (a exclusão de conversa). */
const verificacoes = {};
async function colher(page, etapa) {
  const textos = await page.evaluate(() => {
    const s = new Set();
    for (const el of document.querySelectorAll('*')) {
      for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
        const v = el.getAttribute(a);
        if (v) s.add(v.trim());
      }
      if (el.matches('button, a, h1, h2, h3, h4, label, summary, p, span, strong, [role]')) {
        const t = (el.innerText || el.textContent || '').trim();
        if (t && t.length < 400) s.add(t.replace(/\s+/g, ' '));
      }
    }
    return [...s];
  });
  for (const r of procurados) {
    const achou = textos.some(
      (t) => t === r || t.startsWith(`${r} `) || t.startsWith(`${r} (`) || t.endsWith(` ${r}`),
    );
    if (achou && !vistos.has(r)) {
      vistos.add(r);
      ondeVisto[r] = etapa;
    }
  }
  console.log(`· ${etapa}: ${vistos.size}/${procurados.length}`);
}

async function clicar(page, nome, papel = 'button') {
  await page.getByRole(papel, { name: nome, exact: true }).first().click({ timeout: 5000 });
  await page.waitForTimeout(250);
}

const REUNIAO = {
  id: 'teste-ajuda',
  title: '[TESTE] Reunião da ajuda',
  startedAt: Date.parse('2026-09-20T13:00:00Z'),
  endedAt: Date.parse('2026-09-20T13:30:00Z'),
  durationSeconds: 1800,
  participants: [{ name: 'Ana — teste', isHost: true }],
  segments: Array.from({ length: 6 }, (_, i) => ({
    captionId: `ajuda-${i}`,
    speaker: i % 2 ? 'Bruno — teste' : 'Ana — teste',
    text: 'Fala sintética para conferir a interface.',
    startOffsetMs: i * 20000,
    endOffsetMs: i * 20000 + 9000,
  })),
  status: 'ready',
  metadata: { capturedCaptions: true, droppedSegments: 0, reconnectCount: 0, wasDiscardedAndRestarted: false },
};
const CONVERSA = {
  id: 'c-teste-ajuda',
  title: '[TESTE] Conversa da ajuda',
  createdAt: 1,
  updatedAt: Date.now(),
  messages: [
    { id: 'm1', role: 'user', text: '[TESTE] apague a reunião antiga', at: 1 },
    {
      id: 'm2',
      role: 'assistant',
      text: '[TESTE] Resposta simulada [r1].',
      at: 2,
      desfecho: 'concluido',
      fontes: [{ ref: 'r1', tipo: 'reuniao', registroId: 'teste-ajuda', titulo: REUNIAO.title, trecho: 'Fala sintética' }],
      operacoes: [{ acao: 'apagar', tipo: 'reuniao', id: 'teste-antiga', titulo: '[TESTE] antiga', ok: true, desfazivel: true }],
      copiavel: '[TESTE] texto para levar ao Claude',
    },
  ],
};

(async () => {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'taqciti-ajuda-'));
  const context = await chromium.launchPersistentContext(perfil, {
    executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: [`--disable-extensions-except=${extensao}`, `--load-extension=${extensao}`],
    viewport: { width: 1440, height: 1000 },
  });
  const falhas = [];
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
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    const page = await context.newPage();
    await page.goto(`${base}/src/home/index.html`);
    await page.locator('.tq-home').waitFor();
    await page.evaluate(
      async ([r, c]) => chrome.storage.local.set({ 'taq:history': [r], 'taq:conversations': [c] }),
      [REUNIAO, CONVERSA],
    );

    // ------------------------------------------------------------ HOME
    await tentar('HOME: Assistente', async () => {
      await page.goto(`${base}/src/home/index.html?secao=assistente`);
      await page.locator('.tq-home').waitFor();
      await page.waitForTimeout(800);
      await colher(page, 'HOME · Assistente');
      await page.screenshot({ path: path.join(saida, 'home-assistente.png') });
    });
    await tentar('HOME: Conversas', async () => {
      await clicar(page, 'Conversas');
      await colher(page, 'HOME · menu Conversas');
      await page.keyboard.press('Escape');
    });
    await tentar('HOME: anexar', async () => {
      await clicar(page, 'Anexar imagem ou documento');
      await colher(page, 'HOME · anexar');
      await page.keyboard.press('Escape');
    });
    await tentar('HOME: navegação', async () => {
      await clicar(page, 'Abrir navegação');
      await colher(page, 'HOME · navegação');
    });
    await tentar('HOME: reunião', async () => {
      await page.goto(`${base}/src/home/index.html?secao=reunioes`);
      await page.getByText(REUNIAO.title).first().click();
      await page.getByLabel('Nome da reunião').waitFor();
      await colher(page, 'HOME · reunião');
      await page.screenshot({ path: path.join(saida, 'home-reuniao.png') });
      await clicar(page, 'Mais ações');
      await colher(page, 'HOME · Mais ações da reunião');
      await clicar(page, 'Apagar reunião', 'menuitem').catch(() => clicar(page, 'Apagar reunião'));
      await colher(page, 'HOME · confirmar apagar reunião');
      await clicar(page, 'Cancelar');
    });
    await tentar('HOME: notas', async () => {
      await page.getByLabel(/^Notas de /).fill('[TESTE] nota da ajuda');
      await page.waitForTimeout(1500);
      await colher(page, 'HOME · notas');
      await clicar(page, 'Apagar as notas de [TESTE] Reunião da ajuda');
      await colher(page, 'HOME · confirmar apagar notas');
      await clicar(page, 'Cancelar');
    });
    await tentar('HOME: gerar documento', async () => {
      await page.route('**/api/generate', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            title: '[TESTE] Ata simulada',
            content: '# [TESTE] Ata simulada\n\nSem IA.',
            html: '<h1>[TESTE] Ata simulada</h1>',
            questions: [],
            gaps: [],
          }),
        }),
      );
      await clicar(page, 'Gerar documento');
      await colher(page, 'HOME · menu Gerar documento');
      await clicar(page, 'Ata de Reunião', 'menuitem');
      await page.getByText('Salvo em Documentos').waitFor({ timeout: 10000 });
      await colher(page, 'HOME · resultado da geração');
      await page.screenshot({ path: path.join(saida, 'home-gerado.png') });
      await clicar(page, 'Abrir documento');
      await page.getByLabel('Nome do documento').waitFor();
      await colher(page, 'HOME · editor');
      await clicar(page, 'Mais ações');
      await colher(page, 'HOME · Mais ações do documento');
      await page.keyboard.press('Escape');
    });
    await tentar('HOME: falha ao salvar documento', async () => {
      await page.evaluate(() => {
        window.__set = chrome.storage.local.set.bind(chrome.storage.local);
        chrome.storage.local.set = (v) =>
          'taq:documents' in v ? Promise.reject(new Error('[TESTE] falha')) : window.__set(v);
      });
      await page.locator('textarea').last().fill('# [TESTE] Ata simulada\n\nEditada.');
      await clicar(page, 'Salvar');
      await page.getByRole('button', { name: 'Tentar salvar novamente' }).first().waitFor({ timeout: 5000 });
      await colher(page, 'HOME · editor com falha');
      await page.evaluate(() => {
        chrome.storage.local.set = window.__set;
      });
      await clicar(page, 'Tentar salvar novamente');
    });
    await tentar('HOME: Documentos', async () => {
      await page.goto(`${base}/src/home/index.html?secao=documentos`);
      await page.getByText('[TESTE] Ata simulada').first().waitFor();
      await colher(page, 'HOME · Documentos');
    });
    await tentar('HOME: Conexões', async () => {
      await page.goto(`${base}/src/home/index.html?secao=conexoes`);
      await page.waitForTimeout(2500);
      await colher(page, 'HOME · Conexões');
      await page.screenshot({ path: path.join(saida, 'home-conexoes.png'), fullPage: true });
    });

    // Apagar a conversa aberta: tela limpa no lugar dela, nenhuma outra em silêncio,
    // e nada volta ao recarregar. A reunião e o documento ficam.
    await tentar('HOME: apagar a conversa aberta', async () => {
      await page.goto(`${base}/src/home/index.html?secao=assistente`);
      await page.getByText('[TESTE] Resposta simulada').first().waitFor();
      await clicar(page, 'Conversas');
      // A lixeira aparece ao passar o mouse na linha, como para quem usa.
      const lixeira = page.locator(`.tq-conversas-apagar[aria-label='Apagar a conversa "${CONVERSA.title}"']`);
      await lixeira.click({ timeout: 5000 });
      await page.locator('.tq-conversas-confirma-acoes .perigo').click();
      await page.keyboard.press('Escape');
      await page.locator('.tq-abertura').waitFor({ timeout: 5000 });
      verificacoes.turnos_na_tela = await page.locator('.tq-turnos').count();
      await page.screenshot({ path: path.join(saida, 'home-conversa-apagada.png') });
      await page.reload();
      await page.locator('.tq-home').waitFor();
      await page.waitForTimeout(800);
      verificacoes.depois_de_recarregar = await page.evaluate(async () => {
        const d = await chrome.storage.local.get(['taq:conversations', 'taq:history', 'taq:documents']);
        return {
          conversas: (d['taq:conversations'] ?? []).map((c) => c.id),
          reunioes: (d['taq:history'] ?? []).map((r) => r.id),
          documentos: (d['taq:documents'] ?? []).length,
        };
      });
      verificacoes.texto_da_conversa_na_tela = await page
        .getByText('[TESTE] Resposta simulada')
        .count();
      console.log('· apagar conversa:', JSON.stringify(verificacoes));
    });

    // --------------------------------------------------------- sidebar
    const side = await context.newPage();
    await side.setViewportSize({ width: 400, height: 900 });
    await tentar('sidebar: Conversa', async () => {
      await side.goto(`${base}/src/sidepanel/index.html`);
      await side.waitForTimeout(1200);
      await colher(side, 'sidebar · Conversa');
      await clicar(side, 'Escolher conversa');
      await colher(side, 'sidebar · escolher conversa');
      await side.keyboard.press('Escape');
    });
    await tentar('sidebar: reuniões', async () => {
      await side.getByRole('button', { name: /^Transcrição/ }).first().click();
      await side.getByText(REUNIAO.title).first().click();
      await side.waitForTimeout(400);
      await colher(side, 'sidebar · reunião guardada');
      await side.screenshot({ path: path.join(saida, 'sidebar-reuniao.png') });
    });
    await tentar('sidebar: reunião simulada', async () => {
      await side.getByRole('button', { name: /^Desenvolvimento/ }).click();
      await clicar(side, 'Capturando');
      await side.getByRole('button', { name: /^Desenvolvimento/ }).click();
      await side.getByRole('button', { name: /^Transcrição/ }).first().click();
      await side.waitForTimeout(800);
      await colher(side, 'sidebar · reunião simulada');
      await side.screenshot({ path: path.join(saida, 'sidebar-ao-vivo.png') });
      await clicar(side, 'Print');
      await colher(side, 'sidebar · prints');
      await side.locator('.tq-fala-corpo').first().click();
      await side.waitForTimeout(300);
      await colher(side, 'sidebar · trecho selecionado');
      await clicar(side, 'Perguntar à IA');
      await colher(side, 'sidebar · pergunta com contexto');
      await side.getByRole('button', { name: /^Desenvolvimento/ }).click();
      await clicar(side, 'Pausada');
      await side.getByRole('button', { name: /^Desenvolvimento/ }).click();
      await side.getByRole('button', { name: /^Transcrição/ }).first().click();
      await side.waitForTimeout(400);
      await colher(side, 'sidebar · reunião simulada pausada');
    });
    // Por último: responder à pergunta grava uma decisão na sessão do navegador.
    await tentar('sidebar: pergunta de registro', async () => {
      await side.evaluate(() =>
        chrome.storage.session.set({
          'taq:pendingMeeting': {
            meetingCode: 'tes-teaj-uda',
            title: '[TESTE] Meet sintético',
            participacaoId: 'p-teste-ajuda',
            tabId: null,
            at: Date.now(),
          },
        }),
      );
      await side.reload();
      await side.getByText('Registrar esta reunião?').first().waitFor({ timeout: 5000 });
      await colher(side, 'sidebar · pergunta de registro');
      await side.screenshot({ path: path.join(saida, 'sidebar-pergunta.png') });
    });
  } finally {
    const porEntrada = entradas.map((e) => ({
      id: e.id,
      vistos: e.rotulos.filter((r) => vistos.has(r)),
      nao_vistos: e.rotulos.filter((r) => !vistos.has(r)),
    }));
    fs.writeFileSync(
      path.join(saida, 'resultado.json'),
      JSON.stringify(
        {
          quando: new Date().toISOString(),
          build: path.relative(process.cwd(), extensao) || extensao,
          browser: context.browser()?.version() ?? 'edge (contexto persistente)',
          dados: '[TESTE] sintéticos; geração simulada, sem IA',
          vistos: [...vistos].sort(),
          ondeVisto,
          porEntrada,
          completas: porEntrada.filter((e) => e.nao_vistos.length === 0).map((e) => e.id),
          verificacoes,
          falhas,
        },
        null,
        2,
      ),
    );
    await context.close();
    console.log(`Vistos ${vistos.size}/${procurados.length}. Falhas: ${falhas.length}.`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
