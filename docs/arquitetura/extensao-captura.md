# Extensão: captura de reunião

Escopo: tudo que vai do DOM do Google Meet até o estado e o histórico guardados no navegador. Não cobre a sidebar/HOME (só como consumidoras), o servidor nem a sincronização. Todos os números de linha foram conferidos no código na data da escrita (21/10/2026, versão 2.1.2) e envelhecem: confira antes de citar.

## 1. Visão geral e fluxo

A captura é feita 100% no navegador. O content script lê as legendas do Meet pelo DOM, o service worker (background) é o dono do estado da reunião, e o `chrome.storage` é o barramento entre contextos.

```
 Google Meet (DOM)
   |  MutationObserver na região de legendas + poll de 1,5 s
   v
 GoogleMeetProvider  (src/content/providers/googleMeet/)      <- só ele conhece o DOM do Meet
   |  eventos: onMeetingStart/End, onCaptionChunk, onCaptureHealth ...
   v
 ContentController   (src/content/controller.ts)
   |  PORTÃO: sem "sim" à participação, nada sai da aba
   |  anuncia a sala em storage.session  ---------------------+
   |  chrome.runtime.sendMessage (meet/*, validado com zod)   |
   v                                                          v
 Background (src/background/index.ts)               Sidebar (página da extensão)
   |  dispatch(evento) -> machine.transition()        lê o anúncio, pergunta
   |  (sessionController.ts)                          "registrar?", grava a decisão
   |-- storage.session  taq:state  (estado vivo)  ---------->  (content script reage por
   |-- storage.local    taq:history (registro "recording"          storage.onChanged)
   |                     salvo a cada ~4 s, depois "ready")
   '-- broadcast "state/updated" -> páginas da extensão (runtime.sendMessage)
                                 -> abas (tabs.sendMessage: aba da reunião + panelTabs)
                                          |
                                          v
              Cápsula / botão na barra do Meet (aba)      Sidebar e HOME (useMeetingState)
```

Ideias que atravessam o desenho:

- O estado global da reunião é UM só por navegador. Por isso cada aba confere se o estado é "dela" (`salaDaCaptura`) antes de reagir, e o background rejeita mensagens `meet/*` vindas de outra aba (`background/index.ts:297-301`).
- Detectar uma sala não é registrar a sala: entre as duas coisas existe uma pergunta ("portão da captura", seção 3.3).
- Nada que a pessoa escreve (nota, marca, print) vai dentro do registro da reunião, porque a captura reescreve esse registro o tempo todo (comentário em `constants.ts:46-59`).

## 2. Componentes

### 2.1 Background (`src/background/`)

| Arquivo | Papel |
|---|---|
| `index.ts` | Entry do service worker. Registra listeners de forma síncrona (exigência do MV3), define `ready` (`:52`), roteia mensagens (`:266`), encerra a captura quando a aba some ou muda de sala (`:143`, `:161`, `:227`, `:246`). |
| `sessionController.ts` | Dono do `state` em memória. `hydrate` (`:37`), `dispatch` (`:243`), `flushState` (`:225`), `broadcast` (`:103`), salvamento contínuo `saveLiveRecord` (`:71`), efeitos de fim de reunião `runSideEffects` (`:132`), `recoverInterruptedMeetings` (`:50`). |
| `history.ts` | Repositório do histórico em `storage.local`: `upsertRecord` (`:25`), `patchRecord`, `finalizeStaleRecordings` (`:52`). Toda escrita passa por `comTravaLocal`. |
| `sidePanel.ts` | Abertura do painel lateral nativo (seção 3.6). |
| `sessionAccess.ts` | `setAccessLevel('TRUSTED_AND_UNTRUSTED_CONTEXTS')` para o content script enxergar `storage.session` (seção 5). |
| `injectPanel.ts` | Primeira execução: `executeScript` nas abas já abertas (`backfillOpenTabs`) e `ensurePanelInTab`. O caminho do script é lido do manifesto em runtime (o @crxjs gera um loader com hash). |
| `panelTabs.ts` | Lista (em `storage.session`, com espelho em memória) das abas com content script, para endereçar o broadcast. |
| `homeTab.ts` | Abre/foca a HOME numa aba única; reaproveita aba em branco. |
| `captura.ts` | Print da aba da reunião (seção 5, armadilhas). |
| `metrics.ts` | Contadores locais agregados (sem conteúdo de fala). |
| `storageMigrations.ts` | Migrações numeradas de `storage.local`; versão atual `LOCAL_STORAGE_SCHEMA_VERSION = 3`. Roda antes de `hydrate`. Recusa (lança) se o storage for de versão mais nova. |

