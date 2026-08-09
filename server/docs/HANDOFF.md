# DocsCiti — hero animado · documento de transferência

Entregável: `docsciti_mockup.html`. HTML único, sem dependências, sem build.
Abre direto no navegador. Toda a animação está num IIFE no `<script>` no fim do arquivo.

---

## LEIA ISTO ANTES DE REFATORAR QUALQUER COISA

O loop de desenho contém otimizações que **parecem código descuidado e não são**.
Elas existem porque o loop roda ~300 barras × ~50 fileiras × 40 vezes por segundo.
Se forem "limpas", o custo por quadro multiplica e a animação engasga.

**Não desfaça nada da lista abaixo:**

1. **Tabelas de cor pré-montadas** (`buildColorTable`, `topBody`, `botCrest`, `topGlow`…).
   Montar uma string `'rgba(...)'` dentro do loop obriga o navegador a reinterpretar
   a cor milhares de vezes por quadro. O alpha é quantizado em 32 níveis
   (imperceptível) e as strings são reaproveitadas. Cor nova entra por
   `buildColorTable`, nunca por concatenação no loop.

2. **`grainTable` como única fonte de ruído.** É um `Float32Array` de 2048 valores
   pré-calculados. Nunca chame `Math.random()` por pixel, por barra ou por quadro
   no caminho de desenho.

3. **Desenho agrupado por buckets de cor.** Os retângulos são acumulados em arrays
   por nível de alpha e despejados em lote no fim — ~500 trocas de `fillStyle` por
   quadro em vez de milhares. Não troque por "desenhar cada barra na hora".

4. **Aritmética barata proposital.** `|0` em vez de `Math.floor`, `Math.sqrt` em vez
   de `Math.pow(x, 1.5)`, `(k&1)` em vez de `k % 2`, comparações manuais em vez de
   `Math.abs`. Está assim de propósito.

5. **Limitador de quadros (`lastDraw`).** Teto de ~40fps. Imperceptível numa animação
   ambiente e corta um terço do trabalho.

6. **Duas passadas de composição.** Corpo em `source-over`; crista, halo e partículas
   em `globalCompositeOperation = 'lighter'`. É a soma de luz que produz o bloom
   colorido — em opacidade normal a onda fica opaca, não luminosa.
   **As cores da crista são saturadas de propósito** (canal segurado embaixo). Em
   modo aditivo, cor-base clara faz os três canais estourarem juntos e a onda vira
   uma fita branca. Já aconteceu; não "clareie para ficar mais bonito".

7. **Pooling de partículas.** `embers` (1200) e `motes` (1300) são arrays de tamanho
   fixo com cursor circular. Nada é alocado durante o clique.

8. **Largura de retângulo = `BAR_W` cheio.** Barras vizinhas se tocam e formam as
   scanlines horizontais contínuas. Se você reintroduzir vão horizontal, a textura
   vira grade quadriculada e a onda perde a leitura de sinal.

9. **Sub-passos da mola.** Com rigidez 1500 no burst, integrar em um passo de 24ms
   diverge numericamente. O laço `for(var ss=0; ss<sub; ss++)` existe por isso.

---

## Mapa de parâmetros (é aqui que se ajusta)

### Interação — bloco `// ---- parâmetros de interação`
| nome | valor | o que faz |
|---|---|---|
| `VIT_RANGE` | 190 | raio **vertical** de ativação do cursor, em px |
| `PROX_RANGE` | 125 | raio **horizontal** de proximidade |
| `HOVER_GAIN` | 2.6 | força da resposta ao cursor dentro do raio |
| `SPEED_GAIN` | 1.6 | quanto a velocidade do mouse agita |
| `WAKE_GAIN` | 1.8 | intensidade do rastro deixado pelo cursor |
| `AMBIENT_CAP` | 4.2 | teto da onda sem clique |

`vitality` **não tem piso**: longe da faixa o cursor tem influência zero. Isso é
intencional — foi pedido explicitamente. Não reintroduza um valor mínimo.

### Clique — perto de `buildSpikes` / `buildShards`
| nome | valor | o que faz |
|---|---|---|
| `BURST_GAIN` | 1.7 | altura geral do impacto |
| `BURST_LIFE` | 3.6 s | tempo de vida (o componente mais lento precisa cruzar a tela) |
| `hgt[0]` | 7.5 | altura da agulha central |
| `SPIKE_N` | 11 | espinhos do estilhaço |
| `SHARD_N` | 22 | componentes que viajam (11 pares esquerda/direita) |
| `SHARD_ATTEN` | 150 | atenuação espacial dos pacotes, em barras |

