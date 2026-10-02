# Taq — relatório de progresso e matriz de cobertura

Atualizado em 01/10/2026. Arquitetura e contratos: `docs/taq-agentes.md`.
Ajuda: `docs/ajuda-do-taqciti.md`.

## Onde estamos

| Incremento | Estado | Evidência |
| --- | --- | --- |
| 1. Inventário e base | feito (antes desta rodada) | contratos zod, catálogo, política, `taq:execucoes` |
| 2. Orquestrador e operações | feito (antes) | `app_assistant`, lixeira, exclusão de conversa |
| 3. Memória e contexto | feito (antes) + `organizational_memory` e `context` ativos | `memoria.test.ts`, `trabalho.test.ts` |
| 4. Análise e documentos | feito | `meeting_analyst`, `quality_review`, `evidence_verifier`, `documents-v3` |
| 5. Continuidade do trabalho | feito | `taq:trabalho`, `commitments`, `continuity`, `handoff_analysis` |
| 6. Comunicação e agenda | feito **sem integração** (ver bloqueios) | rascunho + mailto; sugestão + link do Google Agenda |
| 7. Reunião ao vivo | parcial | `capture_monitor` e `meeting_copilot` sob pedido; sem sugestão automática |
| 8. Integração final | parcial | verificação visual feita; validação ao vivo limitada pela cota |

## Matriz por capacidade

Legenda: **impl.** implementada · **conf.** configurada/executável nesta build ·
**local** testes com storage real e modelo roteirizado · **real** validada com
o provedor de verdade (dados sintéticos).

| Capacidade | impl. | conf. | local | real | Bloqueio / próximo passo |
| --- | --- | --- | --- | --- | --- |
| orchestrator (`taq-v7`) | sim | sim | sim | sim (delegações abaixo) | — |
| app_assistant | sim | sim | sim | sim (23/09, Groq) | — |
| documents (`documents-v3`) | sim | sim | sim | sim na v2; v3 só local | rodar `taq.live.test.ts` na v3 |
| organizational_memory | sim | sim | via roteiro de orquestração | não | caso ao vivo |
| context | sim | sim | via roteiro | não | caso ao vivo |
| meeting_analyst | sim | sim | sim | ver "Validação ao vivo" | — |
| evidence_verifier | sim (determinístico) | sim | sim | n/a (sem modelo) | julgamento semântico não implementado |
| commitments | sim | sim | sim | ver abaixo | — |
| continuity | sim | sim | via roteiro | ver abaixo | — |
| handoff_analysis | sim | sim | via roteiro | ver abaixo | — |
| communication | sim (rascunho) | sim | sim | **sim** (rascunho, nada enviado) | envio: sem integração (decisão de produto + OAuth) |
| scheduling | sim (sugestão) | sim | sim | ver abaixo | calendário: sem integração |
| quality_review | sim (determinístico) | sim | sim | n/a | — |
| meeting_copilot | sim (sob pedido) | sim | só catálogo | não | sugestões proativas não implementadas |
| capture_monitor | sim (determinístico) | sim | sim | n/a | — |
| privacy_review | sim (determinístico) | sim | sim | n/a | detecção por formato, não por contexto |

## Validação ao vivo (provedor real, conjunto "Demonstração" sintético)

`src/features/taq/trabalho.live.test.ts`, servidor local (`next start`),
Gemini `gemini-3.5-flash` com chave free tier (`DOCCITI_DATA_POLICY=training`,
por isso só dados sintéticos).

Rodada 1 (sem pausa): passaram **sugerir compromissos** (o especialista errou o
id da reunião, recuperou pela busca, errou os argumentos uma vez e acertou na
segunda) e **rascunho de e-mail** (cartão gerado, nada dito como enviado). Os
outros sete casos falharam por `limite_do_provedor` (cota) ou
`provedor_sobrecarregado` — não por código.

A tentativa com Groq falhou: a `GROQ_API_KEY` do `server/.env.local` está
inválida.