### 2.2 Content script (`src/content/`)

| Arquivo | Papel |
|---|---|
| `index.ts` | `onExecute()`: sai se não é o frame de topo ou não é `meet.google.com` (`:51-52`); numa segunda execução só dispara `PANEL_OPEN_EVENT`; senão manda `panel/mounted` e sobe `ContentController` + `GoogleMeetProvider`. |
| `controller.ts` | Cola provider <-> mensageria. Portão, consentimento, botão da barra, cápsula, legendas automáticas, reflexo do estado global (`applyState`, `:692`). |
| `providers/googleMeet/GoogleMeetProvider.ts` | Detecção da chamada, observer das legendas, watchdog, identidade de falantes, participantes. Implementa a interface `MeetingProvider` (`features/meeting/provider.ts`). |
| `.../selectors.ts` | TODOS os seletores do DOM do Meet, em listas de fallback. Primeiro lugar a olhar quando o Meet mudar o layout. |
| `.../captionParser.ts` | Parser em 3 camadas: shapes de classe conhecidos, estrutural (avatar + nome + texto), degradado (marcado como tal). |
| `.../botaoNaBarra.ts` | Botão vanilla (sem React) na barra de baixo do Meet. |
| `.../chat.ts` | Escreve no chat do Meet (aviso aos participantes); devolve `false` se não conseguiu. |
| `.../accountContext.ts` | Lê a conta Google exibida no Meet. |
| `captionsVisibility.ts` | Esconde as legendas nativas sem tirá-las do fluxo de render (seção 5). |
| `visibilidade.main.ts` | Roda no mundo MAIN, em `document_start`: faz a página achar que está visível (seção 5). |
| `ui/Capsula.tsx`, `ui/mount.ts`, `ui/useFloating.ts` | Cápsula flutuante em Shadow DOM (host `taqciti-root` pendurado em `documentElement`, com `MutationObserver` que o recoloca se a página o arrancar), arraste com clamp. |

### 2.3 Domínio e transcrição (`src/features/`)

- `meeting/machine.ts`: reducer puro `transition(state, event)` (`:233`). Fases: `idle -> captionsRequired -> recording <-> paused -> ended`. Eventos ilegais para a fase devolvem o mesmo objeto de estado (o `dispatch` usa `next === prev` para não persistir nem emitir).
- `meeting/consent.ts`: participação, decisão e anúncio (seção 3.3).
- `meeting/sala.ts`: `salaDoCaminho` / `salaDaUrl`, regra única de "qual é a sala" usada pela página e pelo background. Aceita código `abc-defg-hij` e apelido de sala do Workspace; rejeita páginas do Meet (`landing`, `new`, `lookup`...).
- `meeting/payload.ts`: `buildMeetingRecord`/`buildMeetingPayload` (puras). `captionId` nunca vai ao contrato público.
- `meeting/naming.ts`: título automático a partir dos participantes (`titleAuto`).
- `transcription/`: `aggregator.ts` (chunk -> segmento; `dropped` quando o `captionId` está selado), `mergeCaption.ts` (distingue fala que cresce, fim reescrito, começo cortado pela rolagem e linha reaproveitada), `recut.ts` (linha de base da retomada), `sanitize.ts`, `speakerIdentity.ts` (colapsa "Você"/sufixos de papel numa chave de identidade e devolve renames retroativos), `languageHeuristic.ts` (pt/en a cada 8 chunks, janela de 800 caracteres).
- `panel/prefsStore.ts`: preferências do painel (`taq:prefs`): leitura por assinatura, escrita sempre por patch serializado.
- `history/export.ts`, `history/useHistory.ts`: exportação .txt e hook de leitura do histórico (escrita sempre via background).

### 2.4 Compartilhado (`src/shared/`)

`config/constants.ts` (chaves e timings), `types/messages.ts` (schemas zod), `types/domain.ts`, `services/messaging.ts`, `services/storage.ts`, `services/storageLock.ts`, `services/saveQueue.ts`, `services/log.ts`, `ui/estadoDaCaptura.ts`, `platform/extension.ts` (implementação de `subscribeMeeting`/`send` para UIs).

## 3. Como a captura funciona

### 3.1 Detecção da sala e da chamada

`GoogleMeetProvider.detectMeeting` (`:171`) exige, nesta ordem: caminho da URL que seja uma sala (`salaDoCaminho`), não estar na tela pós-chamada (`naTelaPosChamada`: botões "Participar novamente"/"Voltar à tela inicial" visíveis), e o botão de sair VISÍVEL (`checkVisibility`, não só presente no DOM). A exceção é a sala forçada pela pessoa (`forcada`, via `forceMeeting`) na mesma sala.

