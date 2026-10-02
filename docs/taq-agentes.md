# Taq — a arquitetura de agentes do TaqCiti

A interface tem um assistente só: o **Taq**. Internamente ele é um
**orquestrador** que usa ferramentas sobre os registros locais e delega a
**especialistas**. Os **15 especialistas do catálogo estão ativos** (ver
"Especialistas de trabalho", abaixo): 11 de modelo, com instruções próprias, e
4 determinísticos, que respondem sem chamar modelo. Progresso e matriz de
cobertura: `docs/taq-progresso.md`.

## Fronteira de execução

```
 extensão (HOME / sidebar)                              servidor Next.js (server/)
 ──────────────────────────────────────────           ─────────────────────────────
 InterfaceAdapter  features/taq/interface.ts
   └ Orchestrator  features/taq/orquestrador.ts
       ├ AgentRegistry   registroDeAgentes.ts + catalogo.ts
       ├ ToolRegistry    registroDeFerramentas.ts + ferramentas.ts
       ├ AgentRuntime    runtime.ts (ciclo, limites, cancelamento, delegação)
       ├ ContextService  contexto.ts + busca.ts + evidencias.ts
       ├ PolicyService   politica.ts (escopo e efeitos, em código)
       ├ StorageAdapter  armazenamento.ts ─► chrome.storage.local (registros)
       └ ModelAdapter    modelo.ts ── POST /api/taq/turno ──► lib/taq/atender.ts
                                     GET  /api/taq/estado      └ gemini.ts ─► provedor
```

- **Os registros ficam na extensão.** O servidor não acessa o
  `chrome.storage.local`, e o Taq funciona sem sincronização. O **ciclo do
  agente roda na extensão**: as ferramentas leem e gravam localmente.
- **O servidor só fala com o provedor.** Cada `POST /api/taq/turno` é **uma**
  chamada ao modelo, com as mensagens e as declarações das ferramentas que a
  extensão autorizou. A chave do provedor e as **instruções versionadas**
  (`server/lib/prompts/taq/`) ficam no servidor, então nenhuma chave vai
  para o bundle (conferido: zero ocorrências em `dist/`).
- **O que sai do computador:** a mensagem, um índice magro (títulos e datas) e
  os **trechos** que as ferramentas devolveram, em fatias limitadas. Guardar
  localmente não é o mesmo que processar localmente, e a interface diz isso.

## Contratos (`features/taq/contratos.ts`, zod em runtime)

| Contrato | Onde |
| --- | --- |
| `AgentDefinition` | `fichaDeAgenteSchema` + `DefinicaoDeAgente` (schemas de entrada e saída, executor). `available` exige executor, e o registro recusa o contrário |
| `AgentTask` | `tarefaSchema`: execução, tarefa, conversa, agente, objetivo, entrada, selecionados, escopo, limites, sinal, `tarefaSuperiorId`, profundidade, `continua` |
| `AgentResult` | `resultadoDoAgenteSchema`: estado, resposta/saída, evidências, documentos, ausentes, limitações, erros, métricas, pergunta, texto copiável |
| `EvidenceReference` | `referenciaDeEvidenciaSchema`: tipo, id, versão, trecho, local (segmento, offsetMs, captionId, intervalo), `sustenta` |
| `ToolDefinition` | `DefinicaoDeFerramenta`: schema zod (valida o argumento do modelo **e** gera o JSON Schema), efeito, requisitos, política, executor, `ErroDeFerramenta` |

## Ferramentas

| Ferramenta | Efeito | O que faz |
| --- | --- | --- |
| `search_records` | leitura | busca textual (sem acento/caixa) e filtros de tipo/data, paginada; até 10 registros × 3 trechos; com tipo `conversa`, também nas outras conversas (sem `ref`, dizendo quem escreveu) |
| `read_meeting` | leitura | metadados e fatia de até 40 segmentos, ou só os que contêm um termo |
| `read_document` | leitura | fatia de até 6000 caracteres e a `versao` |
| `read_conversation` | leitura | fatia de até 20 mensagens de outra conversa do escopo; cada uma diz se foi a pessoa ou uma resposta anterior do Taq (que não é fonte) |
| `list_document_types` | leitura | o catálogo de documentos |
| `ask_user` | leitura | pergunta à pessoa e encerra o turno; opções clicáveis vindas do catálogo ou dos registros |
| `prepare_external_brief` | leitura | texto para copiar e levar ao Claude (nada é enviado) |
| `create_document` | escrita local | aplica o modelo do catálogo; idempotente; vinculado à reunião e à conversa |
| `update_document` | escrita local | edição com verificação de versão (`updatedAt`) |
| `delegate_task` | leitura | só existe quando há especialista **disponível** |

