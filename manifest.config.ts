/**
 * Manifesto MV3 da extensão — fonte única de verdade consumida pelo @crxjs/vite-plugin.
 * Permissões seguem o princípio do mínimo: nada além de storage, system.display
 * (restaurar a janela principal na tela certa) e o Meet.
 */
import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'TaqCITi Standalone',
  description:
    'Transcrição automática de reuniões do Google Meet — captura invisível e histórico 100% local, sem integração com nenhum backend.',
  version: '1.5.1',
  minimum_chrome_version: '116',

  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },

  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
    },
  },

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  content_scripts: [
    {
      matches: ['https://meet.google.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],

  // Sem identidade de produto: storage local, e system.display só pra
  // validar se a posição salva da janela principal ainda cabe na tela atual
  // ao reabrir (chrome.system.display.getInfo — sem isso não dá pra saber os
  // monitores conectados agora).
  permissions: ['storage', 'system.display'],

  // A marca desenhada vive no painel injetado dentro do Meet, e conteúdo
  // injetado só alcança arquivo da extensão que esteja declarado aqui. Só a
  // pasta da marca é exposta, e só para o Meet: `web_accessible_resources`
  // torna o arquivo legível por qualquer script da página listada, então a
  // lista é a menor possível.
  web_accessible_resources: [
    {
      resources: ['brand/*'],
      matches: ['https://meet.google.com/*'],
    },
  ],

  // Nenhum host_permissions: `document/index.html` (fase 2) chama o
  // servidor de geração de documento via `fetch` comum, de dentro de uma
  // página normal da extensão — CORS do lado do servidor, não permissão de
  // manifest. host_permissions só entraria se o fetch fosse feito do
  // background com bypass de CORS, o que não é o caso aqui.

  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
});
