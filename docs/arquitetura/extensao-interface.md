# Interface da extensão — arquitetura

Escopo: o que o usuário vê no Chrome. Telas em `src/home/`, `src/sidepanel/`,
`src/document/`; componentes em `src/shared/ui/`; plataforma em
`src/shared/platform/`; estilo em `src/shared/config/`; documentos no cliente em
`src/features/documents/`; estado do agente em `src/features/agent/`. Tudo aqui
foi lido no código; o que não foi está marcado "não verificado".

## 1. Superfícies

| Superfície | Entrada | Como abre |
| --- | --- | --- |
| Sidebar | `src/sidepanel/index.html` -> `main.tsx` -> `App.tsx` | `side_panel.default_path` no manifesto; o clique no ícone abre via `setPanelBehavior({ openPanelOnActionClick: true })` (`background/sidePanel.ts`). Não há popup. |
| Home (página cheia) | `src/home/index.html` -> `main.tsx` -> `HomePage.tsx` | mensagem `ui/openHome` ao background (`homeTab.ts`), que reutiliza sempre a mesma aba. Também é o destino de reserva se o painel não abrir (`chrome.action.onClicked` em `background/index.ts`). |
| Página de documento | `src/document/index.html` | só redireciona (`window.location.replace`) para a Home com `?record=<id>` (ou `?secao=reunioes`). Existe para não quebrar endereços antigos. |
| Cápsula no Meet | `src/content/ui/` | fora do escopo deste arquivo (ver `extensao-captura.md`). |

Os três `main.tsx` seguem o mesmo molde: importam `global.css` e o CSS da
superfície, montam `<PlatformProvider platform={extensionPlatform}>` e a raiz.

## 2. Home

`HomePage.tsx` é a raiz. Seis seções, definidas em `SideNav.tsx` (`SECOES`) e no
tipo `Secao` de `rota.ts`, nesta ordem: Assistente, Preparar, Reuniões,
Documentos, Acompanhamento, Conexões.

- **Navegação**: não há rota. A seção é `useState`, semeada UMA vez por
  `lerPedidoDaHome(window.location.search)` (`rota.ts`, função pura). Parâmetros:
  `secao`, `record` (implica Reuniões), `documento` (implica Documentos). Trocar
  de seção não empilha histórico do navegador.
- **SideNav**: recolhida; abre ao encostar na faixa esquerda (34 px) ou pelo botão
  "Abrir navegação"; fecha com atraso (340 ms) decidido pela posição do ponteiro
  e por foco de teclado (`:focus-visible`). Fechada fica `inert`. Clicar só navega.
- **Saída protegida**: `navegar()` chama `prepararSaida()` (`shared/services/navigation`).
  Componentes com algo pendente registram `protegerEdicao(...)` (nota, geração de
  documento). Se não der para sair, aparece "Conclua a geração ou tente salvar...".
- **Estado levantado para a Home** porque atravessa seções: reunião aberta,
  documento aberto, rascunhos de conversa (um por conversa, chave `\0nova` para a
  conversa que ainda não existe), rascunho e gravador de nota (`criarGravadorDeNota`,
  fora do React para a última tecla não morrer com o componente), lista de
  documentos, estado do agente.
- **Cabeçalho**: marca, indicador da reunião ao vivo (clicar abre a reunião),
  botão de brasas do fundo, botão de pausar movimento, menu de conversas
  (`ConversasMenu.tsx`).
- **Seções** (arquivos): Assistente = `AssistantView.tsx` (+ `WaveField.tsx`, só
  montada nesta seção); Preparar = `Preparar.tsx` (perfil de condução e briefing
  da reunião); Reuniões = `Paginas.tsx` (lista, transcrição, `NotasDaReuniao`,
  `PrintsDaReuniao`, `GerarDocumento`); Documentos = `Documentos.tsx` e
  `DocumentoPersonalizado.tsx`; Acompanhamento = `Acompanhamento.tsx` (abas
  Compromissos, Decisões, Achados; mesma fonte `taq:trabalho` dos cartões do Taq);
  Conexões = `Conexoes.tsx` + `ContaDoCiti.tsx` (sincronização, conector, conta do
  CITi).
- **Animação**: `useAnimacao(pausadaPeloUsuario)` devolve `animando`, `movimentoReduzido`,
  `motivo` (`preferencia`, `aba-oculta`, `usuario`). Respeita `prefers-reduced-motion`
  e aba oculta. A onda tem três estados: `escrita`, `captando`, `repouso`.
  `Brasas` (fundo) e `PointerLayer` (cursor) são camadas sem captura de clique.
  A escolha de pausar/desligar não é persistida (volta ao padrão ao recarregar).

