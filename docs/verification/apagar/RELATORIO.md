# Apagar documento, conversa e notas — verificação local

Verificação em 22/09/2026, no projeto real, com a extensão compilada e um perfil
temporário isolado. Nenhum instalador, release ou publicação foi produzido, e
nada foi escrito no perfil pessoal do navegador.

## O que passou a existir

| O quê | Onde | O que a confirmação avisa |
| --- | --- | --- |
| Documento | HOME → Documentos, lixeira do item — e, como antes, no menu secundário do editor | A reunião de origem não é afetada |
| Conversa | HOME → menu de conversas, lixeira da linha | As mensagens saem para sempre |
| Notas da reunião | HOME → Reuniões → a reunião → lixeira no topo da coluna de notas | A transcrição não é afetada |

Apagar a reunião inteira já existia e não mudou.

Três decisões que a implementação toma, e o motivo:

- **A pergunta ocupa o lugar do item**, em vez de abrir uma caixa por cima.
  Numa lista, uma caixa flutuante perde a âncora de qual registro vai sumir.
- **Apagar a nota remove o REGISTRO**, e não só o texto. `gravarNota(id, '')`
  esvazia o campo mas preserva os `anteriores` — os originais guardados quando
  registros antigos foram agregados —, então o "apagado" voltaria agregado.
  `apagarNota` leva tudo, e não exige que a reunião ainda esteja no histórico:
  nota órfã é justamente o caso em que remover importa mais.
- **O rascunho pendente é cancelado antes de apagar.** O gravador tem respiro
  de 700ms; sem o cancelamento, a última tecla digitada reescreveria a nota um
  instante depois da remoção, e ela reapareceria sozinha.

## Defeito encontrado no navegador — e só lá

`.tq-conversas-lista li button` dá `display: block; width: 100%` a qualquer
botão da lista, e é **mais específico** que uma classe sozinha. A lixeira da
conversa nascia com os 296px do menu e transbordava pela direita, empurrando o
título para fora; as ações "Apagar/Cancelar" da confirmação se empilhavam como
dois blocos de largura inteira.

Os testes de componente rodam em **jsdom, que não faz layout** — eles passavam.
Foi esta passada no Edge que pegou, e as duas regras passaram a carregar
`.tq-conversas-lista li` no seletor. As asserções de caixa ficaram no script
para trancar a regressão.

## Testes executados

| Verificação | Resultado / evidência |
| --- | --- |
| Suíte unitária e de componentes | 49 arquivos, **627 testes aprovados** (`npm test`) |
| Tipos | `npm run typecheck` aprovado |
| Lint | `npm run lint` aprovado, sem avisos |
| Compilação | `npm run build` aprovado; extensão em `dist/` |
| Documentos — a lixeira é irmã do item | Caixa medida: à direita do item, alinhada, sem sobrepô-lo. Botão dentro de botão é HTML inválido, e o clique acertaria o alvo errado |
| Documentos — cancelar | O item volta; `taq:documents` continua com 2 registros |
| Documentos — apagar | Sai só o documento; `taq:history` intacto |
| Notas — posição do ícone | Dentro do topo da coluna, acima do campo, sem invadi-lo |
| Notas — a confirmação não esprema o campo | Campo continua dentro da coluna e com altura útil |
| Notas — apagar | `taq:notes` perde a chave; campo vazio; a lixeira some (sem nota, não há o que apagar); transcrição com os 12 trechos |
| Notas — tecla pendente | Texto digitado e não salvo, apagado em seguida: 1,5s depois o storage continua sem a nota |
| Conversas — a lixeira cabe na linha | Caixa medida: não cobre o título nem sai do menu |
| Conversas — ações lado a lado | "Apagar" e "Cancelar" alinhados, dentro do menu |
| Conversas — Escape | Desfaz a pergunta **sem** fechar o menu; o segundo Escape fecha |
| Conversas — apagar | Sai de `taq:conversations`; o menu continua aberto |
| Conversas — apagar a aberta | Cai na mais recente que sobrou; apagando a última, a tela de abertura, sem mensagens órfãs |

O teste no navegador está em `scripts/verify-apagar.cjs`. Usa Playwright Core e
Edge, com a extensão compilada e perfil temporário isolado. Para repetir:

```bash
npm run build
node scripts/verify-apagar.cjs <caminho-do-playwright-core>
```

`BROWSER_PATH` pode apontar para outro Chromium que aceite `--load-extension`.
O resultado estruturado está em [resultados.json](resultados.json).

## Capturas

- [Documentos — a lista com a lixeira por item](documentos-lista.png)
- [Documentos — a pergunta no lugar do item](documento-confirma.png)
- [Notas — a pergunta acima do campo](nota-confirma.png)
- [Notas — depois de apagar](nota-apagada.png)
- [Conversas — o menu com a lixeira por linha](conversas-menu.png)
- [Conversas — a última apagada](conversas-vazio.png)

## Dados de teste e limites

**Dados de teste:** todos os títulos e conteúdos trazem o marcador `[TESTE]`,
gravados no `chrome.storage.local` real de um perfil temporário. Nenhum registro
de teste foi para o perfil pessoal.

**Não executado nesta rodada:** captura de uma reunião ao vivo no Meet, e a
propagação da remoção para o servidor com a sincronização ligada. A regra existe
e tem teste unitário — "estava guardado e sumiu daqui → apaga lá", em
`src/features/sync/sincronizacao.ts` —, mas não foi exercitada contra um
servidor de verdade aqui. O item 13 de
[`docs/roteiro-reuniao-real.md`](../../roteiro-reuniao-real.md) cobre isso à mão.

**Sidebar:** o editor de nota da sidebar (`src/sidepanel/Notas.tsx`) **não**
ganhou o botão. Ele é a nota da reunião em curso, escrita enquanto ela acontece;
apagar ali é um gesto de arrumação, e arrumação mora na HOME.