O `poll` (`:480`, a cada `MEET_POLL_INTERVAL_MS` = 1500 ms) emite `onMeetingStart` e `onMeetingEnd`. O fim exige `MEET_END_CONFIRM_POLLS` = 2 polls seguidos sem chamada (evita falso fim em re-render). Trocar de sala na mesma aba (o Meet é SPA) encerra a antiga e abre a nova no mesmo poll. `encerrarSala` (`:467`) zera todo estado de captura (pausa, legenda "ligada", saúde), senão vaza para a reunião seguinte.

### 3.2 Legendas

- A captura depende de as legendas do Meet estarem LIGADAS. `areCaptionsEnabled` (`:246`) olha `aria-pressed` do botão; só usa o texto da região como fallback (a região existe vazia com legendas desligadas).
- `requestEnableCaptions` clica no botão. O controller repete até `AUTO_CAPTIONS_MAX_ATTEMPTS` = 6 vezes enquanto a fase é `captionsRequired` (`controller.ts:635`). "Gravar agora" zera as tentativas e religa o observer (`reattachCaptions`).
- `ensureCaptionObserver` (`:612`) observa a região com `MutationObserver`; as varreduras são agrupadas a no mínimo `CAPTION_SCAN_INTERVAL_MS` = 120 ms.
- Cada nó de legenda ganha um `captionId` estável (`cap-<tag da carga>-<época>-<n>`) em `WeakMap`. Trocou o falante no mesmo nó = fala nova. A época sobe a cada recorte e a tag muda a cada carga de página, para ids de uma carga anterior (possivelmente selados) nunca colidirem.
- Watchdog (`checkCaptureHealth`, `:557`): legendas ligadas, nenhum chunk por `CAPTURE_STALL_TIMEOUT_MS` = 25 s e legenda visível na tela = captura travada: reata o observer e publica `healthy=false`. Silêncio real não é falha. Legendas ligadas mas região inexistente = falha (seletores desatualizados).
- Pausa/limpeza: `PAUSE` e `CLEAR_TRANSCRIPT` selam os `captionId` das falas existentes. Como o Meet reaproveita os nós, retomar exige `recutCaptions` (`:318`): troca a época, guarda o texto visível como linha de base e põe os nós existentes em quarentena (o que disserem a mais é resto da pausa). O controller dispara isso em `recutIfNeeded` (`controller.ts:662`). Esquecer o recorte faz toda fala posterior ser descartada em silêncio (o painel continuaria "gravando").

### 3.3 O portão da captura e o consentimento por participação

Fluxo em `ContentController.considerarReuniao` (`controller.ts:511`):

1. `salaAnunciada` impede reprocessar a mesma sala a cada re-render (o Meet reemite `onMeetingStart` com frequência).
2. `abrirParticipacao(sala, agora)` (`consent.ts:107`) devolve a participação vigente: a mesma se ainda aberta (`saiuEm === null`); a mesma retomada se fechada há até `REJOIN_RESUME_WINDOW_MS` (10 min); senão uma nova (id novo).
3. `decisaoDe(participacaoId)`:
   - `aceito` ou `continuar:<id>` -> `iniciarCaptura` direto (caso do reload no meio de reunião aceita);
   - `recusado` -> nada é enviado; a UI mostra "sem registro";
   - nenhuma, mas dentro de `HERANCA_ENTRE_SALAS_MS` (90 s) após sair de uma sala registrada nesta aba -> herda o "sim" (salas de grupo);
   - nenhuma -> `anunciarReuniao` grava `taq:pendingMeeting` em `storage.session` e PARA. A pergunta aparece na cápsula e na sidebar.
4. A resposta, dada em qualquer das duas superfícies, é `guardarDecisao(participacaoId, decisao)` em `taq:meetingConsent` (`storage.session`). O content script a recebe por `observarDecisoes` (`controller.ts:378`) via `storage.onChanged`, não por mensagem (a sidebar não alcança content script). Por ser a mesma chave, responder num lugar apaga a pergunta no outro.
5. `iniciarCaptura` (`:573`) é o único ponto que manda `meet/detected` ao background. Antes dele, o `onCaptionChunk` também descarta chunks se `!autorizaCaptura(decisao)`.