## 3. Sidebar

`sidepanel/App.tsx`. Dois modos (`Seletores.tsx`, tipo `Modo`): "Reunião"
(`transcricao`) e "Conversa" (`conversa`). As duas seções ficam montadas; a
inativa usa `visibility: hidden` + `inert` para não perder rascunho nem rolagem.

- Fora de reunião o modo "Reunião" é o histórico (`Reunioes.tsx`); durante a
  reunião, um ícone no topo alcança o histórico. Entrar em reunião vai para a
  transcrição; encerrar abre a reunião recém-salva; sair sem reunião volta à conversa.
- Reunião ao vivo: `Reuniao.tsx` (ações em `AcoesDaReuniao.tsx`, pergunta rápida
  em `Pergunta.tsx`, abas em `AbasDaReuniao.tsx`: Transcrição, Notas, Prints).
  Pergunta rápida grava numa conversa própria, com a reunião como contexto, e
  "Continuar na conversa" só abre essa conversa.
- Apoio à condução: `CartaoDeApoio.tsx`, `EstadoDosPontos.tsx`.
- Conversa: `Conversa.tsx`. `OndaDoPainel.tsx` é o fundo (para sozinho com
  movimento reduzido; a sidebar não tem brasas).
- "Abrir" reunião/documento na sidebar significa `platform.send({ type:
  'ui/openHome', recordId | documentId })`. Botão "Abrir HOME" fixo no topo.
- Estado da captura (consentimento, participação, reunião detectada) vem de
  `features/meeting/consent`; a decisão é chaveada pela participação, não pela sala.
- Painel de simulação (`@/dev/PainelDeSimulacao`) só entra se `__TAQCITI_DEV__`;
  em produção o chunk não é emitido.

## 4. Plataforma

`shared/platform/types.ts`: interface `Platform` com `kind` (`extension` |
`desktop`) e três operações: `send(command)`, `subscribeMeeting`,
`subscribeHistory`. Todo `subscribe` emite o valor atual assim que puder.
`context.tsx`: `PlatformProvider` e `usePlatform()` (lança erro sem provider).
`extension.ts`: `extensionPlatform`, único lugar do lado da UI que traduz isso
para `chrome.runtime`/`chrome.storage` (assina antes de pedir o estado inicial
para não perder broadcast). Só a implementação `extension` existe neste escopo;
nenhuma implementação `desktop` foi encontrada nos arquivos lidos.
Ressalva: várias telas ainda usam `chrome.*` diretamente (ex.: `chrome.tabs.create`
em `GerarDocumento.tsx`, storage via `shared/services/storage`), então a fronteira
cobre mensagens e estado da reunião, não tudo.

## 5. Componentes compartilhados (`shared/ui`)

- Marca: `MarcaDoTaq` (onda viva do agente, estados como `repouso`, `ouve`,
  `preparando`, `escrevendo`), `MarcaDaEscuta` (glifo da transcrição),
  `SinalTaqciti` (SVG), `Wordmark`, `Wave` (legado, 3 barras), `Brasas`, `Sheen`.
- Conversa: `RespostaDoTaq` (fontes como botões, documentos criados, em aberto,
  limitações), `CartoesDoTaq` (cartões validados vindos de ferramentas),
  `CartaoDeTela` (captura sob pedido), `TrilhaDaConversa` (barra de rolagem que
  é mapa da conversa), `BotaoCopiar`, `Markdown` (React, nunca `innerHTML`).
- Utilitários: `Icon` (SVG por nome), `format.ts`, `estadoDaCaptura.ts` (traduz o
  estado da reunião UMA vez para cápsula, sidebar e Home), `useColegasDoCiti`.

## 6. Tema e estilo

- Só tema escuro (`color-scheme: dark` em `global.css`); não há tema claro.
- Tokens em `shared/config/tokens.css` (`--c-*` canais RGB para Tailwind,
  `--color-*` prontos), declarados em `:root, :host` para valer também em
  shadow root. Regra do arquivo: não declarar cor, raio, blur ou sombra em outro lugar.
- `glass.css` (receita de vidro), `fontes.css` (Barlow para títulos; corpo na fonte
  do sistema), `scrollbar.css`. `global.css` importa tudo e o Tailwind.
