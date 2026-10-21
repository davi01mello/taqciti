# O assistente Taq — arquitetura

Este documento descreve o Taq como está no código. Detalhes de contratos,
especialistas e cartões: `docs/taq-agentes.md`. Estado de validação ao vivo:
`docs/taq-progresso.md`. Condução de reunião: `docs/segundo-cerebro.md`.
Itens marcados "não verificado" não foram conferidos no código.

## 1. O que é

O Taq é o único assistente que a pessoa vê, na HOME e na sidebar da extensão.
Por dentro é um **orquestrador** (`src/features/taq/orquestrador.ts`) que usa
ferramentas sobre os registros guardados no navegador (reuniões, documentos,
conversas, trabalho) e delega a **15 especialistas** do catálogo
(`catalogo.ts`): 11 de modelo e 4 determinísticos (`capture_monitor`,
`evidence_verifier`, `quality_review`, `privacy_review`), que respondem sem
chamar modelo. Todos estão ativos (`especialistas.ts`, `ativarEspecialistas`).

Princípio: o modelo **propõe**; o código **confere** (escopo, efeito, argumentos,
fontes); a pessoa **autoriza** o que sai do computador.

## 2. Fronteira de execução

- **Extensão**: roda o ciclo inteiro (contexto, chamadas ao modelo, execução de
  ferramentas, citações, gravação). Os registros ficam em `chrome.storage.local`
  (`armazenamento.ts`, interface `ArmazenamentoDoTaq`).
- **Servidor** (`server/`): só fala com o provedor de IA. Cada `POST
  /api/taq/turno` é **uma** chamada ao modelo. Chave do provedor e instruções de
  sistema ficam nele.
- O que sai do computador: a mensagem, um índice magro (título/data/tamanho) e os
  trechos que as ferramentas devolveram, em fatias limitadas.
- O adaptador da extensão (`modelo.ts`, `criarAdaptadorHttp`) e o contrato do
  servidor (`server/lib/taq/contrato.ts`) são espelhos validados por zod nos dois
  lados.

## 3. O ciclo de um turno

Entrada: `perguntarAoTaq` (`interface.ts`), chamada pela HOME ou sidebar depois de
gravar a mensagem da pessoa.

1. **Uma execução por vez por página.** Se já há uma em curso, devolve o desfecho
   `ocupado` (a mensagem fica gravada, sem resposta). Observa o storage: conversa
   apagada no meio cancela a execução.
2. **Pedido** (`PedidoAoTaq`): conversa, reunião da conversa (define o escopo),
   texto, `continua` (a mensagem responde a uma pergunta anterior do Taq),
   histórico, registros selecionados na tela e `acoes` da interface.
3. **Escopo e efeitos** (`politica.ts`, `escopoDaConversa`): montados em código a
   partir da conversa e do texto. Conversa nascida de uma reunião vê só aquela
   reunião e documentos ligados a ela ou à conversa; a HOME vê tudo do computador.
4. **Orçamento, sinal e livro** (`orcamento.ts`, `evidencias.ts`): um orçamento
   único compartilhado com as delegações; um sinal com motivo (`cancelado` ou
   `tempo_esgotado`); um livro de evidências que numera trechos (`r1`, `r2`…).
5. **Atalhos sem modelo**: pedido de documento sem tipo vira pergunta de tipo
   (`pedeDocumentoSemTipo`); um especialista **indicado** pelas palavras do pedido
   (`roteamento.ts`, regex em ordem) recebe a **delegação direta**, poupando o
   turno do Taq. Se ele não serviu (indisponível, falhou sem resposta, ou não achou
   o alvo e nada fez), segue o ciclo normal.
6. **Ciclo** (`runtime.ts`, `executarCiclo`): manda ao modelo instruções
   (`taq-v7`), contexto inicial magro, histórico e declarações das ferramentas
   autorizadas; o modelo responde ou pede ferramentas; cada chamada é conferida
   (oferecida? efeito permitido? argumentos válidos? orçamento? repetição? limite
   por ferramenta?) e executada ou recusada com erro estruturado que volta ao
   modelo como dado. Repete até resposta final, limite, cancelamento, tempo ou
   falha.
