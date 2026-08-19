/**
 * Manifesto MV3 da extensão — fonte única de verdade consumida pelo @crxjs/vite-plugin.
 *
 * Ver `content_scripts` e `host_permissions` abaixo para o porquê de o TaqCITi
 * viver em toda página: é o que dá à UI um ciclo de vida previsível dentro do
 * Chrome, em vez de existir numa aba e desaparecer na navegação seguinte.
 */
import { defineManifest } from '@crxjs/vite-plugin';

/**
 * Cliente OAuth do Google, registrado no Google Cloud Console como
 * "Extensão do Chrome" e amarrado ao ID abaixo.
 *
 * Definível por `VITE_GOOGLE_OAUTH_CLIENT_ID` no ambiente da build. O
 * placeholder mantém o manifesto VÁLIDO quando ninguém registrou nada — a
 * extensão carrega, e só o envio para o Google Docs falha, com mensagem
 * dizendo o que fazer. Um `client_id` ausente faria o Chrome recusar a
 * extensão inteira, o que é um modo de falhar muito pior por um recurso
 * opcional. Ver `docs/google-docs-setup.md`.
 */
const OAUTH_CLIENT_ID =
  process.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? 'CLIENT_ID_NAO_CONFIGURADO.apps.googleusercontent.com';

export default defineManifest({
  manifest_version: 3,
  name: 'TaqCITi Standalone',
  description:
    'Transcrição automática de reuniões do Google Meet — captura invisível e histórico 100% local, sem integração com nenhum backend.',
  version: '2.0.0',
  minimum_chrome_version: '116',

  /*
   * ID ESTÁVEL — `jalebpaefejnbacgncgkailhemkdpnhm`.
   *
   * Sem esta chave, o Chrome deriva o ID do caminho da pasta em carga
   * unpacked, e ele MUDA entre máquinas e entre clones do repo. O
   * `chrome.identity.getAuthToken` não tolera isso: o cliente OAuth do Google
   * é registrado CONTRA um ID específico, e um ID diferente faz a
   * autenticação falhar com "bad client id" — erro que não diz nada sobre a
   * causa real.
   *
   * Esta é a chave PÚBLICA. A privada correspondente só é necessária para
   * empacotar um .crx assinado à mão, e não vive no repo.
   *
   * ⚠️ Ao publicar na Web Store: a loja atribui a própria chave. Depois da
   * primeira publicação, troque o valor abaixo pelo que a loja mostrar, ou o
   * ID de desenvolvimento e o de produção divergem — e o cliente OAuth vale
   * só para um dos dois.
   */
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnK6hLSrLUsXOj3pPWAwMyzBPBOh3A9nI4PnbL/k6B3/G68Rk+MyjMj/86I4b2Dxi65UFD44YfygrpULYVBCayZ26qcjShnJse0U9rvF8OMp/U7EUBGS1VLdx6JKur/3OBzAMSb4c0V6EgL3rj4OEPgHbjEXjHDHt7azDyaOUOB+HJV6nCXzCiAogGXAHXB+9C1NG/GCpyh3F7cLu8gUnyND2xpkFPHU1+1Tdda7cOdZPK2SvbeXe5dCwdVzA3nSnsTNc2in+HMUvjtDZLdQRHV8nQIRQiApDUTa3LPfY6YLvPMvnfq3bEPCceHgdxmezRPbSUNYESp5Zj8n4YxFz8QIDAQAB',

  /*
   * Só `drive.file`, e só ele.
   *
   * `drive.file` dá acesso EXCLUSIVAMENTE aos arquivos que esta extensão
   * criou. Ela não enxerga, não lê e não altera nada mais do Drive de quem
   * usa — o que é exatamente o alcance de "crie a ata e abra". Os escopos
   * largos (`drive`, `drive.readonly`) dariam a biblioteca inteira, exigiriam
   * verificação da Google e pediriam ao usuário uma permissão que o produto
   * não precisa.
   *
   * Se algum dia parecer que precisa de mais, PARE e pergunte ao autor.
   */
  oauth2: {
    client_id: OAUTH_CLIENT_ID,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  },

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
  //
  // `identity` é o que permite `chrome.identity.getAuthToken`: o token OAuth
  // do usuário é obtido DENTRO do Chrome e usado para criar a ata no Drive
  // dele. O servidor nunca vê esse token — é a razão de a extensão criar o
  // documento em vez de o servidor criar.
  permissions: ['storage', 'sidePanel', 'scripting', 'identity'],

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