- Home e sidebar usam CSS escrito à mão (`home/home.css`, `sidepanel/sidepanel.css`,
  `shared/ui/*.css`), prefixo de classes `tq-`. O verde é acento restrito a poucos
  lugares (comentário de `home.css`); cinzas neutros no resto.
- Os comentários de abertura de `tokens.css` e `global.css` ainda falam em
  "Liquid Glass"; `home.css` descreve a Home como grafite neutro. Qual direção
  visual vale em cada tela: não verificado além dos comentários.

## 7. Fluxo de gerar documento

1. **Catálogo** (`features/documents/catalogo.ts`, dados puros): `ata` (Ata de
   Reunião), `x1` (Doc Conversa (X1)), `resumo` (Resumo completo), com estrutura de
   seções e campos que o Taq pergunta. Um teste do servidor confere que bate com os
   modelos de lá. O tipo `DocumentType` em `document/generateDocument.ts` ainda lista
   também `daily`, `planning`, `review`, que não estão no catálogo.
2. **Disparo**: na reunião (seção Reuniões), botão "Criar documento"
   (`home/GerarDocumento.tsx`). A caixa mostra os tipos do catálogo, um campo livre
   e "Gerar com o padrão CITi". O texto livre também pode seguir para a conversa
   (`onPedirLivre` -> `pedirDocumento` em `HomePage.tsx`, que abre conversa nova com a
   reunião como contexto). O Taq também cria documentos por ferramenta (`features/taq`,
   fora do escopo).
3. **Geração por tipo**: `requestGeneration` faz POST em `/api/generate` do
   servidor (`SERVER_BASE_URL`); volta `content` (markdown), `html`, `pdf` (base64),
   `documentData`, `questions`, `gaps`.
4. **Salvar antes de dizer "Salvo"**: `guardarDocumento` (`features/documents/store.ts`,
   `taq:documents`). Se falhar, o resultado fica na tela com "Tentar salvar de novo",
   "Baixar" e "Descartar resultado". As perguntas da geração viram uma conversa nova
   com o Taq ("Pendências de ..."); o documento sai com marcações "A preencher".
5. **Personalizado**: "Gerar com o padrão CITi" chama `gerarPersonalizado`
   (`personalizado/cliente.ts`, `/api/documentos/<rota>`), usando só a reunião aberta
   como fonte. Guardado por `guardarGeracao` com `tipo: 'personalizado'`; o histórico
   de versões fica em `taq:documentVersions` (`versoes.ts`, máx. `MAX_VERSOES` = 30,
   escrita com revisão esperada; conflito é recusado, não sobrescrito).
6. **Seção Documentos** (`Documentos.tsx`): lista, editor de texto (autosave via
   `criarGravadorDeDocumento`, espera 700 ms; "Salvar", "Baixar .md"/"Baixar .txt",
   "Apagar documento"; "Baixar rascunho" só se o salvamento falha). Documento
   `personalizado` abre `DocumentoPersonalizado.tsx`: prévia do PDF renderizado pelo
   servidor, escopo de alteração (documento todo, capa, seção), "Pedir alteração",
   lista "Versões" com "Ver"/"Restaurar" (restaurar cria versão nova), "Baixar PDF",
   "Baixar Word" (docx gerado agora pelo servidor; edições no Word não voltam).
7. **Exportar** (`document/baixarDocumento.ts`): Blob + `<a download>`, sem
   `chrome.downloads`. `baixarComoPdf`, `baixarComoHtml` (fallback), `baixarComoTexto`,
   `baixarComoDocx`. Google Docs: `document/googleDocs.ts` (`criarGoogleDoc`, só se
   `oauthConfigurado()`), botão "Enviar ao Google Docs" aparece só no quadro de
   resultado logo após gerar; `via: 'falhou'` não mostra aviso.
8. `document/answers.ts`: tipos de pergunta/lacuna da geração.

## 8. Conversa com o Taq na interface

- Armazenamento: `home/conversations.ts` (`taq:conversations`). Só grava mensagens
  escritas pela pessoa e respostas que o Taq de fato produziu (concluídas ou
  parciais); falha/cancelamento não gravam resposta. Mensagem pode levar
  `contexto` (trecho, transcrição, notas, prints) apenas por gesto explícito.
  Resposta carrega fontes conferidas, documentos criados, `pergunta` com opções,
  `copiavel`, `operacoes`.
- `useConversaAberta`: sem escolha abre a mais recente; se a aberta é apagada,
  vai para conversa nova (nunca mostra outra em silêncio). Mesma regra na Home e na sidebar.