7. **Fim**: a resposta passa por `conferirCitacoes` (referência inexistente, fonte
   que sumiu ou trecho ausente vira `[fonte não verificada]` mais uma limitação).
   Documentos, operações, cartões e escritas do resultado vêm das **ferramentas**,
   nunca do texto do modelo.
8. **Registro e memória**: `taq:execucoes` (últimas 50, sem conteúdo) e a memória
   da conversa (`lembrarRegistros`). A resposta é gravada na conversa; se a
   execução parou mas uma ferramenta já agiu, grava só o que foi confirmado.

### Limites (`LIMITES_PADRAO`, `contratos.ts`)

8 passos; 16 chamadas de ferramenta; 120 s; 120 mil caracteres de contexto; 12 mil
por resultado de ferramenta; 2048 tokens de saída; profundidade de delegação 1;
2 novas tentativas, só para falha transitória do **modelo** (ferramenta nunca é
repetida). Se resta um passo ou acabaram as chamadas, o último turno vai sem
ferramentas e a resposta sai `parcial`. Chamada repetida de leitura é recusada;
três repetições encerram (`limite_atingido`). `delegate_task` tem no máximo 4 usos
por execução.

### Garantias do runtime

- Falha do provedor = `falhou`, sem texto inventado.
- Pergunta ao usuário (`ask_user`) encerra a execução; a resposta é a próxima
  mensagem.
- Se o texto diz "registrei/salvei/criei…" e nenhuma escrita foi confirmada, a
  resposta ganha o aviso de que nada foi gravado.
- Especialista com ferramenta obrigatória (`EXIGIDA` em `especialistas.ts`:
  analista salva a análise; passagem salva achado; continuidade registra decisão;
  comunicação e agenda preparam) é **cobrado uma vez** se responder sem usá-la.
- Cota por minuto do provedor: o servidor devolve `esperarMs` e o runtime espera
  dentro do prazo.

## 4. Ferramentas

Todas têm schema zod (valida o argumento e gera o JSON Schema), **efeito**
(`leitura`, `escrita_local`, `interface`), política (repetição, máximo por
execução) e executor. `RegistroDeFerramentas.recortar` entrega ao agente só as que
ele declara **e** cujo efeito o escopo autoriza: o que o modelo não recebe, ele não
pede. Efeito de escrita só é liberado quando **o pedido da pessoa** pede escrita
(regex conservadora em `politica.ts`, `efeitosDoPedido`) ou responde a pergunta do
próprio fluxo. Instrução dentro de transcrição não tem ferramenta para usar.

| Família | Ferramentas | Efeito |
| --- | --- | --- |
| Leitura (`ferramentas.ts`) | `search_records`, `read_meeting`, `read_document`, `read_conversation`, `list_document_types`, `ask_user`, `prepare_external_brief`, `delegate_task` | leitura |
| Documento (`ferramentas.ts`) | `create_document`, `create_custom_document`, `update_document` | escrita local |
| App (`ferramentasDeApp.ts`) | `open_meeting`, `open_document`, `export_transcript`, `download_document` (interface); `rename_meeting`, `delete_meeting`, `restore_meeting`, `delete_conversation`, `add_context_source`, `remove_context_source` (escrita local); `copy_transcript`, `get_app_capabilities`, `get_usage_guide` (leitura) | variado |
| Tela (`capturaDeTela.ts`, registrada em `FERRAMENTAS_DE_TRABALHO`) | `capture_screen` | só prepara o cartão |
| Trabalho (`ferramentasDeTrabalho.ts`) | `save_analysis`, `register_commitments`, `update_commitment`, `link_dependency`, `record_decision`, `save_finding`, `resolve_finding` (escrita local); `read_analysis`, `suggest_commitments`, `list_commitments`, `list_decisions`, `list_findings`, `get_capture_state`, `check_document`, `prepare_message`, `prepare_event`, `review_privacy` (leitura) | variado |
| Externas (`ferramentasDeIntegracao.ts`) | `search_directory`, `list_availability`, `send_email`, `create_event`, `reschedule_event`, `cancel_event` | leitura (só preparam) |

### O que cada família pode e não pode

