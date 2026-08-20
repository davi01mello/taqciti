# Deploy do servidor na Vercel

Runbook completo. Nenhuma chave aparece aqui: tudo é variável de ambiente, e o
mesmo procedimento serve para a sua chave hoje e para a da empresa depois —
troca-se o valor, não o código.

---

## 1. Criar o projeto

O repositório tem **dois projetos independentes**: a extensão na raiz e este
servidor em `server/`. A Vercel precisa saber disso.

Ao importar o repositório:

| Campo | Valor |
| --- | --- |
| **Root Directory** | `server` |
| Framework Preset | Next.js (detectado sozinho) |
| Build Command | padrão |
| Install Command | padrão |

**`Root Directory = server` é obrigatório.** Sem isso a Vercel tenta construir
a extensão (Vite) achando que é o app Next, e o deploy falha ou publica a
coisa errada. Não dá para configurar isso por arquivo — é ajuste de projeto,
no painel.

`vercel.json` (neste diretório) fixa a região em `gru1` (São Paulo), que é a
mais perto de quem usa.

---

## 2. Variáveis do SERVIDOR

Painel do projeto → **Settings → Environment Variables**. Marque *Production*
e *Preview*.

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
| `DOCCITI_SERVER_URL` | **Variables** | `https://<seu-projeto>.vercel.app` — sem barra no fim |
| `DOCCITI_SHARED_KEY` | **Secrets** | o mesmo valor da seção 2 |

A URL vai em *Variables* e não em *Secrets* porque ela não é segredo (está no
bundle de qualquer forma) e assim aparece legível nos logs, que ajuda a
diagnosticar.

O `release.yml` lê os dois e **falha a build se faltarem**, em vez de produzir
instaladores apontando para localhost em silêncio.

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

## 5. Tempo de execução — leia antes de prometer prazo

`app/api/generate/route.ts` declara `maxDuration = 300`, que é o **teto duro
do plano Hobby** (confirmado por deploy real falhando ao tentar 600).

A medição mais recente estima uma Ata completa em **~360s**. Ou seja: no
Hobby, uma geração de verdade tem boa chance de estourar o limite da função —
isso é limite de plataforma, não defeito do código.

Duas saídas:

1. **Plano Pro.** Permite `maxDuration` maior; depois de migrar, subir o valor
   naquele arquivo (é uma constante estática — o Next a lê em build, então não
   dá para vir de variável de ambiente).
2. **Tornar a geração assíncrona** (job em background + polling, ou streaming
   seção a seção). É redesenho de arquitetura, não ajuste de configuração.

---

## 6. Conferir o deploy sem gastar cota

`scripts/smokePdf.mjs` chama `POST /api/answers`, que renderiza HTML e PDF
**sem chamar modelo nenhum** — roda de graça e não consome cota. Ele falha se
o PDF não vier, se não for um PDF de verdade, ou se a fonte Barlow não estiver
embutida.

```bash
cd server
SMOKE_BASE_URL=https://<seu-projeto>.vercel.app \
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

---

## 7. Trocar para a chave da empresa

Nada de código muda.

1. Vercel → Settings → Environment Variables → editar `GOOGLE_API_KEY`.
2. **Redeploy** — variável de ambiente só vale a partir do próximo deploy.
3. Rodar a prova de fumaça da seção 6.

Se o `DOCCITI_SHARED_KEY` também mudar, é preciso **reconstruir a extensão**
(o valor está no bundle): atualizar o secret no GitHub e cortar uma tag nova.