Por que a chave é a participação e não o código da sala: o link do Meet é reutilizado (a daily de amanhã tem o mesmo endereço). Os dados vivem em `storage.session` de propósito: fechar o navegador apaga a permissão (a pergunta volta); o histórico em `storage.local` não é tocado. `fecharParticipacao` não apaga, só marca `saiuEm`. O registro de decisões é podado em `MAX_LEMBRADAS` = 40.

"Continuar de onde parou": se existe gravação encerrada da mesma sala (`gravacaoAnteriorDaSala`, só registros com `meetingCode` e com falas), a pergunta oferece a decisão `continuar:<id>`. O background só aceita se o id for do histórico e da mesma sala (`index.ts:309`); a máquina reabre a sessão com o mesmo `meetingId` e sela os `captionId` antigos (`machine.ts:211`).

Caminho manual: `gravarAgora` (`controller.ts:230`), acionado pela cápsula, pelo botão da barra ou pela sidebar (`ui/gravarAgora` -> background -> `meet/gravarAgora` -> aba). Abre a participação, grava `aceito`, força o provider a tratar a sala como chamada (`forceMeeting`) e inicia. Existe porque o detector automático depende de DOM do Meet e pode silenciar.

### 3.4 Estados da captura (`derivarEstadoDaCaptura`)

`shared/ui/estadoDaCaptura.ts:46`: uma única tradução de `phase + captureHealthy + startedAt + lastChunkAt + nº de falas` para o que se mostra, usada por cápsula, botão da barra, sidebar e HOME.

| Estado | Quando |
|---|---|
| `preparando` | fase `captionsRequired` |
| `pausada` | fase `paused` |
| `salva` / `desligada` | fase `ended` com falas / sem falas (não dizer "salva" sem transcrição) |
| `iniciando` | `recording`, nenhum trecho, há menos de `INICIANDO_MS` = 20 s |
| `aguardando_fonte` | `recording`, sem trecho nenhum após 20 s, ou sem trecho há `SEM_TRECHO_MS` = 2 min (pode ser silêncio ou legenda desligada; o rótulo não afirma qual) |
| `interrompida` | `captureHealthy === false`, há menos de `ERRO_APOS_MS` = 45 s sem trecho |
| `erro` | `captureHealthy === false` e mais de 45 s sem trecho |
| `capturando` | demais casos em `recording` |
| `desligada` | `idle` e qualquer outro caso |

No controller, `estadoDaCapturaAgora` (`:166`) usa `IDLE_STATE` quando o estado global não é desta aba.

### 3.5 Cápsula flutuante e botão na barra

- Botão na barra (`botaoNaBarra.ts`): achado subindo a partir do botão de sair até um ancestral que agrupa botões e entrando antes dele. O Meet redesenha a barra e remove o que não é dele, então `sincronizarBarra` (`controller.ts:183`, a cada 1,5 s) reconfere e recoloca. Cor por estado: âmbar (perguntando/preparando/aguardando), verde (capturando, pulsando), vermelho (erro), neutro (desligada/salva).
- Quando o botão está montado (`barraAtiva`), a cápsula flutuante some, exceto se há pergunta. Se a barra não é encontrada, a cápsula continua como fallback. Presença `closed` esconde cápsula e botão, salvo pergunta pendente.
- Clique no botão (`cliqueNaBarra`, `:160`): abre a sidebar PRIMEIRO; se não há captura nem pergunta, também chama `gravarAgora`.
- Posição da cápsula: fração 0..1 do espaço livre (não pixel) em `taq:prefs`; `DEFAULT_PANEL_PREFS` nasce encostada à direita (`x: 0.97`) e o balão da pergunta é preso ao viewport para não ser cortado.
- O primeiro quadro só é pintado depois de as prefs chegarem (`prefsLoaded`), para a cápsula não piscar com valores padrão.

### 3.6 Abertura da sidebar e o gesto do usuário

`chrome.sidePanel.open()` exige ativação do usuário, e ela vale só para o turno SÍNCRONO do handler. O gesto atravessa `runtime.sendMessage`, mas é consumido por qualquer `await` antes do `open()` (medido no Chrome 144: com um `await`, recusa; sem, abre). Consequências no código:

