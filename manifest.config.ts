/**
 * Manifesto MV3 da extensão — fonte única de verdade consumida pelo @crxjs/vite-plugin.
 *
 * Ver `content_scripts` e `host_permissions` abaixo para o porquê de o TaqCITi
 * viver em toda página: é o que dá à UI um ciclo de vida previsível dentro do
 * Chrome, em vez de existir numa aba e desaparecer na navegação seguinte.
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

  /*
   * O content script é DECLARADO, para todo site, e é isto que dá ao TaqCITi um
   * ciclo de vida previsível.
   *
   * Um content script morre quando o documento morre — não existe API de
   * extensão que desenhe UI persistente por cima de páginas web. O que existe é
   * ser reinstalado pelo próprio Chrome, no mesmo instante do ciclo de vida, em
   * TODO documento que nasce. É o único mecanismo que atravessa navegação sem
   * depender do service worker estar acordado no momento certo.
   *
   * As alternativas foram tentadas e falham, cada uma por um motivo diferente:
   *
   *   - `activeTab` + `executeScript` no clique do ícone: a permissão é
   *     revogada EXATAMENTE na navegação, então o painel existe numa página e
   *     desaparece na seguinte;
   *   - `chrome.scripting.registerContentScripts` sob permissão opcional: o
   *     registro é certo, mas conceder a permissão exige um gesto do usuário no
   *     contexto da EXTENSÃO, e um clique dentro do painel acontece na PÁGINA e
   *     vira mensagem — o gesto não atravessa, o Chrome recusa, e a persistência
   *     ficava inalcançável;
   *   - `tabs.onUpdated` + injeção manual: o worker do MV3 pode estar dormindo
   *     no instante do evento, e injetar depois do carregamento faz o painel
   *     piscar por cima de uma página já pintada.
   *
   * `document_end` e não `document_idle`: idle espera imagens e sub-recursos, e
   * numa página pesada isso é a cápsula chegando segundos atrasada. `end` é
   * assim que o DOM está pronto, que é tudo de que o painel precisa.
   */
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_end',
      // Só o quadro de topo: o painel é uma janela da aba, e um iframe de
      // anúncio não deve ganhar a sua própria cópia.
      all_frames: false,
    },
  ],

  // `scripting` só para a primeira execução: alcançar as abas que já estavam
  // abertas no instante da instalação. Content script declarado entra apenas em
  // documento que NASCE depois dele, e sem esse alcance o primeiro contato com a
  // extensão exigiria recarregar cada aba à mão.
  //
  // `activeTab` saiu: era o par do `executeScript` sob demanda, e a injeção sob
  // demanda deixou de ser o caminho da UI.
  permissions: ['storage', 'sidePanel', 'scripting'],

  /*
   * O preço honesto da persistência.
   *
   * `<all_urls>` põe "ler e alterar todos os seus dados nos sites que você
   * visita" na tela de instalação. Isso é real e não há como evitar: uma UI que
   * precisa existir em TODA página precisa de acesso a toda página, e o
   * `content_scripts` acima já produziria o mesmo aviso sozinho — declarar
   * `host_permissions` junto não acrescenta aviso NENHUM e habilita o que o
   * content script sozinho não dá: `chrome.tabs.sendMessage` para o painel de
   * qualquer aba (o estado ao vivo chegar até ele) e o `executeScript` da
   * primeira execução.
   *
   * A versão anterior evitava esse aviso e, em troca, não entregava a
   * persistência — o painel morria na primeira navegação. Entre o aviso e o
   * produto funcionando, o produto.
   */
  host_permissions: ['<all_urls>'],

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
