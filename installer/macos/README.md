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
enquanto. A instrução para quem for instalar, que é a que a Apple documenta
hoje ([Abrir apps com segurança no
Mac](https://support.apple.com/pt-br/102445)):

1. Dê dois cliques no `.pkg` e deixe o aviso aparecer.
2. Abra **Ajustes do Sistema** → **Privacidade e Segurança**, role até o fim.
3. Clique em **Abrir Mesmo Assim** — o botão traz o nome do arquivo bloqueado,
   e só existe por um tempo depois da tentativa.
4. No aviso que volta, clique em **Abrir**.

> ⚠️ **O Control+clique não serve mais como instrução principal.** Era o
> caminho antigo (clicar no arquivo segurando Control → **Abrir**), e continua
> funcionando em **macOS 14 ou anterior**. A partir do **macOS 15 (Sequoia)**
> a Apple removeu esse atalho como forma de liberar software sem assinatura —
> ver [Updates to runtime protection in macOS
> Sequoia](https://developer.apple.com/news/?id=saqachfa). Documentar só o
> Control+clique hoje mandaria metade do time para um caminho que não
> funciona.

Só precisa fazer isso na primeira vez que abrir aquele arquivo específico.
Depois disso o instalador roda normalmente (ainda vai pedir a senha de admin —
isso é padrão de qualquer `.pkg`, assinado ou não).

Essa mesma instrução aparece no guia de pré-instalação
(`installer/guide/comece-aqui.template.html`), num passo dedicado, que também
separa esse bloqueio de outros erros (`"está danificado"`, falha de instalação)
— porque para esses o caminho dos Ajustes não resolve nada.

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
   anterior rodou como root, então sem isso o navegador (Chrome ou Edge)
   não conseguiria nem ler os arquivos.
3. Copia esse caminho para a área de transferência via `pbcopy`, rodado no
   contexto do usuário. Se falhar, só avisa e imprime o caminho — não derruba
   a instalação.
4. Abre o guia visual (`installer/guide/index.html`) com o caminho já
   preenchido, numa cópia salva em
   `~/Library/Application Support/TaqCITi/guide/`, no contexto do usuário.

> **Não abre a página de extensões do navegador sozinho** (essa etapa
> existia aqui antes, via `open -a "Google Chrome" chrome://extensions`).
> Em testes reais isso nunca funcionou — o navegador parece
> filtrar/ignorar esses esquemas de URL internos recebidos via linha de
> comando de um processo externo, por segurança, independente do sistema
> operacional. O guia (que se adapta sozinho ao navegador padrão do
> usuário, detectado por `navigator.userAgent`) orienta a pessoa a abrir
> uma aba nova e colar o endereço certo (já copiado por um botão dedicado
> nele).

## Testar localmente

```bash
open release/taqciti-instalador-mac-<versão>.pkg
```

(ou clique com o botão direito → Abrir, pelo motivo do Gatekeeper explicado
acima).