- `background/index.ts:280`: `ui/openSidePanel` é tratado ANTES do `await ready` que protege todos os outros casos. Esse `await` era o culpado do "may only be called in response to a user gesture".
- `abrirPainel(tabId)` (`sidePanel.ts:81`) NÃO é `async`: chama `open()` como primeira coisa e só trata o resultado no `then`. `abrirPainelNaJanela` (`:100`) precisa de `await` para achar a janela e é "último recurso" (sem gesto a perder).
- `Capsula.abrir` e `aceitar` também não esperam nada antes de enviar a mensagem; `cliqueNaBarra` chama `onAbrirSidebar` antes de qualquer outra coisa.
- Caminho que sempre funciona: `setPanelBehavior({ openPanelOnActionClick: true })` (`ligarAberturaPeloIcone`, `:53`), chamado a cada boot do worker (é por perfil, e `onInstalled` roda uma vez só). `action.onClicked` é rede de segurança: se disparar, tenta `abrirPainel` e, se falhar, abre a HOME.
- A resposta `{ ok, motivo: 'gesto' | 'erro' }` permite à cápsula explicar o caminho manual em vez de "não fazer nada".

### 3.7 Reuniões em andamento, fim e recuperação

- Salvamento contínuo: a cada mudança relevante, `saveLiveRecord` grava um registro `status: 'recording'` no histórico, no máximo a cada `LIVE_SAVE_THROTTLE_MS` = 4 s; o que o throttle adia é agendado para o fim da janela (trailing). Chunks são coalescidos: `STATE_FLUSH_INTERVAL_MS` = 250 ms entre escritas de `taq:state` + broadcast (`sessionController.ts:219-240`); qualquer outro evento é imediato.
- Fim por três caminhos, todos idempotentes (`MEETING_FINISHED` só vale em fase ativa): provider (`meet/ended`), aba fechada (`tabs.onRemoved`) e aba navegada para fora da sala (`tabs.onUpdated`), mais `encerrarSeAAbaSumiu` no boot do worker. Nos caminhos do background também se fecha a participação e se esquece o anúncio (senão voltar ao link horas depois reaproveitaria o "sim").
- Fim COM falas: registro `ready` + métricas. Fim SEM falas: só vira registro se há print ou nota presos (`temAnexos`); senão limpa os vínculos e não deixa registro.
- Reentrada: mesma sala com sessão ativa = sessão continua (só atualiza `tabId` e legendas). Mesma sala em `ended` há até 10 min = retoma a mesma sessão (`reconnectCount++`). Qualquer outro caso = sessão nova; se havia sessão anterior com falas, ela é selada como `ready` (`runSideEffects`).
- Recuperação após queda: no boot, `recoverInterruptedMeetings` troca para `ready` todo registro `recording` que não seja a sessão viva (`finalizeStaleRecordings`). O estado vivo vem de `storage.session` (`hydrate`), que sobrevive ao worker mas não ao navegador.
- Saída do estado `ended`: `RESET` volta a `idle`. É disparado pelo `onRemoved` (aba fechada) ou por `ui/reset`.

## 4. Mensageria e persistência

### 4.1 Mensagens (`shared/types/messages.ts`)

Todo handler passa por `messageSchema.safeParse` (`messaging.ts`); inválida é descartada. Retornar `undefined` deixa a resposta para outro listener; handler que rejeita responde `{ ok: false, error: 'internal' }`.

| Grupo | Tipos | Sentido |
|---|---|---|
| Content -> background | `meet/detected`, `meet/ended`, `meet/captions`, `meet/chunk`, `meet/participants`, `meet/accountContext`, `meet/speakersMerged`, `meet/reconnect`, `meet/captureDegraded` (`parser`\|`stall`), `meet/captureRecovered` | `runtime.sendMessage` |
| Background -> aba da reunião | `meet/sendChatNotice`, `meet/gravarAgora` | `tabs.sendMessage(tabId)`; resposta `{ ok }` |
| UI -> background (`uiMessageSchema`) | `panel/mounted`, `ui/openSidePanel`, `ui/openHome`, `ui/print`, `ui/chatNotice`, `ui/gravarAgora`, `ui/getState`, `ui/pause`, `ui/resume`, `ui/clearTranscript`, `ui/finish`, `ui/rename`, `ui/reset`, `ui/dismissLanguageWarning`, `ui/history/{delete,rename,restore}` | `runtime.sendMessage` |
| Broadcast | `state/updated` (com `MeetingState` completo) | background -> todos |

Pontos de projeto:

- `meet/captureRecovered` existe porque só a aba enxerga o DOM; sem ele a sidebar avisaria "interrompida" até o fim da reunião.
- `runtime.sendMessage` não alcança content script, por isso o broadcast usa `panelTabs` + a aba da sessão num `Set` (`sessionController.ts:103`). Uma mensagem que falha poda a aba da lista.
- `ui/history/delete` recusa apagar a reunião em andamento (`meeting-active`) e limpa vínculos (notas, marcas, prints) junto; documentos ficam sem vínculo.
- `ui/history/restore` nunca sobrescreve: se o id já existe, responde `ok` sem mudar nada.
- Fora da mensageria: o canal pergunta/resposta de consentimento é `storage.session` + `onChanged`.
- Quem manda também importa: ver a barreira de remetente na seção 5 (`remetente.ts`). Ela decide, por tipo de mensagem, qual contexto pode mandá-la.