Rodada 2 (Gemini, 60 s entre casos): todos os casos falharam na primeira
chamada com "A cota diária do provedor acabou. Ela reabre amanhã." A
validação ao vivo de registrar compromissos, analisar, comparar fontes,
decisão revista, horário e captura **continua pendente** — rodar de novo
quando a cota reabrir (comando em "Como retomar").

### Rodada com Groq (`openai/gpt-oss-120b`, 01/10/2026, a pedido)

`TAQ_ORQUESTRADOR=groq:openai/gpt-oss-120b` no `server/.env.local` (a chave
antiga estava revogada; uma nova foi configurada).

- **Passaram:** registrar compromissos (a 2ª chamada registrou 1 compromisso,
  com responsável e prazo que estão na fala, e deixou "critérios de aceite"
  sem dono — como deve). O Taq respondeu sozinho "organizar os próximos passos"
  e "analisar", sem delegar (análise não salva).
- **Erros de roteamento achados ao vivo e corrigidos:** "registre os próximos
  passos" e "registre a decisão" iam para o especialista de documentos. Causa:
  o contexto anunciava `create_document` em todo pedido de escrita. Agora só
  quando a pessoa fala de documento, e uma dica em código
  (`roteamento.ts`, `Especialista indicado para este pedido`) aponta o
  especialista do assunto; `taq-v7` manda segui-la.
- **Recusas do Groq transformadas em tentativa:** "tool call validation
  failed" e "tool choice is none" derrubavam a delegação; agora voltam como
  transitórias (`ErroDeChamadaDoModelo`).
- **Cota:** a cota por minuto (8 mil tokens) estoura em quase toda jornada;
  o servidor passa `esperarMs` e o runtime espera o tempo pedido, dentro do
  prazo. No fim da rodada a cota **diária** do Groq também acabou.
- **Pendentes ao vivo** (reabrir amanhã): comparar fontes, decisão revista,
  rascunho, horário e captura com as correções acima.

### Rodada com Groq `openai/gpt-oss-20b` (01/10/2026, noite)

A cota diária do `gpt-oss-120b` acabou; o Groq tem cota separada por modelo,
e o 20b também chama ferramentas. Modelo menor: vale como evidência do FLUXO
(roteamento, ferramentas, travas), não da qualidade final do texto.

- **Passaram ao vivo, com as correções de roteamento:** sugerir compromissos
  (cartão de sugestões, nada gravado), registrar compromissos (gravados com
  fonte, sem dono inventado; Taq → `commitments`) e analisar a reunião
  (Taq → `meeting_analyst`, análise salva com cobertura).
- **Achado grave, corrigido em código:** em "decisão revista" o especialista
  respondeu "**Decisão nova registrada**" sem chamar `record_decision` —
  nada foi gravado. O runtime agora conta as escritas que as ferramentas
  confirmaram (inclusive as dos especialistas, em `escritas`) e, se o texto
  afirma ter registrado/salvo/criado sem nenhuma escrita confirmada, acrescenta
  "nada foi gravado nesta execução" e uma limitação.
- **Outros corrigidos:** id com o prefixo do índice ("reuniao demo-produto")
  passa a ser aceito (`limparId`); "Failed to parse tool call arguments as
  JSON" do Groq volta como transitório.
- **Pendentes ao vivo:** comparar fontes (estourou o tempo após a recusa do
  Groq, já tratada), decisão revista com a nova trava, rascunho, horário e
  captura — a cota diária do 20b também acabou no fim.

### Rodada de 02/10/2026 — delegação direta (Groq `gpt-oss-20b`)