O ataque dos pacotes (`1 - e^(-t/0.13)`) é o que impede o vale do wavelet de
decepar a agulha. Se removido, o centro do clique afunda.

### Forma e textura
| nome | valor | o que faz |
|---|---|---|
| `MAX_H` | 32 | altura de referência da barra |
| `BAR_W` | 5 | largura da barra |
| `PX` / `RH` | 3.2 / 1.9 | passo e espessura das scanlines |
| `CREST_FRAC` | 0.62 | fração da altura que é faixa clara |
| `GAP` | 4 | vão escuro no centro |
| `dim` (em `emitHalf`) | 0.70 | recolhimento da metade de baixo |

A altura máxima do clique é derivada da tela (`headroom` / `softKnee` / `kneeSpan`),
não de um número fixo. O joelho é uma compressão assintótica: **corte duro empilha
dezenas de barras na mesma altura e a agulha vira um bloco de topo chapado.**

### Título
`STEP_IN` 30ms · `STEP_OUT` 13ms · `IDLE` 5000ms · array `SCRAMBLE`.

---

## O que é demo e precisa virar produção

- **`demoTranscript`** — semente fixa do PRNG. Em produção:
  `seed = hash(transcript_da_reuniao)`. Cada reunião gera uma onda própria.
- **`phrasesPool`** — 33 frases de exemplo. Em produção, trechos reais da transcrição.
- **Botões** — `setTimeout` de 1300ms simulando "Gerando…". Trocar pela chamada real.
- **Tokens de cor** — a paleta CITi já está no `:root`. Confira contra o guia oficial.
- **Roxo do corpo da onda** — `topBody = buildColorTable(148,58,252)` é `#7D1AD7`
  levantado em valor, mesmo matiz. O hex exato tem luminância baixa demais para o
  corpo em alpha baixo. O hex literal está preservado nos acentos (palavra
  "documentar", glow do X1, anéis de clique, texto de fundo).

---

## Brand

Está embutida como base64 (73KB dos 127KB do arquivo). Para o repositório,
o `.webp` separado está junto:

```html
<!-- trocar -->
<img src="data:image/webp;base64,UklGR...">
<!-- por -->
<img src="/assets/doccciti-brand.webp" alt="DocCiti">
```

O HTML cai para ~54KB. O `.webp` tem 55KB e alfa limpo (borda antialiasada
verde-escura, sem halo branco) — assenta em qualquer fundo escuro.

---

## Se for portar para SPA (React / Vue / Svelte)

**O ponto crítico é teardown.** O script atual registra listeners em `window` e roda
um `requestAnimationFrame` sem nenhuma limpeza — como mockup standalone tudo bem,
numa SPA vaza a cada desmontagem.

Checklist mínimo:

- Guardar o id do `requestAnimationFrame` e chamar `cancelAnimationFrame` no cleanup.
- Remover `resize`, `mousemove`, `mouseleave`, `touchmove`, `click` no cleanup.
- Limpar os `setTimeout` da animação do título (o array `timers` e `idleTimer` já
  existem exatamente para isso — só falta expor um `destroy`).
- O canvas deve receber a referência via `ref`, não `getElementById`.
- **Manter o loop de desenho como JS imperativo puro.** Não converta barras,
  partículas ou buckets em estado de componente nem em elementos — são milhares de
  entidades por quadro.

Sugestão de forma: um único componente `<SpectrumHero />` que monta o canvas e roda
o IIFE atual quase intocado dentro de um `useEffect`, retornando a função de limpeza.
O CSS vira um módulo. O título pode virar JSX com spans, mas a lógica de
escrita/apagamento continua imperativa.

---

## Como verificar que não quebrou

Quatro checagens que pegam praticamente qualquer regressão:

1. **Cursor no topo da tela, sacudindo rápido** → a onda **não** reage.
   Mediana ~12px de meia-altura. Se reagir, o piso de `vitality` voltou.
2. **Cursor sobre a faixa** → resposta forte e localizada, pico ~154px.
3. **Clique na faixa** → agulha fina no ponto (~417px), e a energia se abre pros
   dois lados como um pente que se separa ao longo de ~2s.
4. **Textura** → linhas horizontais contínuas, não grade. Se aparecer
   quadriculado, o vão horizontal entre barras voltou.

Referência de custo na máquina de teste: 16.7ms por quadro, p95 igual, em
1440×900 e em 390×844.