Não há ferramenta de arquivo, SQL, rede ou código.

## Memória e contexto (`features/taq/memoria.ts`)

Memória é **recuperação** do que está guardado, e não treino nem conhecimento
de tudo que existe no computador. Duas partes:

- **Os registros** (reuniões, documentos, conversas), lidos pelas ferramentas
  acima, em fatias e com escopo conferido em cada chamada.
- **A memória da conversa** (`Conversation.memoria`): ponteiros (tipo, id,
  título) para o **foco** (o último registro usado) e os 8 usados mais
  recentemente. `perguntarAoTaq` grava a memória depois de cada resposta, a
  partir das fontes citadas, dos documentos produzidos e dos registros abertos
  (`registrosUsados`). Fica no storage, então fechar e reabrir a conversa a
  preserva.

Não há resumo guardado, só ponteiros: o conteúdo continua no registro. Cada
ponteiro é **revalidado** a cada execução (`revalidarMemoria`). Registro
apagado ou fora do escopo cai; registro renomeado aparece com o nome atual.

**Qual registro é "essa reunião"**, em ordem:

1. o que a pessoa nomeou;
2. o que a tela selecionou (`selecionados`);
3. a reunião da conversa (o escopo da sidebar);
4. o foco (`tarefa.foco`).

O contexto inicial rotula cada um separadamente ("selecionados NA TELA", "EM
FOCO", "usado antes"). `create_document` e as operações do `app_assistant`
usam o foco quando nada acima resolve. Na ambiguidade entre registros
parecidos, o Taq pergunta (`ask_user`, `escolha_de_registro`); não escolhe em
silêncio.

**Respostas antigas do Taq não são fonte.** Nas outras conversas, os trechos
dizem quem escreveu e não têm `ref`: o que se afirma precisa vir da reunião ou
do documento, citado. Instruções: `taq-v6`.

## Apagar conversas

A tela e o Taq usam a mesma operação, `apagarConversas`
(`home/conversations.ts`):

| Sai | Fica |
| --- | --- |
| a conversa, as mensagens e a memória dela | as reuniões |
| o registro das execuções que rodaram nela (`taq:execucoes`) | os documentos: o gerado nela perde só o `conversationId` (`desvincularDaConversa`) |

É definitivo, sem lixeira. O Taq apaga pelo `delete_conversation`
(`app_assistant`, `app-assistant-v4`):

- **Resolução:** o id, `"atual"` para esta conversa, ou o nome, sempre para um
  id real.
- **Nome ambíguo:** a ferramenta pergunta qual e não apaga nenhuma, nem as que
  estavam claras.
- **"As que selecionei":** recusado, porque a tela não tem seleção de
  conversas.
- **Confirmação:** o pedido claro já é a autorização, sem pergunta extra. A
  operação só é dada como feita com o sucesso da gravação.

**Consistência.** Quando a conversa aberta some (apagada nesta tela, noutra aba
ou pelo próprio Taq), a HOME e a sidebar vão para o estado de conversa nova com
o aviso "A conversa foi apagada. Reuniões e documentos continuam guardados."
(`useConversaAberta`), e nunca passam a mostrar outra conversa em silêncio. A
execução do Taq em curso nela é cancelada (`perguntarAoTaq` observa o storage).
Uma resposta tardia não recria nada, porque `acrescentarResposta` e
`lembrarRegistros` não escrevem em conversa inexistente. A conversa apagada
sai da busca, da leitura e da memória, que só leem o storage.

## Segurança e limites

- **Escopo:** conversa nascida de uma reunião enxerga só aquela reunião e os
  documentos ligados a ela. A HOME enxerga tudo o que está neste computador.
  Cada id é conferido pela ferramenta, e nenhum argumento amplia o escopo.
- **Efeitos:** as ferramentas de escrita só são oferecidas quando **o pedido
  da pessoa** pede escrita, ou quando a mensagem responde a uma pergunta do
  próprio fluxo de documento. Instrução dentro de transcrição não tem
  ferramenta para usar.
- **Limites** (`LIMITES_PADRAO`): 8 passos, 16 chamadas de ferramenta, 120 s,
  120 mil caracteres de contexto, 12 mil por resultado, 2048 tokens de saída,
  profundidade de delegação 1, 2 novas tentativas **só** em falha transitória
  do modelo (escrita nunca é repetida). No último passo o modelo recebe o turno
  sem ferramentas, e a resposta sai marcada como `parcial`. Chamadas repetidas
  são recusadas, e três repetições encerram a execução.
- **Citações:** o modelo cita `[rN]` e o runtime confere se a referência existe,
  se o registro existe e se o trecho está no local citado. Referência que não
  passa vira `[fonte não verificada]`. Isso **não** garante que a interpretação
  esteja certa, por isso cada fonte abre a origem.
- **Registro da execução:** `taq:execucoes` (últimas 50) guarda ids,
  ferramentas, duração, resumos de uma linha, falhas e consumo. Não guarda
  conteúdo, pergunta, resposta, raciocínio nem segredo.

## Documentos

O catálogo é **`src/features/documents/catalogo.ts`**, com **Ata de Reunião** e
**Doc Conversa (X1)**, os dois tipos com modelo de verdade no servidor. O teste
`server/lib/templates/catalogo.test.ts` falha se o catálogo divergir de
`server/lib/templates`. A tela "Gerar documento" e o Taq leem dali.

Fluxo: lê a reunião (a dita, a da conversa ou a mais recente) → aplica o modelo
do tipo pedido (ou do inferido, sem perguntar). O `create_document` monta as
seções na ordem do catálogo, com "A confirmar" nas obrigatórias vazias e nos
campos indispensáveis ausentes, "Não informado" nos demais, lista de pendências e
fontes numeradas → salva como rascunho para revisão. O que só a pessoa sabe o Taq
pergunta na conversa, depois. Compartilhar é outra ação.

Fora do catálogo (relatório, slides, e-mail…): o `create_document` recusa com
`tipo_fora_do_catalogo`, e o Taq explica e oferece um texto para levar ao
Claude. Não é uma integração.

## Mínimo de intervenção

O fluxo não para para perguntar o que dá para decidir com um padrão razoável.
O Taq faz e diz o que assumiu:

| Situação | O que acontece |
| --- | --- |
| Tipo de documento não dito | X1 se a reunião parece 1:1/entrevista (≤ 2 falantes, ou "1:1"/"x1"/"entrevista" no título); Ata no resto |
| Reunião não dita | a da conversa; senão a mais recente |
| Campo indispensável (ex.: projeto da Ata) | o documento sai com "A confirmar"; **depois de salvo**, o Taq pergunta na conversa, e a resposta vira `update_document` |
| Tela "Gerar documento" | salva direto, com "[A preencher]"; as perguntas da geração vão para uma conversa nova com o Taq (`abrirConversaDoTaq`), sem formulário |
| Nome casa com vários registros | age no mais recente e devolve `tambem_casavam` |
| Apagar reunião pelo Taq | sem confirmação: vai para a lixeira do Taq (`taq:lixeira`, 30 dias) e a resposta traz **Desfazer** |
| Pedido fora do catálogo | já entrega o texto para copiar e levar ao Claude |

Os especialistas não têm `ask_user`: quem pergunta, quando precisa, é o Taq, na
conversa. As instruções são `taq-v6`, `documents-v2` e `app-assistant-v4`.

**Lixeira** (`features/taq/lixeira.ts`): antes do `ui/history/delete`, guarda o
registro, a nota, as marcações, os prints e quais documentos perdem o vínculo.
É o inverso exato de `limparVinculosDaReuniao`. Desfazer
(`restore_meeting`, ou o botão, que não passa pelo modelo) devolve o registro
pelo background (`ui/history/restore`) e o resto sob as mesmas travas. Pela
**tela**, apagar continua definitivo, como antes.
## Especialistas ativos

Os dois usam o mesmo ciclo do runtime, com instruções próprias no servidor
(`documents-v2` e `app-assistant-v4`, em `server/lib/prompts/taq/`) e as
ferramentas que o catálogo declara para eles (`features/taq/especialistas.ts`).
O Taq (`taq-v6`) responde sozinho sobre o **conteúdo** dos registros e delega o
resto. Quando o especialista já deu a resposta, ela vai direto para a pessoa,
sem outra chamada ao modelo. Documentos, operações, perguntas e textos copiáveis
do especialista viram resultado da execução inteira.

**Delegação:** o filho recebe as ferramentas que ele declara, recortadas pelo
**escopo e pelos efeitos** do pai (o mesmo objeto), além do orçamento, do livro
de evidências e do histórico. Delegar nunca amplia permissão. As regras que
dependem do que a pessoa pediu leem `tarefa.pedidoOriginal`, nunca o
`objetivo` escrito pelo modelo ao delegar.

### `app_assistant` — operações e ajuda (`ferramentasDeApp.ts`, `ajuda.ts`)

| Ferramenta | Efeito | Reaproveita |
| --- | --- | --- |
| `open_meeting` / `open_document` | interface | navegação da HOME; `ui/openHome` na sidebar |
| `rename_meeting` | escrita local | `ui/history/rename` |
| `delete_meeting` / `restore_meeting` | escrita local | `ui/history/delete` com a lixeira do Taq; `ui/history/restore` para desfazer |
| `delete_conversation` | escrita local | `apagarConversas`, a mesma exclusão da tela (ver "Apagar conversas") |
| `export_transcript` | interface | `downloadTranscript` ("Baixar .txt") |
| `get_app_capabilities` | leitura | a referência `ajuda.ts`, cruzada com o registro de ferramentas |
| `get_usage_guide` | leitura | os passos verificados de `ajuda.ts` |

- **Alvo:** id, "atual", "ultima" ou nome, resolvidos em código; vários casando,
  vence o mais recente (ver acima).
- **Apagar:** sem confirmação, com lixeira de 30 dias e Desfazer (ver acima).
- **Efeitos:** abrir e exportar só são oferecidos quando a pessoa pede uma ação
  na tela; apagar e renomear, só quando ela pede a operação.
- **Ajuda:** a referência verificada de `ajuda.ts` — funcionalidades da tela,
  operações do agente (tiradas do registro de ferramentas) e o que é planejado
  ou inexistente. Instruções `app-assistant-v4`; o Taq (`taq-v6`) também
  consulta a referência se a delegação falhar. Ver `docs/ajuda-do-taqciti.md`.

### `documents`

É o fluxo do catálogo descrito acima, agora conduzido pelo especialista. Quando
ele está ativo, o Taq não tem `create_document`: tem só a delegação.

## Especialistas de trabalho

| Especialista | Tipo | Instruções | Ferramentas próprias |
| --- | --- | --- | --- |
| `meeting_analyst` | modelo | `analyst-v1` | `read_analysis`, `save_analysis`, `get_capture_state` |
| `commitments` | modelo | `commitments-v1` | `list_commitments`, `suggest_commitments`, `register_commitments`, `update_commitment`, `link_dependency` |
| `continuity` | modelo | `continuity-v1` | `list_decisions`, `record_decision`, `list_findings`, `resolve_finding` |
| `handoff_analysis` | modelo | `handoff-v1` | `save_finding`, `list_findings`, `resolve_finding` |
| `communication` | modelo | `communication-v1` | `prepare_message` (só rascunho) |
| `scheduling` | modelo | `scheduling-v1` | `prepare_event` (só sugestão) |
| `organizational_memory` | modelo | `memory-v1` | leitura + `list_decisions` |
| `context` | modelo | `context-v1` | leitura + compromissos, decisões, achados, análise |
| `meeting_copilot` | modelo | `copilot-v1` | `read_meeting`, `get_capture_state`, `list_decisions` |
| `capture_monitor` | determinístico | — | `get_capture_state` (`captura.ts`) |
| `quality_review` | determinístico | — | `check_document` (`revisao.ts`, parte de forma) |
| `evidence_verifier` | determinístico | — | `check_document` (`revisao.ts`, parte de fontes) |
| `privacy_review` | determinístico | — | `review_privacy` (`privacidade.ts`) |

**Registros** (`features/trabalho/store.ts`, chave `taq:trabalho`): compromissos,
decisões, achados e análises. Cada um tem id, `chave` de idempotência,
`revisao`, evidências (registro, versão, trecho, segmento — copiadas do livro da
execução, nunca do texto do modelo) e histórico com a origem de cada mudança.
Toda escrita é transação sob `comTravaLocal`; edição confere a revisão.

**Travas em código** (`ferramentasDeTrabalho.ts`):

- evidência é `rN` do livro desta execução; `rN` desconhecido é recusado;
- responsável e prazo só entram se aparecem no trecho citado, em quem o falou
  ou no pedido da pessoa; senão viram `null` e o descarte é dito;
- item cuja fonte está fora do escopo não aparece em lista, contagem ou cartão;
- decisão revista exige decisão confirmada e mantém a anterior como
  `substituida`, ligada e com motivo; dependência não fecha ciclo;
- prazo vencido é `prazo_passou_a_confirmar`, nunca atraso;
- análise: cobertura contada pelos segmentos que o livro registrou; item sem
  fonte recusado; capturas com ressalva entram como lacuna;
- rascunho: endereço só se a pessoa o escreveu; nome com mais de um
  participante vira `ambiguo`; alerta de dado sensível. Nada é enviado;
- horário: data/hora local convertida no fuso de quem usa por `Intl`; horário
  passado recusado; o link do Google Agenda não leva convidados.

**Cartões** (`cartaoSchema` em `contratos.ts`; `shared/ui/CartoesDoTaq.tsx`):
só ferramentas os produzem (`registrarCartao`), o runtime valida, a delegação
os propaga e a resposta os guarda (`ConversationMessage.cartoes`). Os de
registro levam só ids e são desenhados do storage no estado atual. Botões:
concluir/reabrir, registrar selecionados, resolver/descartar/reabrir com
motivo, corrigir item da análise, editar/copiar rascunho, abrir no e-mail,
abrir no Google Agenda. A HOME tem a página **Acompanhamento** com os mesmos
itens, e **Conexões → O que o Taq faz** lista o estado de cada capacidade a
partir do mesmo registro do orquestrador.

**Exclusões:** apagar a reunião leva só as análises dela (a lixeira do Taq as
guarda e devolve); compromissos, decisões e achados ficam com a origem
"indisponível". Apagar a conversa leva o rascunho, que mora na mensagem.
### Adicionar um especialista

```ts
const agentes = criarRegistroPadrao();
agentes.ativar('meeting_analyst', async (tarefa, ambiente) => {
  // ambiente.ferramentas: o que ele declara, recortado pelo escopo/efeitos do pai
  // ambiente.orcamento / ambiente.livro: compartilhados com a execução principal
  return executarCiclo(tarefa, ambiente, { instrucoes: 'taq-analista-v1', contexto: '', historico: [] });
  // ou um resultado determinístico — desde que cumpra resultadoDoAgenteSchema
  // e o schemaDeSaida do agente, senão a delegação o recusa.
}, 'taq-analista-v1');
const taq = criarOrquestrador({ modelo, armazenamento, agentes });
```

A partir daí, `delegate_task` aparece para o modelo, listando só esse
especialista. Um agente `planned` chamado por id devolve
`agente_indisponivel`, nunca um resultado fictício.

## Configurar e rodar

Servidor (`server/.env.local`): `GOOGLE_API_KEY`, `DOCCITI_SHARED_KEY` e,
opcionalmente, `TAQ_ORQUESTRADOR=google:<modelo>` (padrão `gemini-3.5-flash`,
disponível na chave do projeto em 22/09/2026). Extensão: `VITE_DOCCITI_SERVER_URL`
e `VITE_DOCCITI_SHARED_KEY` apontando para o mesmo servidor.

> **Estado atual da chave:** `DOCCITI_DATA_POLICY=training` (free tier). Com
> ela, o Taq aparece como **configuração pendente** para registros reais, pela
> mesma regra das rotas de geração. Para usar de verdade: chave com política
> privada, removendo a linha `DOCCITI_DATA_POLICY`.

Testes: `npm test` (extensão) e `cd server; npx vitest run`. O modelo
roteirizado só existe nos testes. Teste ao vivo, com reuniões **sintéticas**:

```powershell
cd server; npx next build; npx next start -p 3100   # outro terminal
$env:TAQ_LIVE_URL='http://localhost:3100'; $env:TAQ_LIVE_KEY='<DOCCITI_SHARED_KEY>'
npx vitest run src/features/taq/taq.live.test.ts
```

## Limitações conhecidas

- A execução pertence à página que a iniciou: fechar a HOME cancela, e a outra
  superfície não vê o progresso (só o resultado gravado).
- A detecção de pedido de escrita é por palavras e conservadora. Na dúvida,
  não oferece escrita.
- O free tier do Gemini variou de 12 s a mais de 50 s por chamada nas rodadas
  medidas, e execuções longas estouram os 120 s. O runtime encerra como
  `tempo_esgotado`, sem inventar resposta.
- Sem streaming da resposta.
