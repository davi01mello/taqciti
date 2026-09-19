# Origem do guia de instalação

Esta pasta é a **origem do guia no projeto**. O que estiver aqui como
`COMECE_AQUI*.html` é o guia que vai para o pacote distribuído e para dentro
dos três instaladores. Para trocar o guia, substitua o arquivo — não há outro
lugar para editar.

```
assetsingestion/COMECE_AQUI.html   ← a origem (este arquivo)
        │
        ├─ pacote:      TaqCiti/COMECE_AQUI.html        (raiz do ZIP)
        └─ instalador:  <pasta do sistema>/COMECE_AQUI.html + install-path.js
```

O HTML é autossuficiente: CSS, arte de fundo e script já vivem dentro dele.
Não há passo de build, bundler nem cópia de recursos — "incorporar" é copiar o
arquivo. `Mozartear.png` é a arte de origem do fundo, guardada para referência;
ela já está embutida no HTML como data URI e não é lida por nenhum script.

## O que é preenchido, e quando

O guia tem exatamente dois pontos de integração, e eles acontecem em momentos
diferentes de propósito.

| Valor | Quem preenche | Quando |
| --- | --- | --- |
| Nome dos instaladores | `scripts/package-distribution.mjs` | ao montar o pacote |
| Caminho da extensão | o instalador, via `install-path.js` | na máquina de quem instala |

**Os nomes dos instaladores** entram por substituição de marcador
(`__ARQUIVO_WINDOWS__`, `__ARQUIVO_MACOS__`) e são seguros de fixar no pacote:
são os arquivos que estão entrando naquele mesmo ZIP. Se a substituição não
acontecer — abrindo este arquivo cru, por exemplo — o guia detecta o marcador e
cai num texto genérico em vez de mostrar o marcador na tela.

**O caminho da extensão não pode vir daqui.** A pasta só existe depois que o
instalador roda, e o caminho é da máquina de quem instala:
`~/Desktop/TaqCITi (não apagar)`, com o nome de usuário real e, no Windows,
possivelmente redirecionada pelo OneDrive. Injetar qualquer coisa no job seria
gravar um caminho da máquina de build. Então:

1. o instalador copia este HTML, **sem tocar nele**, para uma pasta por usuário;
2. grava ao lado um `install-path.js` com o caminho real;
3. abre essa cópia no navegador.

O guia carrega `install-path.js` se existir. Sem ele — que é o caso da cópia
dentro do ZIP — a etapa da pasta mostra um texto neutro e explica que o
instalador vai abrir esta mesma página já preenchida. Nenhum caminho é
inventado em momento algum.

```js
// o que o instalador grava
window.TAQCITI_INSTALACAO = { sistema: "windows", pasta: "C:\u005cUsers\u005c..." };
```

## Codificação: por que o caminho já apareceu torto

O guia é copiado byte a byte e **nunca reescrito** por nenhum instalador. Essa
é a regra que resolve o problema, e ela tem história:

- **Windows.** O caminho era montado com `Utf8Encode(...)` concatenado a
  literais e guardado num `AnsiString`. No Inno Unicode os literais são
  `String` (UTF-16), então a expressão misturada alarga os bytes UTF-8 pela
  code page ANSI ativa e os estreita de volta na atribuição. Em CP-1252 isso
  sobrevive por acaso; fora dela, e para os bytes que a CP-1252 não define
  (`0x81`, `0x8d`, `0x8f`, `0x90`, `0x9d`), não sobrevive — vira `?` ou
  caractere trocado. Hoje `EscapeParaJs` emite `\uXXXX` e o arquivo sai 100%
  ASCII, que é idêntico em qualquer code page: o problema deixa de existir em
  vez de ser contornado.
- **macOS e Linux.** O HTML era reescrito por `sed` a cada instalação. Funciona
  em bytes, mas carregar 4 MB de página para inserir uma linha é desperdício, e
  reescrever a página é justamente por onde um acento se perde. Agora os dois
  gravam `install-path.js` em UTF-8 cru e copiam o HTML intocado.

Do lado do navegador, um `<script src>` sem `charset` próprio herda a
codificação do documento — e o guia declara `<meta charset="utf-8">`. Isso foi
conferido nos três casos: arquivo em UTF-8 lê certo; em CP-1252 vira `�`; em
UTF-8 duplo vira `Ã£`.

## Regras para qualquer mudança no guia

- **Abre por `file://`, offline.** Sem CDN, sem fonte externa, sem `fetch`. Os
  dois links `https://` que existem são leitura opcional, em `target="_blank"`;
  nada do que a página desenha depende deles.
- **É uma página, não um instalador.** HTML aberto por `file://` não executa
  programa nenhum, e nenhum botão pode sugerir que executa.
- **Não afirma ter detectado nada.** Os avanços são a pessoa confirmando o que
  viu na própria tela.
- **Caminho é texto.** Entra por `esc()` e é lido de volta por `textContent` na
  hora de copiar — aparece e é copiado como texto puro, com espaços e acentos
  preservados, nunca interpretado como HTML ou comando.
- **Nada de tela inventada.** As instruções têm que sair do comportamento real
  de `installer/windows/taqciti.iss`, `installer/macos/postinstall` e
  `installer/linux/install.sh`.

## Revisar sem montar o pacote inteiro

```bash
node scripts/package-distribution.mjs --somente-guia --saida release/preview-guia
```

Gera o guia com nomes de instalador de exemplo e imprime o caminho do arquivo —
abra com dois cliques. Para ver a etapa da pasta com um caminho preenchido,
grave um `install-path.js` ao lado dele com o conteúdo do bloco acima.
