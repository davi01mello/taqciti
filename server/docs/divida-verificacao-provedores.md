# Dívida: Anthropic e xAI verificados só contra os `.d.ts`

**Estado em 2026-08-12.** Os adaptadores de `anthropic` e `xai` nunca fizeram
uma chamada a uma API de verdade. Nenhuma chave desses dois provedores
existiu neste ambiente; a única configurada é a do Google.

O que existe de verificação para eles:

- **tipos** — as formas de requisição foram tiradas dos `.d.ts` dos SDKs
  instalados (`@anthropic-ai/sdk` 0.116.0, e o formato compatível com OpenAI
  documentado pela xAI), não da documentação pública. Isso pega nome de campo
  errado e tipo errado;
- **testes** — 120+ testes cobrem a lógica pura em volta (validação de
  schema, laço de reparo, espera por 429, tabela de preços, conversão de
  schema do Gemini). Nenhum deles faz rede.

O que isso **não** prova: que a API aceita o corpo que montamos, e que
estamos lendo a resposta dela direito. São duas provas diferentes, e o
`.d.ts` não dá nenhuma das duas — ele descreve a superfície do SDK, não o
contrato do servidor.

## O que especificamente não foi provado

Esta é a lista para consultar quando as chaves entrarem. É por aqui que vai
quebrar, e com a lista escrita o diagnóstico é de minutos em vez de horas.

### Anthropic — `lib/ai/providers/anthropic.ts`

| # | Não provado | Como falha se estiver errado |
|---|---|---|
| 1 | `output_config.format` com `{type:'json_schema', schema}` | 400 na primeira chamada com `jsonSchema`. A de texto puro passa, então parece que "só o JSON quebrou". |
| 2 | `thinking: {type:'adaptive'}` + `output_config.effort: 'medium'` | 400. **Só nos modelos da lista `ADAPTIVE_THINKING_MODELS`** — como o Auditor roda em Haiku 4.5, que está fora da lista, o Auditor funcionaria e os outros três não. |
| 3 | Breakpoint de cache com `cache_control: {type:'ephemeral'}` no primeiro bloco de texto | Silencioso. Não dá erro: `cache_read_input_tokens` volta 0 para sempre e o custo por documento fica alto sem explicação. |
| 4 | Leitura de `usage`: `input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens` | Silencioso. A convenção normalizada diz que `inputTokens` inclui cache; se a API separar diferente, o custo sai errado sem ninguém notar. A asserção do smoke pega o caso extremo (zero), não o caso sutil. |
| 5 | Tradução de 429 via `instanceof Anthropic.RateLimitError` e leitura do header `retry-after` | O 429 viraria `ProviderError` comum, não seria repetido, e a geração morreria no meio parecendo bug de lógica. |
| 6 | `stop_reason === 'refusal'` | Trataríamos uma recusa como resposta vazia, com mensagem de erro errada. |

Nota sobre o #2: `maxRetries: 0` no cliente é deliberado (ver comentário no
arquivo). Se ao ligar a chave aparecerem muitos 429, isso é esperado — quem
espera agora é `providers/shared.ts`, e as esperas aparecem em
`meta.rateLimitWaits`.

### xAI — `lib/ai/providers/xai.ts`

| # | Não provado | Como falha se estiver errado |
|---|---|---|
| 7 | `response_format: {type:'json_schema', json_schema:{name, schema}}` | 400. O campo `name` é exigência do formato da OpenAI; a documentação da xAI não o mostra explicitamente. |
| 8 | Omitir `strict` é aceito | Se `strict` for obrigatório lá, 400. Está omitido de propósito: no modo estrito todo campo vira `required`, o que proibiria os campos ausentes que representam lacuna na especificação do DocCiti. |
| 9 | `max_tokens` (e não `max_completion_tokens`) | 400 ou parâmetro ignorado — este último é pior, porque a resposta simplesmente não respeita o teto. |
| 10 | Leitura de `usage`: `prompt_tokens` já inclui `prompt_tokens_details.cached_tokens`, e `completion_tokens` já inclui raciocínio | Silencioso, mesmo problema do #4. |
| 11 | 429 vem com status HTTP 429 (e não 200 com erro no corpo) | O 429 não seria reconhecido e não haveria espera. |

### Google — já provado

O adaptador do Google é o único exercitado contra a API real. Ver o
`naoVerificado` da resposta de `/api/ai/smoke` para o que continua em aberto
mesmo nele (cache e espera por 429).

## Como sair da dívida

Uma chave de cada provedor, e:

```
curl -X POST http://localhost:3000/api/ai/smoke \
  -H "x-docciti-key: $DOCCITI_SHARED_KEY" \
  -H "Content-Type: application/json" \
  -d '{"providers":["anthropic","xai"]}'
```

O smoke cobre os itens 1, 4, 6, 7, 9 e 10 — ele falha, e não passa, quando
`usage.inputTokens` vem zero ou ausente. Os itens 3 e 5 (cache e 429) **não
saem** com uma chamada única: cache só rende no segundo request com o mesmo
prefixo, e 429 depende de estourar cota. Esses ficam para a Fase 2, quando o
Pensante repetir o mesmo contexto compactado nove vezes.

Quando a dívida sair, apague este arquivo — nota de dívida que sobrevive ao
problema vira desinformação.
