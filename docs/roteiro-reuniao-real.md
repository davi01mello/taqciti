# Roteiro: validar a experiência de reunião num Meet de verdade

O que está automatizado é **teste de integração com eventos simulados**: o
script dirige a página do painel e manda ao background as mesmas mensagens que
o content script mandaria (`valida-sidebar.mjs`, fora do repo, no diretório
temporário da sessão). Isso cobre o background, o storage e a sidebar de ponta
a ponta — e **não** cobre nada que dependa do DOM do Google Meet ou de uma
sessão autenticada.

Este roteiro é a outra metade. Nenhum item aqui pode ser dado como aprovado sem
alguém executá-lo.

**Antes de começar:** `npm run build`, e em `chrome://extensions` carregar
`dist/` sem empacotar (ou recarregar, se já estiver carregada). Confira que o
ícone do TaqCiti está fixado na barra.

---

## 1. Entrada e detecção com a sidebar FECHADA

| Passo | Resultado esperado |
| --- | --- |
| Feche o painel lateral. Entre numa reunião do Meet. | A cápsula aparece na página com o rótulo `registrar?` e um ponto âmbar pulsando. |
| Olhe a página, sem abrir nada. | Ao lado da cápsula: **"Deseja registrar esta reunião?"**, o nome da sala, e os botões **Iniciar captura** / **Agora não**. |
| Confira a transcrição. | Nada foi capturado ainda. Em `chrome://extensions` → service worker → console, nenhuma `meet/detected` foi enviada. |

> Se a pergunta não aparecer, o provider não detectou a sala. O sinal é a
> cápsula ficar em `TaqCiti` em vez de `registrar?`.

## 2. Recusa mantém a captura desligada

| Passo | Resultado esperado |
| --- | --- |
| Clique em **Agora não**. | A pergunta some. A cápsula passa a `sem registro`. |
| Fale alguma coisa na reunião por ~30s. | Nenhuma fala é capturada. |
| Abra a sidebar (ícone da extensão **ou** clique na cápsula). | Aba **Reunião** mostra "Captura desligada" e o botão **Começar a registrar**. Nenhuma pergunta duplicada. |

## 3. A cápsula abre o painel

| Passo | Resultado esperado |
| --- | --- |
| Com o painel fechado, clique na cápsula. | O painel lateral abre. |
| Arraste a cápsula para outro canto e solte. | Ela se move e **não** abre o painel (arraste ≠ clique). |

> Medido no Chrome 144: o clique na página abre o painel. Se aqui aparecer a
> mensagem "Não consegui abrir o painel daqui", algo voltou a pôr um `await`
> antes do `sidePanel.open()` — ver `src/background/sidePanel.ts`.

## 4. Aceitação inicia a captura

| Passo | Resultado esperado |
| --- | --- |
| Na sidebar, clique em **Começar a registrar**. | A cápsula vai para `preparando…` e depois para o cronômetro. O selo do cabeçalho vira **Transcrevendo** (verde). |
| Fale, e peça para outra pessoa falar. | As falas aparecem na aba **Reunião**, com nome e horário. As legendas nativas do Meet ficam escondidas. |

## 5. Pausa e retomada

| Passo | Resultado esperado |
| --- | --- |
| **Pausar transcrição**, e fale por ~20s. | Selo vira **Pausado**. Aviso "Captura pausada…". O que já tinha sido transcrito continua na tela. |
| **Retomar**, e fale de novo. | Volta a **Transcrevendo**. As falas novas entram. **Nada do período pausado aparece.** |

## 6. Aviso no chat — janela de um minuto

| Passo | Resultado esperado |
| --- | --- |
| Dentro do primeiro minuto **depois de a captura começar**, veja a aba Reunião. | Cartão "Avisar no chat da reunião…", com o texto exato que será enviado e um contador em segundos. |
| Clique em **Enviar ao chat**. | O chat do Meet abre e a mensagem é enviada. O cartão vira "Avisado no chat da reunião." |
| Recarregue a aba do Meet e reabra a sidebar. | O cartão continua dizendo "Avisado" — **não** volta a oferecer o envio. |
| (Noutra reunião) Deixe o minuto passar sem clicar. | O cartão encolhe e some suavemente. A transcrição **não** salta. |
| (Noutra reunião) Deixe o minuto passar, recarregue a página. | O cartão **não** reaparece. |