- Envio: `acrescentarMensagem` grava primeiro; se `taq.fase === 'pronto'`
  (`useDisponibilidadeDoTaq`), `perguntarAoTaq` roda sem prender o campo. Sem Taq a
  tela diz o motivo antes da escrita. `cancelarTaq`, `confirmarAcaoDoTaq`,
  `desfazerExclusao` vêm de `features/taq/interface`.
- Atividade do agente: `features/agent/atividade.ts`, store com estados `repouso`,
  `preparando`, `escrevendo`, `concluido`, `falhou`, `cancelado`, `interrompido`,
  mais `parcial` (texto em chegada, não gravado) e `etapa`. `observarAgente`
  alimenta a onda, os seletores e o turno. `features/agent/escuta.ts` anuncia escrita.
- Rolagem: quem rola é a página; mensagem nova só puxa a rolagem se a pessoa já
  está no fim (margem 96 px) ou acabou de enviar.

## 9. Persistência da UI

Tudo em `chrome.storage.local` por `shared/services/storage` (`readLocal`,
`writeLocal`, `onLocalChange`), chaves em `STORAGE_KEYS` (`shared/config/constants.ts`):
`taq:history`, `taq:conversations`, `taq:notes`, `taq:marks`, `taq:shots`,
`taq:documents`, `taq:documentVersions`, `taq:trabalho`, `taq:conducao`, `taq:apoio`,
`taq:integracoes`, entre outras. Telas assinam com `observar*`/`onLocalChange` para
sincronizar abas. Escritas concorrentes usam `comTravaLocal`/`criarFilaDeGravacao`.
Rascunhos de conversa, aba aberta e animação pausada são estado de React, perdidos
ao recarregar. O histórico de reuniões é escrito pelo background/content, não pela UI.

## 10. Convenções

- Nomes de domínio e UI em português (`GerarDocumento`, `observarNotas`,
  `guardarDocumento`); tipos de protocolo em inglês (`MeetingRecord`, `UiCommand`).
- Comentário de topo explica a decisão (o porquê); leia antes de mudar.
- Estados vazios e falhas são ditos na tela; nada é inventado para parecer completo.
- Rótulos de botão são contrato: `features/taq/ajuda.ts` cita rótulos literais e
  `ajuda.test.ts` quebra se um deles sumir do arquivo de implementação. Renomear
  botão exige atualizar a ajuda.
- CSS: prefixo `tq-`, cores só de tokens, sem `position: fixed/sticky` no fluxo da
  conversa. Alias `@` = `src`.

## 11. Testes

`npm test` (`vitest run`); `npm run typecheck`; `npm run lint`. `vitest.config.ts`:
ambiente jsdom, `include: src/**/*.test.{ts,tsx}`, `define __TAQCITI_DEV__: true`,
`setupFiles: src/test/semRede.ts`, `testTimeout` 20 s (testes que montam Home ou
sidebar inteiras são lentos). Rodar um arquivo: `npx vitest run src/home/HomePage.test.tsx`.

Relevantes: `home/HomePage.test.tsx`, `rota.test.ts`, `GerarDocumento.test.tsx`,
`GerarDocumentoPersonalizado.test.tsx`, `DocumentoPersonalizado.test.tsx`,
`ReuniaoEDocumentos.test.tsx`, `Preparar.test.tsx`, `AssistenteTaq.test.tsx`,
`conversations.test.ts`, `apagarConversas.test.ts`, `ContaDoCiti.test.tsx`, `Espectro.test.tsx`,
`PointerLayer.test.tsx`, `home.css.test.ts`; sidebar: `Sidebar.test.tsx`,
`Conversa.test.tsx`, `CartaoDeApoio.test.tsx`, `EstadoDosPontos.test.tsx`,
`sidepanel.css.test.ts`; shared: `CartoesDoTaq.test.tsx`, `Markdown.test.tsx`,
`estadoDaCaptura.test.ts`, `platform/extension.test.ts`; documentos:
`features/documents/store.test.ts`, `personalizado/*.test.ts`,
`document/baixarDocumento.test.ts`, `googleDocs.test.ts`; agente:
`features/agent/atividade.test.ts`; ajuda: `features/taq/ajuda.test.ts`.

Verificação na tela (não faz parte do `npm test`): `scripts/verify-ajuda.cjs`,
`verify-meetings-documents.cjs`, `verify-preparar.cjs`, `verify-trabalho.cjs`,
`verify-apagar.cjs`, que usam Playwright fora das dependências do projeto.