### 4.2 Chaves de storage da captura (`STORAGE_KEYS`, `constants.ts:6`)

| Chave | Área | Conteúdo |
|---|---|---|
| `taq:state` | session | `MeetingState` vivo (fase + sessão) |
| `taq:history` | local | registros de reunião (fonte da verdade das transcrições), mais recente primeiro |
| `taq:metrics` | local | contadores numéricos |
| `taq:prefs` | local | posição, presença, `hideMeetCaptions` etc. |
| `taq:panelTabs` | session | ids das abas com content script |
| `taq:participation` | session | participação atual (`id`, `meetingCode`, `comecouEm`, `saiuEm`) |
| `taq:meetingConsent` | session | mapa `participacaoId -> decisão` |
| `taq:pendingMeeting` | session | reunião detectada aguardando resposta |
| `taq:notes`, `taq:marks`, `taq:shots`, `taq:chatNotice` | local | anexos da reunião, fora do registro |

Existem outras chaves `taq:*` (documentos, sync, conversas, integrações etc.) que pertencem a outras áreas. Chaves legadas `cfc:*` são migradas uma vez (versão 1 do schema) e removidas. Os registros antigos com `status` fora de `recording|ready` são normalizados para `ready` na leitura (`history.ts` e `useHistory.ts`, de propósito nos dois lados).

### 4.3 Trava local e fila de gravação

- `comTravaLocal(chave, tarefa)` (`storageLock.ts`): `navigator.locks.request('taqciti:<chave>')`, com fallback para uma fila de promises em memória. Coordena HOME, sidebar e worker (contextos distintos). Todo read-modify-write de `taq:history` passa por ela (`upsertRecord`, `patchRecord`, `finalizeStaleRecordings`); `upsertRecord` mescla com o registro anterior e reordena por `startedAt`.
- `criarFilaDeGravacao` (`saveQueue.ts`): fila por id, debounce de 700 ms, combina edições pendentes e, se a escrita falha, reenfileira mantendo a edição mais recente e sinaliza `falhou`. Usada pelas UIs (notas, documentos), não pela captura.
- `patchPanelPrefs` (`prefsStore.ts`): fila de promises por contexto; cada patch relê antes de gravar, para dois cliques na mesma volta não se perderem.
- `bumpMetrics` NÃO usa trava (lê, soma, grava): em concorrência pode perder incrementos. Não verificado se isso já causou problema; são só contadores.

## 5. Decisões de projeto e armadilhas conhecidas

