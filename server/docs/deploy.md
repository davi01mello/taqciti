# Deploy do servidor

Runbook completo. Nenhuma chave aparece aqui: tudo é variável de ambiente, e o
mesmo procedimento serve para a sua chave hoje e para a da empresa depois —
troca-se o valor, não o código.

> **Produção hoje é o Railway**, em
> `https://taqciti-production.up.railway.app`. Este documento já se chamou
> `deploy-vercel.md` e descrevia a Vercel do começo ao fim, muito depois de a
> produção ter mudado de casa — inclusive mandando rodar a prova de fumaça
> contra um endereço `.vercel.app` que não existe mais. O nome do arquivo
> perdeu o host de propósito, para não rotular errado de novo.
>
> O app continua sendo um Next.js (App Router) comum, sem `output: 'export'` e
> sem nada que exija hospedagem especial — qualquer host Node/Next serve. O que
> muda entre hosts está na seção 8.

---

## 1. Criar o projeto

O repositório tem **dois projetos independentes**: a extensão na raiz e este
servidor em `server/`. O host precisa saber disso.

| Campo | Valor |
| --- | --- |
| **Root Directory** | `server` |
| Framework | Next.js (detectado sozinho) |
| Build / Install | padrão |

**`Root Directory = server` é obrigatório.** Sem isso o host tenta construir a
extensão (Vite) achando que é o app Next, e o deploy falha ou publica a coisa
errada. É ajuste de projeto, no painel — não dá para configurar por arquivo.

O Railway **redeploya sozinho** a cada push na branch conectada (`main`). Levou
~1 minuto nas duas vezes medidas em 22/08/2026. Não existe passo manual de
deploy no fluxo normal.

---

## 2. Variáveis do SERVIDOR

No painel do host, nas variáveis de ambiente do serviço. Esta tabela não muda
de host para host.

| Variável | Obrigatória | O que é |
| --- | --- | --- |
| `DOCCITI_SHARED_KEY` | **sim** | Segredo compartilhado com a extensão. Sem ela toda requisição responde **500** — falha fechada de propósito, porque "sem segredo" não pode significar "aberto para todo mundo" com uma chave paga atrás. |
| `GOOGLE_API_KEY` | sim (na config atual) | Chave do provedor. Ver a seção 4 — **precisa ser paga**. |
| `ANTHROPIC_API_KEY` | não | Só se trocar o provedor em `lib/ai/config.ts`. |
| `XAI_API_KEY` | não | Idem. |
| `DOCCITI_MAX_TRANSCRIPT_CHARS` | não | Teto por requisição. Padrão 400000. |
| `DOCCITI_DATA_POLICY` | **não defina em produção** | Ver a seção 4. |
| `DOCCITI_PENSANTE` / `DOCCITI_AUDITOR` / `DOCCITI_ESCRITOR` | não | `provedor:modelo`, para trocar de modelo sem recompilar. |

Gere o `DOCCITI_SHARED_KEY` como um valor aleatório longo, e guarde: ele
precisa ser **idêntico** no servidor e na build da extensão (seção 3).

```bash
# um valor descartável e sem ambiguidade visual
openssl rand -hex 24
```

> Este segredo **não é autenticação**. Ele viaja dentro do bundle da extensão,
> que qualquer pessoa consegue abrir. Serve para barrar varredura e uso
> acidental da cota — não para tratar quem chama como confiável. Ver
> `lib/apiGuard.ts`.
>
> E não conte com o CORS para ajudar: ele reflete **qualquer** origem, de
> propósito, porque o painel é um content script declarado para `<all_urls>` e
> uma lista de origens permitidas precisaria conter a internet. O bloco de
> `corsHeaders` explica por extenso.

---

## 3. Variáveis da BUILD DA EXTENSÃO

O endereço do servidor e o segredo entram **no bundle, na hora da build** —
não são lidos em runtime. Uma extensão construída sem eles aponta para
`http://localhost:3000`, que é o padrão de desenvolvimento.

Foi exatamente o que aconteceu com os instaladores da `v2.0.0`: saíram
apontando para localhost, e só funcionariam para quem estivesse rodando o
servidor na própria máquina.

No GitHub, em **Settings → Secrets and variables → Actions**:

| Nome | Onde | Valor |
| --- | --- | --- |
| `DOCCITI_SERVER_URL` | **Variables** | `https://taqciti-production.up.railway.app` — sem barra no fim |
| `DOCCITI_SHARED_KEY` | **Secrets** | o mesmo valor da seção 2 |

A URL vai em *Variables* e não em *Secrets* porque ela não é segredo (está no
bundle de qualquer forma) e assim aparece legível nos logs, que ajuda a
diagnosticar.

O `release.yml` lê os dois e **falha a build se faltarem**, em vez de produzir
instaladores apontando para localhost em silêncio.

O procedimento completo da release — em que ordem fazer, como conferir o
instalador publicado e o que fazer quando o check aborta — está em
`docs/publicar-release.md`, na raiz do repositório.

---

## 4. A chave precisa ser PAGA. Isto não é preferência.

A configuração de free tier do Gemini manda todo o conteúdo enviado para
**treinamento do provedor, com revisão humana**. Transcrição de reunião é
exatamente o tipo de dado que os termos desaconselham mandar para lá.