Com a delegação direta (`b6ab9ca`), **os 9 pedidos da demonstração foram
para o especialista certo sem passar pelo turno do Taq** (compromissos ×3,
analista, passagem, continuidade, comunicação, agenda, captura). A captura
respondeu em 1 ms, sem chamada ao modelo, achando a reunião pelo título dito.
Os demais casos pararam na cota: a do Groq é de **200 mil tokens por dia por
modelo, em janela móvel de 24 h** (mensagem do provedor: "Limit 200000, Used
197434… try again in 18m"), e as rodadas de ontem ainda ocupam a janela.

**Para fechar a validação ao vivo** é preciso cota: esperar a janela liberar
(as rodadas de ontem saem dela à noite), ou o Dev Tier do Groq, ou uma chave
Gemini paga com política privada.

### Rodada de 03/10/2026 — cotas livres (Groq `gpt-oss-120b`, depois `gpt-oss-20b`)

| Jornada | Resultado ao vivo |
| --- | --- |
| Sugerir compromissos | ✓ (120b e 20b) — cartão de sugestões, nada gravado, "critérios de aceite" sem dono |
| Registrar compromissos | ✓ (120b e 20b) — gravados com fonte, dono só onde a fala atribui |
| Registrar de novo | ✓ no teste, mas o 120b **duplicou** um compromisso com outras palavras → corrigido: mesma fala da mesma reunião é o mesmo compromisso |
| Analisar | ✓ no 120b (salvou, cobertura 3/3); ✗ no 20b (respondeu sem salvar) → corrigido: ferramenta exigida por especialista, cobrada uma vez pelo runtime |
| Comparar fontes | ✓ (120b e 20b) — achados com as duas fontes; o 120b registrou um segundo achado (prazo) que parece complementar, não desalinhamento |
| Decisão revista | ✓ (20b) — `record_decision` + `resolve_finding`, achado resolvido com histórico |
| Rascunho | ✓ no dia 1 (Gemini); hoje parou na cota |
| Horário | **não validado ao vivo** — cota acabou nas duas rodadas |
| Captura | ✓ (3–4 ms, sem modelo) |

As duas cotas diárias do Groq (200 mil tokens por modelo) acabaram de novo.

## Verificação visual

`scripts/verify-trabalho.cjs` (Edge, perfil isolado, dados `[TESTE]`, sem IA)
→ `docs/verification/trabalho/`: cartões na HOME e na sidebar, página
Acompanhamento, painel "O que o Taq faz", HOME a 390 px sem rolagem lateral,
concluir compromisso persiste ao recarregar, resolver achado com motivo, link
de agenda sem convidados, nenhum botão "Enviar"/"Agendar".

## Bloqueios e pendências concretas

1. **Cota do provedor.** A chave atual é free tier e de treinamento: registros
   reais não vão ao modelo, e as jornadas longas batem na cota. Para usar de
   verdade: chave com política privada (remover `DOCCITI_DATA_POLICY`).
2. **Deploy.** A extensão desta build pede `taq-v7`; o servidor da Vercel
   ainda tem `taq-v6` até o próximo deploy manual. Até lá, o Taq em produção
   responde com as instruções antigas (e sem as novas versões, os especialistas
   novos recebem erro de versão desconhecida).
3. **Envio de e-mail e calendário.** Não implementados de propósito: exigem
   OAuth com escopos de Gmail/Calendar e decisão sobre autorização por envio.
   O que existe é rascunho copiável/mailto e link do formulário do Google
   Agenda, sem convidados. O painel diz "Não disponível nesta versão".
4. **Copiloto proativo.** Só sob pedido. Sugestão automática exigiria debounce
   sobre os segmentos ao vivo e orçamento próprio.
5. **Verificador semântico.** O `evidence_verifier` confere existência e
   trecho; "a frase interpreta bem o trecho" não é avaliado.
6. **Backup.** Não há backup/restauração nesta extensão; `taq:trabalho` segue a
   mesma situação das outras chaves locais.

## Como retomar

```powershell
npm test; npx tsc --noEmit; npx eslint src
cd server; npx vitest run lib/taq
# ao vivo (dados sintéticos):
cd server; npx next build; npx next start -p 3100
$env:TAQ_LIVE_URL='http://localhost:3100'; $env:TAQ_LIVE_KEY='<DOCCITI_SHARED_KEY>'; $env:TAQ_LIVE_PAUSA_MS='60000'
npx vitest run src/features/taq/trabalho.live.test.ts
# tela:
npx vite build --mode development --outDir $env:TEMP\taqciti-verify-dev
node scripts/verify-trabalho.cjs <playwright-core> $env:TEMP\taqciti-verify-dev
```