- Área `session` negada a content scripts (`sessionAccess.ts`). Sem `setAccessLevel(TRUSTED_AND_UNTRUSTED_CONTEXTS)` toda chamada do content script a `storage.session` rejeita; como o portão é assíncrono e era chamado com `void`, a pergunta simplesmente nunca nascia, sem erro visível. Hoje a liberação é a PRIMEIRA etapa de `ready`, `considerarReuniaoComLog` loga a falha e tenta de novo até `TENTATIVAS_DO_PORTAO` = 3 vezes (1 s, 3 s, 9 s), e `salaAnunciada` é limpa na falha (senão a sala ficaria "já anunciada" para sempre).
- Estado do worker: o service worker morre e renasce. Por isso listeners são registrados no escopo do módulo, `ensurePanelPrefs` e `ligarAberturaPeloIcone` rodam a cada boot, e `ready` é aguardado por todo handler (com `.catch` para uma falha de migração não deixar painéis sem resposta). Cuidado: o `await ready` não pode voltar para antes de `ui/openSidePanel`.
- `observarDecisoes` escolhe o alvo (`sessao ?? reuniaoPendente ?? salaAtual`) ANTES de limpar a pendência. Na ordem inversa, `detectMeeting()` devolvendo `null` por alguns quadros num re-render do Meet fazia o "sim" ser gravado, a pergunta sumir e a captura nunca começar (`controller.ts:388-399`).
- Barreira de aba em `background/index.ts:297`: toda aba do Meet tem content script; sem a barreira, a legenda de uma sala em outra aba (sem "sim") entraria na reunião ao vivo, e a tela pós-chamada de uma reunião antiga encerraria a de hoje. `meet/detected` é a exceção (é como uma aba reivindica a reunião).
- Legendas escondidas por layout, não por `opacity`: `opacity: 0` deixava os rostos encolhidos e uma faixa preta (a região ocupa altura). `captionsVisibility.ts` tira a região do fluxo (`position: fixed`, ~1px, `clip-path`) mantendo-a renderizada; `display: none` poderia fazer o Meet parar de atualizar. Só esconde se `minha && sessionActive && prefs.hideMeetCaptions` e nunca por falha de leitura: as legendas só reaparecem por pedido explícito da pessoa ("religar").
- Aba em segundo plano (`visibilidade.main.ts`): o Meet para de atualizar legendas quando a página está "escondida". Um script no mundo MAIN sobrescreve `hidden`/`visibilityState` e barra o `visibilitychange` real, ligado/desligado por `CustomEvent('taqciti:visibilidade')` que o controller emite em `applyState`. É melhor-esforço: o Chrome ainda pode limitar timers de aba escondida.
- Parser de legendas em camadas: o Meet troca classes ofuscadas sem aviso. O fallback antigo devolvia a região inteira como uma linha (segmento gigante que se reescrevia e encolhia). Agora o modo degradado é marcado (`parserDegraded`) e vira `captureDegraded('parser')`.
- Texto do DOM é não confiável: só `textContent`, sanitizado (controles, zero-width, tamanho máx. 4000; nomes 120). O schema de mensagem repete esses limites.
- Print (`captura.ts`): `captureVisibleTab(windowId)` captura a aba ATIVA da janela, não a pedida; por isso confere que a aba da sessão existe e está ativa antes, senão devolve motivo (`sem-reuniao`, `aba-fechada`, `aba-nao-ativa`, `recusado`). JPEG qualidade 88 para não estourar a cota de `storage.local`, o que falharia a PRÓXIMA gravação de qualquer coisa, inclusive a transcrição.
- Chat do Meet (`chat.ts`): sem API; usa o setter nativo do protótipo + evento `input` borbulhando (atribuir `.value` não atualiza o componente). `false` nunca pode virar confirmação na tela.
- Content script só no Meet, com `run_at: document_end`, `all_frames: false` (`manifest.config.ts`). **Mudança do plano de segurança (21/10/2026, commit `923ea5a`):** o `matches` era `<all_urls>` e passou a `https://meet.google.com/*`. Motivo: o painel já só existia no Meet (`content/index.ts` saía cedo em qualquer outro host), e manter o script em todo site só punha código da extensão, com acesso ao storage e ao background, no processo de cada página aberta. O @crxjs copia esse `matches` para os `web_accessible_resources` dos chunks, então os dois têm de andar juntos: o plugin `panelResourcesOnlyOnMeet` (`vite.config.ts`, antes `panelResourcesEverywhere`) fixa essas entradas em `ONDE_O_PAINEL_VIVE` e é a trava contra a entrada gerada ficar mais larga (qualquer site detectaria a extensão pelo ID fixo) ou mais estreita (o import do bundle falharia sem erro no build). `injectPanel.canInject` também só aceita `https://meet.google.com`.
- Barreira de REMETENTE (`background/remetente.ts`, commit `923ea5a`): o zod de `messaging.ts` confere a forma da mensagem, não quem a mandou. `remetentePermitido(message, sender, idDaExtensao, raizDaExtensao)` roda no topo de `onMessage` em `background/index.ts`: página da própria extensão (`sender.url` na raiz da extensão) pode tudo; content script só se vier da aba de topo (`frameId 0`) do Meet e só com `meet/*`, `panel/mounted`, `ui/openSidePanel` ou `ui/getState`. O resto é descartado em silêncio (com `logger.warn`). Sem isso, um renderer comprometido numa aba qualquer herdava o content script e, com ele, comandos como ler a transcrição ao vivo, capturar a tela da reunião, escrever no chat ou apagar reuniões. Teste: `background/remetente.test.ts`.
- Clique de verdade na cápsula (`Capsula.tsx`, `gestoReal`, commit `923ea5a`): o shadow root é `open`, então o script da página do Meet alcança os botões e pode disparar `.click()`, começando uma captura que ninguém autorizou. Os botões de aceitar ("Iniciar captura", "Nova gravação", "Continuar") só agem se `nativeEvent.isTrusted` for verdadeiro (em jsdom, todo evento é sintético, daí a exceção do modo `test`).
- Estado ao vivo só do background (`shared/platform/extension.ts`, commit `923ea5a`): `state/updated` é ignorado quando `sender.tab` existe, porque um content script também alcança as páginas da extensão por `runtime.sendMessage` e não pode desenhar um estado inventado nelas.
- `chrome.storage.session` não sobrevive ao fechar o navegador: é intencional para consentimento e participação.
- O logger (`services/log.ts`) usa allowlist de campos (`SAFE_LOG_KEYS`): conteúdo de fala nunca é logado; campo novo precisa ser classificado.
- Identidade: "Você" e variantes com sufixo de papel colapsam numa chave; quando o nome real aparece depois, `SPEAKERS_MERGED` reescreve falas, participantes, `speakersObserved` e o título automático.
- Idioma: heurística pt/en avisa se a legenda do Meet não está em português (`languageWarningDismissed` por reunião).