- **Leitura**: sempre permitida, mas cada id é conferido contra o escopo
  (`fora_do_escopo`); nenhum argumento amplia. Fatias limitadas (fala até 3500
  caracteres, mensagem de conversa até 1500). Resposta antiga do Taq lida em outra
  conversa não é fonte e vem sem `ref`.
- **App**: operam pelos mesmos caminhos da interface. **Apagar reunião** pelo Taq
  não pergunta: grava antes um retrato na **lixeira do Taq** (`lixeira.ts`, 30 dias,
  inclui nota, marcações, prints, briefing, estado, sugestões, vínculos de
  documentos) e a resposta traz **Desfazer** (botão, sem passar pelo modelo). Pela
  tela, apagar continua definitivo. **Apagar conversa** é definitivo (não vai à
  lixeira): nome ambíguo vira pergunta e nada é apagado. Abrir/exportar só são
  oferecidos quando a pessoa pede ação na tela.
- **Trabalho**: registros em `taq:trabalho` (`features/trabalho/store.ts`), com id,
  `chave` de idempotência, `revisao`, evidências copiadas do livro e histórico;
  escrita em transação sob `comTravaLocal`. Travas em código: evidência é `rN` do
  livro; responsável e prazo só entram se aparecem no trecho citado ou no pedido;
  prazo vencido é "a confirmar", nunca atraso; decisão revista mantém a anterior
  como `substituida`; análise declara cobertura contada pelo código.
- **Documento**: só cria quando a pessoa pediu; `create_document` é idempotente
  (`ja_havia_do_mesmo_tipo`, nunca sobrescreve) e `update_document` confere a versão
  (`updatedAt`). Tipo fora do catálogo: `create_custom_document` (documento
  personalizado no padrão CITi); formato que o TaqCiti não gera: texto para levar
  ao Claude (`prepare_external_brief`, nada é enviado).
- **Externas** (só aparecem com a capacidade `available`, conta do CITi conectada,
  `ferramentasDeIntegracaoDisponiveis`): **o modelo só prepara**. A chamada guarda
  um rascunho e mostra um cartão. A execução exige `tarefa.confirmacao` com a
  chave do rascunho, preenchida apenas por `confirmarAcao` a partir de um **clique**,
  sem chamar o modelo, e executa o rascunho guardado. Destinatários vêm do diretório,
  nunca de endereço escrito pelo modelo; idempotência pela chave de conteúdo; tempo
  esgotado é "desconhecido" (não reenvia sozinho); "aceito pelo Google" não é
  "entregue". Doc de integração: `docs/integracoes-google-workspace.md`.
- **Desfazer/confirmação** resumidos: apagar reunião → Desfazer; e-mail/agenda →
  botão no cartão; apagar conversa → sem volta.

## 5. Memória, contexto e economia de contexto

- Contexto inicial **magro** (`contexto.ts`): data, escopo, o que a tela selecionou
  (com trecho), perfil e briefing de condução, retomada, memória, documentos já
  produzidos na conversa (até 5) e **índice** das 8 reuniões e 8 documentos mais
  recentes (título, data, tamanho). Sem transcrição. O conteúdo entra depois, pelas
  ferramentas, em fatias.
- Histórico (`historicoDaConversa`): até 16 mil caracteres, do mais recente para
  trás; remove marcadores `[rN]` antigos; funde mensagens seguidas do mesmo lado.
- **Memória da conversa** (`memoria.ts`): ponteiros (foco e até 8 recentes), sem
  resumo guardado; revalidados a cada execução (apagado/fora do escopo cai,
  renomeado aparece com o nome atual). Ordem para "essa reunião": nomeada na
  mensagem, selecionada na tela, reunião da conversa, foco; ambíguo, pergunta.
- **Contexto escolhido** pela pessoa (`add_context_source`): até 6 fontes
  (`MAX_FONTES_DO_CONTEXTO`), com a versão de quando foram escolhidas; fonte mudada
  é marcada, apagada sai.
- Teto de tamanho: 120 mil caracteres acumulados na execução; 300 mil por turno no
  servidor (`TAQ_MAX_CONTEXTO_CHARS` altera).
- Delegação direta e especialistas determinísticos economizam chamadas ao modelo.

## 6. Subsistemas

Todos moram no navegador; o modelo, quando usado, passa pelo mesmo `POST
/api/taq/turno` com instruções próprias.

