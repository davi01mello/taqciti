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

  // Sem `default_popup` de propósito: com ele o Chrome abre o popup e
  // `chrome.action.onClicked` NUNCA dispara. O clique no ícone agora injeta o
  // painel flutuante na aba ativa — é ele o produto, não uma caixinha presa
  // embaixo da barra do navegador.
  action: {
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
    },
  },

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  // A saída larga, para ler uma transcrição inteira sem a página por baixo —
  // secundária ao painel injetado, que é o produto. Declarar `default_path`
  // também põe o TaqCITi no menu de painel lateral do próprio Chrome, que é o
  // caminho de abertura que nunca depende de gesto (ver background/sidePanel).
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },

  content_scripts: [
    {
      matches: ['https://meet.google.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],

  // `activeTab` + `scripting` é o par que injeta o painel na aba ativa. A dupla
  // é deliberada e NÃO troca por `host_permissions: ['<all_urls>']`: activeTab
  // concede acesso à aba só no clique do ícone, é o próprio usuário pedindo, e
  // não gera nenhum aviso na tela de instalação.
  //
  // `system.display` saiu junto com a janela própria: só existia para conferir
  // se a posição salva dela ainda caía numa tela conectada.
  //
  // Nenhuma destas quatro gera aviso de instalação — a tela de permissão
  // continua limpa, que é a razão de nunca aparecer `<all_urls>` aqui.
  permissions: ['storage', 'sidePanel', 'scripting', 'activeTab'],

  // Já coberto pelo aviso que o `content_scripts` acima produz — declarar aqui
  // não acrescenta NENHUM aviso novo na instalação, e habilita duas coisas que
  // o content script declarado sozinho não dá: injetar nas abas do Meet que já
  // estavam abertas quando a extensão foi instalada (senão a primeira execução
  // exige recarregar a aba à mão), e falar com elas pelo `chrome.tabs`.
  host_permissions: ['https://meet.google.com/*'],

  // O painel sobreviver à navegação exige acesso permanente ao host, e
  // `activeTab` é revogado exatamente na navegação. Como OPCIONAL, a tela de
  // instalação continua limpa e quem quer a persistência autoriza uma vez, de
  // dentro do painel. Ver src/background/persistentPanel.ts.
  optional_host_permissions: ['<all_urls>'],

  // Conteúdo injetado só alcança arquivo da extensão declarado aqui — e o
  // loader do @crxjs faz `import()` dos chunks do painel, então eles precisam
  // valer na aba onde o painel for parar. Como o painel agora abre em qualquer
  // aba, a lista precisa alcançar qualquer origem.
  //
  // Isto NÃO é `host_permissions`: `web_accessible_resources` diz "quem pode
  // LER estes arquivos meus", nunca "onde eu posso mexer". Não aparece na tela
  // de instalação, e sem o clique no ícone nada é injetado — o alcance real
  // continua sendo o do activeTab.
  //
  // (Os chunks do painel o próprio @crxjs acrescenta a esta entrada no build;
  // por isso ela precisa ser a que casa com o content script.)
  web_accessible_resources: [
    {
      resources: ['brand/*'],
      matches: ['<all_urls>'],
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
