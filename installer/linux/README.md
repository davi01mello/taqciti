# Instalador Linux (makeself)

Gera um único arquivo `.run` autoextraível que instala a extensão TaqCITi.

## Pré-requisitos

- `makeself` instalado: `sudo apt-get install -y makeself` (Debian/Ubuntu) ou
  veja https://github.com/megastep/makeself.
- Node.js + dependências do projeto já instaladas (`npm install` na raiz).

## Compilar

A partir de qualquer diretório:

```bash
bash installer/linux/build-installer.sh
```

O script builda o projeto (`npm run build`), empacota `dist/` + `install.sh` +
o guia visual, e gera `release/taqciti-instalador-linux-<versão>.run`.

A versão usada no nome do arquivo vem do `package.json` por padrão. Para
forçar outra (ex.: para casar com uma tag do Git), defina `APP_VERSION`:

```bash
APP_VERSION=0.1.0 bash installer/linux/build-installer.sh
```

## O que o instalador faz

Depois que o usuário der `chmod +x taqciti-instalador-linux-<versão>.run` e
rodar `./taqciti-instalador-linux-<versão>.run` (esse `chmod` é uma etapa
manual inevitável — proteção do próprio sistema contra rodar arquivos
baixados como executáveis sem confirmação explícita):

1. Copia os arquivos para `~/Desktop/TaqCITi (não apagar)/`. Se `~/Desktop`
   não existir, usa `~/TaqCITi (não apagar)/` e avisa o motivo no terminal.
2. Copia esse caminho para a área de transferência via `xclip` ou `xsel`, se
   algum dos dois estiver instalado. Se nenhum estiver, só imprime o caminho
   no terminal — não falha a instalação.
3. Abre o guia visual (`installer/guide/index.html`) com o caminho já
   preenchido, numa cópia salva em `~/.local/share/taqciti/guide/` (via
   `xdg-open`).

> **Não abre `chrome://extensions` sozinho** (essa etapa existia aqui
> antes). Em testes reais isso nunca funcionou — o Chrome parece
> filtrar/ignorar URLs `chrome://` recebidas via linha de comando de um
> processo externo, por segurança, independente do sistema operacional. O
> guia orienta a pessoa a abrir uma aba nova e colar o endereço (já
> copiado por um botão dedicado nele).

## Testar localmente

```bash
chmod +x release/taqciti-instalador-linux-<versão>.run
./release/taqciti-instalador-linux-<versão>.run
```
