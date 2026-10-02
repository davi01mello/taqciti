/**
 * Semeia a reuniao "Portal de Voluntarios" + a nota direto no
 * chrome.storage.local, via Playwright -- sem console, sem colar nada.
 *
 * Abre um Edge com a extensao de `dist/` carregada, num perfil TEMPORARIO
 * (nao mexe no seu perfil pessoal), grava os dados e deixa a janela aberta
 * na Home pra voce olhar. Feche a janela quando terminar, ou Ctrl+C aqui.
 *
 *   node scripts/seed-temp-reuniao.cjs
 */
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const extension = path.resolve('dist');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'taqciti-seed-'));

const inicio = Date.parse('2026-09-22T14:00:00-03:00');
const duracaoMs = 1800000;

const DIALOGO = [
  ['Edísio Uchoá', 'Bom dia, pessoal. Hoje precisamos fechar o desenho do Portal de Voluntários antes da reunião de terça com a diretoria.', 0, 45000],
  ['Mariana Alves', 'Consegui terminar o protótipo de cadastro. Falta só a etapa de aprovação do coordenador de projeto.', 45000, 120000],
  ['Bruno Ferreira', 'Sobre isso, ainda temos dúvida se a aprovação deve ser por e-mail ou dentro do próprio portal.', 120000, 180000],
  ['Edísio Uchoá', 'Vamos decidir agora: a aprovação fica dentro do portal, com notificação por e-mail. Fora do portal a gente perde histórico.', 180000, 240000],
  ['Mariana Alves', 'Ok, decisão registrada. Eu ajusto o protótipo até quinta.', 240000, 300000],
  ['Bruno Ferreira', 'Fico responsável por escrever os textos de notificação, então.', 300000, 900000],
  ['Edísio Uchoá', 'Passando para o segundo ponto: o formulário de inscrição está pedindo CPF, e o jurídico perguntou se isso é necessário.', 900000, 960000],
  ['Mariana Alves', 'Não é. Só precisamos de nome, e-mail e disponibilidade de horário. Vou tirar o campo de CPF.', 960000, 1500000],
  ['Edísio Uchoá', 'Combinado. Última coisa: quem fica de levar isso para a reunião de terça com a diretoria?', 1500000, 1560000],
  ['Bruno Ferreira', 'Eu levo, já que fiquei com as notificações e conheço bem o fluxo.', 1560000, 1566000],
];

const REUNIAO = {
  id: 'temp-reuniao-1',
  title: 'Reunião de alinhamento — Portal de Voluntários',
  startedAt: inicio,
  endedAt: inicio + duracaoMs,
  durationSeconds: duracaoMs / 1000,
  participants: [
    { name: 'Edísio Uchoá', isHost: true },
    { name: 'Mariana Alves', isHost: false },
    { name: 'Bruno Ferreira', isHost: false },
  ],
  presentNow: [],
  speakersObserved: [],
  segments: DIALOGO.map(([speaker, text, startOffsetMs, endOffsetMs], i) => ({
    captionId: `temp-reuniao-1-cap-${String(i).padStart(3, '0')}`,
    speaker,
    text,
    startOffsetMs,
    endOffsetMs,
  })),
  status: 'ready',
  metadata: {
    capturedCaptions: true,
    droppedSegments: 0,
    reconnectCount: 0,
    captureDegradedCount: 0,
    lastChunkAt: inicio + duracaoMs,
    wasDiscardedAndRestarted: false,
  },
};

const NOTA = {
  meetingId: 'temp-reuniao-1',
  texto: 'Aprovação dentro do portal (não por e-mail isolado). CPF removido do formulário. Bruno leva pra diretoria na terça.',
  updatedAt: inicio + duracaoMs + 60000,
};

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath:
      process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: false,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1280, height: 900 },
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(worker.url()).host;
  console.log('Extensao carregada, id:', id);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/src/home/index.html`);
  await page.locator('.tq-home').waitFor();

  await page.evaluate(
    async ([reuniao, nota]) => {
      const atual = (await chrome.storage.local.get('taq:history'))['taq:history'];
      const historico = Array.isArray(atual) ? atual.filter((r) => r.id !== reuniao.id) : [];
      await chrome.storage.local.set({
        'taq:history': [reuniao, ...historico].sort((a, b) => b.startedAt - a.startedAt),
      });
      const notasAtual = (await chrome.storage.local.get('taq:notes'))['taq:notes'];
      const notas = notasAtual && typeof notasAtual === 'object' ? notasAtual : {};
      notas[reuniao.id] = nota;
      await chrome.storage.local.set({ 'taq:notes': notas });
    },
    [REUNIAO, NOTA],
  );

  console.log('Gravado. Recarregando a Home...');
  await page.reload();
  await page.locator('.tq-home').waitFor();
  console.log('\nPronto -- a janela do Edge ficou aberta na Home, com a reunião "Portal de Voluntários".');
  console.log('Perfil temporário em:', profile);
  console.log('Feche a janela do navegador (ou Ctrl+C aqui) quando terminar de olhar.');

  context.on('close', () => {
    fs.rmSync(profile, { recursive: true, force: true });
    process.exit(0);
  });

  // Mantém o processo vivo até a janela ser fechada.
  await new Promise(() => {});
})().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exitCode = 1;
});