## 6. Inconsistências encontradas entre comentários e código

- `shared/types/messages.ts:225-231` diz que o gesto se perde no caminho cápsula -> mensagem; `sidePanel.ts` e `Capsula.tsx` documentam (com medição) que o gesto atravessa e só um `await` o consome. O comentário do schema está desatualizado.
- `background/index.ts:6-8` ("sem envio a nenhum backend") contradiz `ligarSincronizacaoAutomatica()` no mesmo arquivo (`:110`) e o comentário de `constants.ts` sobre `taq:sync`.
- O comportamento passou a bater (commit `923ea5a`: o manifesto, o `vite.config.ts` e `injectPanel.canInject` restringem o script ao Meet, como `content/index.ts` já fazia), mas **dois comentários continuam dizendo "qualquer aba"**: `panelTabs.ts:12` ("Agora que ele abre em qualquer aba…") e `manifest.config.ts:273`. São comentários velhos, não comportamento.
- Comentário de `web_accessible_resources` (`manifest.config.ts`) cita "o alcance real continua sendo o do activeTab", mas `activeTab` não está mais em `permissions`.
- `ui/Capsula.tsx:69-70`: comentário de `ultimoTrechoEm` com caractere de controle (quebra de linha literal no meio de "null"). Cosmético.

## 7. Como testar

Comandos (`package.json`): `npm test` (vitest run), `npm run test:watch`, `npm run typecheck`, `npm run lint`, `npm run build` (saída em `dist/`), `npm run build:dev` (saída em `dist-dev/`, pasta separada para não obrigar rebuild de produção). Um arquivo só: `npx vitest run src/features/meeting/machine.test.ts`.

Ambiente de teste (`vitest.config.ts`): jsdom (o parser só tem valor contra DOM real), `src/test/semRede.ts` como setup, `__TAQCITI_DEV__ = true`, timeout de 20 s.

Testes relevantes a esta área:

- Estado e consentimento: `features/meeting/machine.test.ts`, `consent.test.ts`, `payload.test.ts`, `naming.test.ts`, `sala.test.ts`; `shared/ui/estadoDaCaptura.test.ts`.
- Transcrição: `features/transcription/{aggregator,mergeCaption,recut,sanitize,speakerIdentity,languageHeuristic}.test.ts`.
- Meet/DOM: `content/providers/googleMeet/{GoogleMeetProvider,captionParser,accountContext,botaoNaBarra}.test.ts` (fixtures em `captionFixtures.ts`); `content/controller.test.ts`, `content/index.test.ts`.
- Background: `background/{homeTab,injectPanel,panelTabs,sessionAccess,storageMigrations}.test.ts`.
- Infra compartilhada: `shared/services/{saveQueue,log,identidade}.test.ts`, `features/panel/{prefs,prefsStore}.test.ts`.
- Sem teste dedicado verificado: `sessionController.ts`, `sidePanel.ts`, `history.ts`, `captura.ts`, `captionsVisibility.ts`, `visibilidade.main.ts`, `chat.ts`, `storageLock.ts`. A abertura da sidebar pela cápsula só se prova no Chrome real (o gesto não existe em jsdom).
- Verificação ao vivo: `scripts/verify-*.cjs` existem (`verify-ajuda`, `verify-apagar`, `verify-meetings-documents`, `verify-preparar`, `verify-trabalho`), mas o conteúdo não foi lido; não é verificado se algum cobre a captura. Para a captura, o teste definitivo é carregar `dist/` em `chrome://extensions` e entrar numa sala do Meet com legendas.
- Depois de mexer em seletores (`selectors.ts`), parser ou `GoogleMeetProvider`, rode ao menos `captionParser.test.ts` e `GoogleMeetProvider.test.ts` e confira no Meet real: o DOM do Meet muda sem aviso e os testes usam fixtures.
