# Instalador macOS (pkgbuild)

Gera um único arquivo `.pkg` que instala a extensão TaqCITi.

## Pré-requisitos

- Command Line Tools da Apple instaladas (trazem `pkgbuild`/`productbuild`):
  `xcode-select --install`. Em runners `macos-latest` do GitHub Actions isso já
  vem pronto — não precisa instalar nada.
- Node.js + dependências do projeto já instaladas (`npm install` na raiz).

## Compilar

A partir de qualquer diretório:

```bash
bash installer/macos/build-installer.sh
```

O script builda o projeto (`npm run build`), monta um payload com `dist/` + o
guia visual, e empacota tudo com `pkgbuild` em
`release/taqciti-instalador-mac-<versão>.pkg`.

A versão usada no nome do arquivo vem do `package.json` por padrão. Para
forçar outra (ex.: para casar com uma tag do Git), defina `APP_VERSION`:

```bash
APP_VERSION=0.1.0 bash installer/macos/build-installer.sh
```

## ⚠️ Aviso do Gatekeeper — esperado, não é bug

Este `.pkg` **não é assinado** com um certificado de desenvolvedor Apple
(exigiria conta paga, fora do escopo desta fase). Isso significa que dando
duplo-clique nele, o Gatekeeper vai bloquear com algo como:

> "TaqCITi.pkg" não pode ser aberto porque é de um desenvolvedor não
> identificado.

**Isso é esperado.** Não tentamos contornar via assinatura de código por
enquanto. A instrução para quem for instalar:

1. Clique com o **botão direito** (ou Control+clique) no arquivo `.pkg`.
2. Escolha **Abrir**.
3. Na janela de aviso que aparece, clique em **Abrir** de novo.

Só precisa fazer isso na primeira vez que abrir aquele arquivo específico.
Depois disso o instalador roda normalmente (ainda vai pedir a senha de admin —
isso é padrão de qualquer `.pkg`, assinado ou não).

Essa mesma instrução também aparece no guia visual (`installer/guide/index.html`)
quando ele detecta que está rodando num Mac.

## O que o instalador faz

O `postinstall` roda como **root** (padrão de qualquer instalação de `.pkg` no
macOS, mesmo sem exigir permissões especiais do conteúdo em si). Por isso ele
primeiro descobre o usuário de console real — via `stat -f "%Su" /dev/console`
— e usa `launchctl asuser <uid> sudo -u <usuário> <comando>` para qualquer
ação que precise "aparecer" na sessão gráfica dessa pessoa (comentários
detalhados sobre o porquê estão no topo de `installer/macos/postinstall`).

1. Copia os arquivos para `~/Desktop/TaqCITi (não apagar)/` do usuário de
   console. Se `~/Desktop` não existir, usa `~/TaqCITi (não apagar)/` e avisa
   o motivo no log da instalação.
2. Ajusta o dono (`chown`) dos arquivos copiados para esse usuário — o `cp`
   anterior rodou como root, então sem isso o Chrome não conseguiria nem ler
   os arquivos.
3. Copia esse caminho para a área de transferência via `pbcopy`, rodado no
   contexto do usuário. Se falhar, só avisa e imprime o caminho — não derruba
   a instalação.
4. Abre o Google Chrome (`/Applications/Google Chrome.app`) em
   `chrome://extensions`, no contexto do usuário. Se o Chrome não estiver
   instalado, tenta abrir esse endereço no navegador padrão do sistema via
   `open` — sem falhar o instalador se isso não tiver efeito.
5. Abre o guia visual (`installer/guide/index.html`) com o caminho já
   preenchido, numa cópia salva em
   `~/Library/Application Support/TaqCITi/guide/`.

## Testar localmente

```bash
open release/taqciti-instalador-mac-<versão>.pkg
```

(ou clique com o botão direito → Abrir, pelo motivo do Gatekeeper explicado
acima).