O servidor tem uma trava para isso: com `DOCCITI_DATA_POLICY=training`, a rota
**exige** `"sintetica": true` no corpo. E a extensão **não envia esse campo** —
ela captura reunião de verdade, então enviá-lo seria mentira. Resultado:

- com `DOCCITI_DATA_POLICY=training` → a extensão recebe **400** em toda
  geração;
- sem ela, e com chave de free tier → conversa real de cliente vai para
  treinamento.

Não há terceira opção com chave gratuita. **Use uma chave paga em produção e
não defina `DOCCITI_DATA_POLICY`.**

Limite prático da chave gratuita, para referência: **20 requisições por dia,
por modelo**. Uma Ata completa consome quase tudo.

---

## 5. Tempo de execução

**O teto de 300s não existe mais.** Ele era da Vercel, e vale a pena dizer por
extenso porque a versão anterior deste documento o tratava como o maior risco
aberto do projeto:

> "A medição mais recente estima uma Ata completa em ~360s. No Hobby, uma
> geração de verdade tem boa chance de estourar o limite da função."

Isso está certo **na Vercel**, onde cada rota vira uma função serverless com
teto duro por requisição, e onde as duas únicas saídas eram plano Pro ou
redesenhar a geração como job assíncrono. Nenhuma das duas foi feita, e nenhuma
das duas é necessária hoje: no Railway o app roda como processo Node de vida
longa (`next start`), não como função serverless. `export const maxDuration` é
**diretiva da Vercel** — o Next a compila em configuração de função, e em
qualquer outro host Node ela é inerte. Os três `maxDuration = 300` no código
não limitam nada aqui.

**O que ainda NÃO foi medido:** nunca rodei uma geração completa de ~360s
através do proxy do Railway nesta configuração. O teto de função sumiu; o que
um proxy HTTP tolera de resposta lenta é outra pergunta, e ela continua sem
resposta medida. Antes de prometer prazo a alguém, gere uma Ata de verdade e
cronometre — é o único teste que exercita a coisa inteira.

E o teto que **continua valendo em qualquer host** é o do próprio código:
transcrição acima de `DOCCITI_MAX_TRANSCRIPT_CHARS` (padrão 400.000
caracteres) leva **413** antes de virar uma conta cara.

---

## 6. Conferir o deploy sem gastar cota

`scripts/smokePdf.mjs` chama `POST /api/answers`, que renderiza HTML e PDF
**sem chamar modelo nenhum** — roda de graça e não consome cota. Ele falha se
o PDF não vier, se não for um PDF de verdade, ou se a fonte Barlow não estiver
embutida.

```bash
cd server
SMOKE_BASE_URL=https://taqciti-production.up.railway.app \
DOCCITI_SHARED_KEY=<a mesma chave> \
node scripts/smokePdf.mjs
```

Saída esperada:

```
PDF: 140092 bytes
Prova de fumaça OK: build de produção renderiza PDF com a Barlow embutida.
```

É a primeira coisa a rodar depois de qualquer deploy. Um `200` na home não
prova nada: o defeito que mais custou caro aqui era a rota respondendo **200
sem PDF**, em silêncio, só em build de produção.

Para provar o pipeline inteiro (aí sim consumindo cota), `POST /api/generate`
com `x-docciti-key` e um `transcript`.

Para conferir só que o deploy subiu — sem chave nenhuma — um `OPTIONS` basta,
e distingue "no ar" de "no ar com a versão nova":

```bash
curl -sI -X OPTIONS \
  -H 'Origin: https://meet.google.com' \
  -H 'Access-Control-Request-Method: POST' \
  https://taqciti-production.up.railway.app/api/generate
```

---

## 7. Trocar para a chave da empresa

Nada de código muda.

1. Painel do host → variáveis de ambiente → editar `GOOGLE_API_KEY`.
2. **Redeploy** — variável de ambiente só vale a partir do próximo deploy. No
   Railway, salvar a variável já dispara um; confirme que ele terminou antes de
   testar, ou você mede contra o processo antigo.
3. Rodar a prova de fumaça da seção 6.

Se o `DOCCITI_SHARED_KEY` também mudar, é preciso **reconstruir a extensão**
(o valor está no bundle): atualizar o secret no GitHub e cortar uma tag nova.

---

## 8. O que sobrou da Vercel, e por que fica

Dois artefatos no repositório só fazem sentido na Vercel. Nenhum atrapalha o
Railway, e os dois ficam como porta de volta — mas nenhum dos dois está
surtindo efeito hoje, o que importa saber antes de confiar neles:

| Artefato | O que faz na Vercel | Hoje |
| --- | --- | --- |
| `server/vercel.json` | fixa a região em `gru1` (São Paulo) | **inerte.** O Railway responde de `mia1` (Miami) — dá para confirmar no header `x-railway-edge` de qualquer resposta. A intenção de servir do Brasil não está sendo cumprida; se latência importar, a região se ajusta no painel do Railway. |
| `maxDuration = 300` em `app/api/generate`, `/api/ai/secao`, `/api/ai/bench` | teto da função serverless | **inerte** (ver seção 5). |

Se voltar para a Vercel, os dois voltam a valer sozinhos — e a seção 5 volta a
ser o maior risco aberto do projeto.