- **Acompanhamento** (`features/acompanhamento/juiz.ts`, `acompanhamento-v1`):
  cada reunião tem no máximo **3** acompanhamentos
  (`LIMITE_DE_ACOMPANHAMENTOS_POR_REUNIAO` em `trabalho/store.ts`; só `cancelado`
  libera vaga, itens `concluido` continuam contando). Quem fica nas vagas é decidido
  por um **juiz de IA** (`escolher_acompanhamentos`); o código só aceita ids
  oferecidos, sem passar das vagas nem repetir. Sem julgamento válido, ninguém é
  escolhido (nunca "os três primeiros"). `suggest_commitments` e
  `register_commitments` passam pelo juiz; `registrarCompromissos` reforça o teto.
- **Apoio ao vivo** (`features/apoio/`, `intervencao-v1`): sugestões privadas durante
  a reunião. `gerar.ts` faz uma chamada por avaliação (até 40 falas
  consolidadas; cita falas por número, trecho copiado da transcrição); `politica.ts`
  decide se aparece: no máximo uma na tela, validade em falas, sem repetir ponto,
  intervalo e limite por hora por modo (`discreto`: 150 s e 4/h; `participativo`:
  75 s e 12/h; `sob_demanda` nunca age sozinho), mínimo de 6 falas e 80 palavras para
  avaliar. `laco.ts` junta tudo; as 2 últimas falas esperam consolidar. Sem perfil de
  condução ou em `sob_demanda`, o modelo não é chamado.
- **Calibração** (`features/calibracao/`): `propostas.ts` transforma o feedback da
  pessoa em propostas de ajuste (antes e depois) com limiar mínimo de retornos
  (janela de 10); nada muda sem aprovação. `historico.ts` reproduz uma reunião
  passada por cortes de tempo (passo de 60 s, até 12 avaliações) em id próprio
  `teste:<id>`, sem gravar nada na reunião real.
- **Condução** (`features/conducao/`, `conducao-v1`): perfil de condução e briefing
  por reunião, versionados, com conflito por revisão; `proposta.ts` organiza o texto
  livre num perfil editável (não salva); `retomada.ts` lista combinados em aberto e
  decisões de encontros que a pessoa escolheu por id.
- **Estado dos pontos** (`features/estado/`, `estado-v1`): um estado por ponto
  (`a_esclarecer`, `discutido`, `a_confirmar`, `decidido`, `adiado`), até 10 pontos,
  com fala citada conferida em código (`mesclar`). Só roda por botão (lê as últimas
  60 falas consolidadas). `sintese.ts` monta o fechamento sem chamar modelo;
  `registrar.ts` registra um ponto como acompanhamento (`decidido` ou `a_confirmar`)
  ou como decisão (só `decidido`), por clique, respeitando o teto de 3.
- **Segundo cérebro** é o nome do conjunto condução + apoio + estado + calibração
  (ver `docs/segundo-cerebro.md`).
- Outros: `features/agent/` (atividade do agente para a UI e barramento de escuta),
  `features/annotations/` (notas, marcações, prints, aviso no chat; `vinculos.ts`
  define o que sai junto quando a reunião é apagada: nota, marcações, prints,
  análises, briefing, sugestões, estado; documentos ficam sem o vínculo),
  `features/trabalho/` (registros de trabalho).

## 7. Como o servidor atende o turno

- Rotas: `POST /api/taq/turno` (`server/app/api/taq/turno/route.ts`, `maxDuration`
  60 s) e `GET /api/taq/estado` (pronto? provedor, modelo, versão, política de
  dados, pendências; nunca devolve chave). Ambas exigem o segredo compartilhado
  (`rejectIfUnauthorized`, cabeçalho de chave) e tratam CORS.
- `atenderTurno` (`server/lib/taq/atender.ts`) recusa nesta ordem, do mais barato:
  forma do pedido (400), configuração pendente (503), versão de instruções
  desconhecida (400), política de dados `training` sem `sintetica: true` (403),
  contexto grande demais (413); só então chama o adaptador. Erros mapeados:
  cancelado (499), lentidão (504), cota por dia ou minuto (429, com `esperarMs`),
  sobrecarga (503), falha do provedor (502).
