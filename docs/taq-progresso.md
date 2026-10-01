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
