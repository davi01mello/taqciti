# TaqCiti como segundo cérebro para conduzir reuniões

Estado em 08/10/2026. Este documento descreve o que foi implementado do plano
"segundo cérebro para condução de reuniões", onde está, como verificar e o que
ainda **não** está feito ou validado. Não repete o plano: diz o que existe.

## Princípio que atravessa tudo

O modelo **propõe**; o **código** decide e confere; a **pessoa** autoriza. Nada
muda sozinho, e o que o modelo cita (uma fala) é verificado contra a transcrição
em código.

## O que existe

| Parte | Onde | O que faz |
| --- | --- | --- |
| Perfil de condução | `src/features/conducao/store.ts` | Como a pessoa quer ser ajudada (missão, o que observar, modo, preferências). Versionado, com conflito por revisão e histórico. |
| Briefing da reunião | idem | Objetivo (só o que a pessoa escreveu), contexto, o que não pode ficar sem encaminhamento, encontros a retomar, modo só para essa reunião. A reunião guarda **uma cópia** do perfil de quando foi preparada. |
| Proposta de perfil | `conducao/proposta.ts`, prompt `conducao-v1` | O modelo organiza o texto livre da pessoa num resumo editável. Não salva. |
| Tela "Preparar" | `src/home/Preparar.tsx` | Perfil, briefing, retomada, modo por reunião, ajustes sugeridos, custo medido, teste histórico. O resumo também se escreve à mão. |
| Retomada | `conducao/retomada.ts` | Combinados em aberto e decisões dos encontros que a pessoa **escolheu** (por id), com data, "sem atualização registrada" e nunca "atrasado". |
| Estado dos pontos | `src/features/estado/`, prompt `estado-v1` | "O que falta fechar": um estado por ponto (a esclarecer, discutido, a confirmar, decidido, adiado) com a fala que o sustenta. Fonte, dono e prazo são conferidos em código. |
| Fechamento | `estado/sintese.ts`, `estado/registrar.ts` | Síntese sobre o estado validado (sem nova chamada ao modelo), frase de fechamento sugerida (rotulada), e por clique: **registrar como acompanhamento** (ponto decidido ou a confirmar, sem dono/prazo inventados) ou **como decisão** (só ponto decidido, com a fala copiada da transcrição). |
| Acompanhamentos | `src/features/acompanhamento/juiz.ts`, prompt `acompanhamento-v1`, `trabalho/store.ts` | No máximo 3 por reunião (`LIMITE_DE_ACOMPANHAMENTOS_POR_REUNIAO`; só cancelado libera vaga). Quem ocupa as vagas é escolhido por um juiz de IA entre ids oferecidos; sem julgamento válido, ninguém entra. O teto é reforçado no armazenamento. |
| Apoio ao vivo | `src/features/apoio/`, prompt `intervencao-v1` | Sugestões privadas, no máximo uma por vez. Política em código (validade, repetição, intervalo, limite por hora, silêncio por padrão). |
| Cartão de apoio | `src/sidepanel/CartaoDeApoio.tsx` | Sugestão rotulada, "Ver fonte", usar/resolvido/guardar/descartar (com feedback), pausar. |
| Calibração | `src/features/calibracao/` | Ajustes propostos a partir do feedback (com limiar, antes → depois, aprovação) e teste histórico por cortes de tempo. |
| Ação externa por botão | `taq/orquestrador.ts` (`confirmarAcao`) | E-mail e agenda só saem por clique no cartão; o modelo só prepara a prévia. |

## Garantias verificadas em código (com teste)

- Fala citada que não existe até o corte → recusada; o trecho guardado é copiado da transcrição.
- "Decidido" exige fala com conteúdo; proposta fica "a confirmar"; só reabre com fala posterior.
- A correção da pessoa só cede a fala posterior à correção.
- Dono e prazo só ficam se aparecem na fala citada.
- Sem perfil, ou no modo "só quando eu chamar", o modelo **não é chamado** sozinho.
- O começo da reunião (menos de 6 falas ou 80 palavras) não é avaliado.
- No máximo uma sugestão na tela; sugestão velha nunca aparece; o mesmo ponto não repete; descarte da pessoa é respeitado.
- Resultado de tarefa antiga (a reunião mudou no meio) não é publicado.
- O teste histórico só dá ao modelo o que existia em cada corte e não deixa nada gravado.
- Apagar a reunião leva briefing, avisos, sugestões, estado e medições dela; o perfil fica.

## Como verificar

- Testes: `npm test` (raiz) e `cd server; npx vitest run lib/taq`. Visão geral do Taq:
  `docs/arquitetura/taq-assistente.md`.
- Tela "Preparar" no navegador: `node scripts/verify-preparar.cjs <playwright-core> <pasta da build de desenvolvimento>` (resultado em `docs/verification/preparar/`).
- Contra o provedor real, com reunião **sintética** (chave gratuita só aceita dado inventado): subir o servidor (`cd server; npx next build; npx next start -p 3100`) e rodar os arquivos `*.live.test.ts` com `TAQ_LIVE_URL` e `TAQ_LIVE_KEY` (ver o cabeçalho de cada um). Cobrem: `conducao-v1`, `intervencao-v1` (varredura, laço completo, retirada), `estado-v1`, `copilot-v2`, `acompanhamento-v1` (`juiz.live.test.ts`), histórico por cortes.

## Publicação: servidor antes da extensão

As instruções de sistema moram no servidor, versionadas. A extensão pede pelo nome.
Servidor sem a versão = falha ("Versão de instruções desconhecida", visto na prática).
Versões desta família que o servidor precisa ter: `conducao-v1`, `copilot-v2`,
`communication-v3`, `scheduling-v3`, `intervencao-v1`, `estado-v1`, `acompanhamento-v1`
(todas mapeadas em `server/lib/taq/instrucoes.ts`). Deploy é manual; quais já foram
publicadas: não verificado.

## O que ainda não está feito ou validado

- **Não visto no navegador:** o cartão de apoio, o cartão "O que falta fechar" e o laço ao vivo
  (precisam de uma reunião do Meet em andamento). A tela "Preparar" foi verificada no Edge.
- **Provedor real só com o plano gratuito e dado sintético.** Limiares (intervalos, limites,
  conteúdo mínimo, janelas, limiares de feedback) são **ponto de partida**, não medição.
  A latência observada foi de 1 a 20 s por chamada neste provedor.
- O modelo não é determinístico: o estado de um ponto pode variar entre leituras; por isso a
  pessoa corrige, e a correção prevalece.
- **Cliente como entidade** não existe: encontros se ligam por escolha da pessoa, por id.
  Não há "histórico do cliente" nem alcance "cliente" no feedback.
- O estado dos pontos só é atualizado por botão (uma chamada ao modelo lendo as
  últimas 60 falas consolidadas); não há atualização automática.
- O limite de 3 acompanhamentos por reunião é fixo no código; concluir um item não
  libera vaga, só cancelar (a mensagem ao usuário fala em "concluir ou cancelar":
  divergência a conferir).
- **Sem sincronização entre dispositivos** das sugestões, do estado e do perfil (tudo local).
- O briefing não volta ao "Desfazer" de uma reunião apagada (é derivado dela).
- `politica.ts` (escrita local e ações de interface) e `roteamento.ts` ainda decidem por regex.
- O alcance "reunião / cliente / preferência" no momento do feedback não é perguntado: o
  feedback vale "agora", e a calibração é feita por proposta aprovada.