- Configuração (`config.ts`): variável `TAQ_ORQUESTRADOR` no formato
  `provedor:modelo` (padrão `google:gemini-3.5-flash`). O Taq **nunca cai no mock**:
  sem chave, o estado é `configuracao_pendente`. Variáveis: `GOOGLE_API_KEY` ou
  `GROQ_API_KEY` conforme o provedor, `DOCCITI_SHARED_KEY` (segredo da rota),
  `DOCCITI_DATA_POLICY` (`training` bloqueia registro real), `TAQ_MAX_CONTEXTO_CHARS`.
  Na extensão: `VITE_DOCCITI_SERVER_URL` e `VITE_DOCCITI_SHARED_KEY`.
- **Adaptadores de provedor** (`AdaptadorDeTurno`): `gemini.ts` (SDK do Google;
  ferramentas como `functionDeclarations`; devolve `continuacao` opaca com a
  assinatura do raciocínio, que a extensão devolve sem ler) e `groq.ts` (temporário,
  `fetch` direto no formato OpenAI; normaliza citações `【rN】` para `[rN]`; espera
  curta na cota por minuto; falhas de chamada de ferramenta viram transitórias).
- Antes do envio, a política de dados é também checada na extensão: chave de
  treinamento deixa o Taq "pendente" (`verificarTaq`).

## 8. Versionamento de prompts

Instruções são arquivos `.md` em `server/lib/prompts/taq/`, mapeados por nome em
`server/lib/taq/instrucoes.ts` (`ARQUIVO_POR_VERSAO`). **Versão nova é arquivo
novo**, nunca edição no lugar (cada execução registra `instrucoesVersao`). A
extensão pede por nome; servidor sem a versão responde "Versão de instruções
desconhecida".

| Papel | Versão em uso (extensão) | Anteriores no servidor |
| --- | --- | --- |
| Orquestrador | `taq-v7` (`INSTRUCOES_ESPERADAS`) | v1 a v6 |
| documents | `documents-v4` | v1 a v3 |
| app_assistant | `app-assistant-v5` | v1 a v4 |
| communication / scheduling | `communication-v3` / `scheduling-v3` | v1, v2 |
| meeting_copilot | `copilot-v2` | v1 |
| analyst, commitments, continuity, handoff, memory, context | `analyst-v1`, `commitments-v1`, `continuity-v1`, `handoff-v1`, `memory-v1`, `context-v1` | — |
| Subsistemas | `intervencao-v1`, `estado-v1`, `acompanhamento-v1`, `conducao-v1` | — |

**Regra de publicação**: ao subir versão nova de instruções, publicar o servidor
**antes** da extensão. O deploy é manual; o estado atual da publicação: não
verificado.

## 9. Como testar

- Unitários: `npm test` na raiz (Vitest, jsdom, `src/**/*.test.{ts,tsx}`). A rede
  fica desligada por `src/test/semRede.ts`, exceto com `TAQ_LIVE_URL`. No servidor:
  `cd server; npx vitest run lib/taq` (inclui `taq.test.ts` e `groq.test.ts`). Mais:
  `npm run typecheck` e `npm run lint`.
- O modelo roteirizado e o storage em memória (`installChromeStorageMock`) só
  existem nos testes; o runtime, as ferramentas e a política rodam de verdade.
- **Testes `.live.test.ts`** (pulados por padrão) exigem servidor no ar e chave de
  provedor com dado **sintético**: `taq.live`, `trabalho.live`, `copiloto.live`
  (em `taq/`), `apoio.live`, `estado.live`, `juiz.live`, `historico.live`. Roteiro:

```powershell
cd server; npx next build; npx next start -p 3100     # outro terminal
$env:TAQ_LIVE_URL = 'http://localhost:3100'
$env:TAQ_LIVE_KEY = '<segredo compartilhado do servidor>'
npx vitest run src/features/taq/taq.live.test.ts
```

  O adaptador declara `sintetica: true`, só nesses testes. Asserções conferem o que
  o código garante; o texto do modelo é impresso para leitura humana. Reiniciar o
  servidor após mudar prompts ou código dele.
- Verificação visual: scripts `scripts/verify-*.cjs` (não verificados aqui).
