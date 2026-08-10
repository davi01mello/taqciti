# TaqCITi — servidor de geração de documento

Servidor Next.js (App Router) independente do resto do repositório, usado
pela extensão na fase 2 do fluxo "Continuar fluxo": recebe a transcrição de
uma reunião e devolve um documento gerado.

Só backend — sem interface própria. O fluxo de "Gerar Documento" inteiro
(escolher o tipo, mostrar loading/erro, exibir o resultado) vive dentro da
extensão TaqCiti (`src/document/GenerateDocumentMenu.tsx`), que chama a
única rota daqui.

## Rodando localmente

```
cd server
npm install
npm run dev
```

Sobe em `http://localhost:3000`. Única rota: `POST /api/generate`.

## A geração é um stub

Nesta fase **não há IA de verdade nenhuma** — `generateDocument` em
`lib/generateDocument.ts` sempre devolve um documento fixo, só provando que
a transcrição chegou (mostra a contagem de caracteres recebida). É a
**única** função que muda quando a IA de verdade entrar; a rota em
`app/api/generate/route.ts` não precisa mudar.

Contrato da rota:

```
POST /api/generate
Content-Type: application/json

{ "transcript": "string", "title"?: "string", "date"?: "string" }

→ 200 { "title": "string", "content": "string" }
→ 400 { "error": "string" }  (payload inválido)
```

## CORS — risco conhecido nesta fase

A extensão chama esta rota a partir de `chrome-extension://<id>`, e esse
`id` muda entre modo dev (carregado sem empacotar) e produção (Chrome Web
Store) — não dá pra fixar um valor só no `Access-Control-Allow-Origin`.

Por isso a rota reflete de volta qualquer `Origin` que comece com
`chrome-extension://`, em vez de checar contra um id específico (ver
`corsHeaders` em `app/api/generate/route.ts`).

**Isso aceita chamadas de QUALQUER extensão Chrome instalada no navegador de
quem chamar, não só o TaqCITi** — não existe autenticação nenhuma nesta
fase. É um risco real e conhecido, deixado assim de propósito por enquanto;
a correção (restringir por id conhecido e/ou exigir uma chave de API) fica
para quando a integração de IA de verdade entrar.

## DocCiti (mockup do hero animado) — descontinuado

O mockup HTML standalone da tela de geração de documento (a animação de onda
reativa ao cursor/clique) foi descartado como frontend: o fluxo real de
geração agora vive inteiro dentro da extensão TaqCiti, sem nenhum caminho que
leve pra fora dela. Os arquivos ficam arquivados, só como referência
histórica, em [`Legado/`](Legado/) — fora de `public/`, então não são mais
servidos por este servidor. Detalhes de manutenção da animação (caso algum
dia vire algo reaproveitável) em [`Legado/HANDOFF.md`](Legado/HANDOFF.md).