> Este é o item mais frágil do conjunto: escrever no chat depende de seletores
> do DOM do Meet. Se falhar, a mensagem é "Não consegui escrever no chat do
> Meet" + **Copiar o texto** — e nada é marcado como enviado. Um "Avisado" sem
> a mensagem ter aparecido no chat é um defeito grave; registre.

## 7. Notas separadas da transcrição

| Passo | Resultado esperado |
| --- | --- |
| Aba **Notas**, escreva duas linhas. | Depois de ~1s aparece `salvo` ao lado do título. |
| Vá para **Conversa** e volte para **Notas**. | O texto continua lá. |
| Volte para **Reunião**. | O cabeçalho mostra "· com nota". A transcrição **não** contém uma palavra da nota. |
| Feche o painel, reabra. | A nota continua. |

## 8. Marcação preservada quando o trecho é atualizado

| Passo | Resultado esperado |
| --- | --- |
| Clique numa fala **que ainda esteja sendo dita**. | Realce discreto e a fileira de ícones (★ ? ✓ →) + "Perguntar à IA". |
| Marque com **Decisão** (✓). | O ícone aparece à direita do nome de quem falou. |
| Espere a mesma fala ser completada pelo Meet. | O texto cresce; **a marca continua na mesma fala**. |
| Clique no ✓ de novo. | A marca sai. |
| Baixe o `.txt` depois. | O arquivo **não** tem ícone nenhum. |

## 9. Print da aba certa

| Passo | Resultado esperado |
| --- | --- |
| Com a aba do Meet à vista, clique em **Tirar print**. | Prévia da tela da reunião, com **Salvar** / **Descartar**. |
| **Salvar**. | A miniatura entra na tira abaixo. |
| Vá para outra aba do navegador e clique em **Tirar print**. | Recusa com "Vá até a aba da reunião e tente de novo…". **Nenhuma imagem de outra aba é salva.** |
| **Descartar** numa prévia. | Nada é guardado. |

## 10. Perguntar à IA com contexto

| Passo | Resultado esperado |
| --- | --- |
| Selecione uma fala e clique em **Perguntar à IA**. | Vai para a aba Conversa. O trecho aparece acima do campo, com o nome da reunião, e pode ser removido no ×. |
| Antes de escrever. | O aviso "Sem assistente conectado…" está visível. |
| Envie a pergunta. | A pergunta fica salva, com o contexto. A resposta é o estado honesto — **sem** indicador de processamento infinito. |

## 11. Saída, histórico e exportação

| Passo | Resultado esperado |
| --- | --- |
| **Finalizar** (ou saia da reunião). | Tela "Transcrição salva", com **Abrir no TaqCiti** e **Baixar .txt**. |
| **Baixar .txt**. | Arquivo com título, data e as falas na ordem. Sem notas, sem marcas. |
| Sidebar → **Histórico** → **Reuniões**. | A reunião está lá, com "· com nota". |
| Abra-a. | Nota editável, download e **Abrir na HOME**. |
| **Abrir na HOME**. | A aba da HOME abre (ou é focada) na reunião. Nota e marcações aparecem lá também. |

## 12. Nova participação no mesmo link

Este é o cenário que a regra de autorização por participação existe para
cobrir. **Não pule.**

| Passo | Resultado esperado |
| --- | --- |
| Autorize e capture uma reunião. Saia da chamada. | Cápsula em `salva`. |
| Entre **de novo no mesmo link**, em menos de 10 minutos. | **Não** pergunta de novo: é a mesma participação, retomada, e a transcrição continua. |
| Saia, espere **mais de 10 minutos**, e entre no mesmo link. | **Pergunta de novo.** A captura fica desligada até você responder. |
| Feche o Chrome por completo, reabra e entre no mesmo link. | **Pergunta de novo**, mesmo que a última resposta tenha sido "sim". |
| Confira o histórico. | As reuniões anteriores continuam todas lá — o que expira é a permissão, não o registro. |

---

## O que registrar

Para cada item: **passou / falhou / não deu para testar**, e, quando falhar, o
que apareceu na tela e o que o console do service worker mostrou
(`chrome://extensions` → TaqCiti → "service worker").
