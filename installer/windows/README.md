# Instalador Windows (Inno Setup)

Gera um `.exe` único que instala a extensão TaqCITi sem precisar descompactar
nada manualmente.

## Pré-requisitos

- [Inno Setup 6](https://jrsoftware.org/isdl.php) instalado (traz o `ISCC.exe`,
  o compilador de linha de comando).
- Node.js + dependências do projeto já instaladas (`npm install` na raiz).

## Compilar

Rode os dois comandos a partir da **raiz do repositório**:

```bash
npm run build
```

```bat
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\windows\taqciti.iss
```

O `.exe` é gerado em `release\taqciti-instalador-windows-<versão>.exe`.

Por padrão a versão embutida no instalador é `0.0.0`. Para embutir a versão
real do `package.json` (ou de uma tag), passe `/D`:

```bat
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" /DAppVersion=0.1.0 installer\windows\taqciti.iss
```

> Se `ISCC.exe` estiver no `PATH`, basta `ISCC installer\windows\taqciti.iss`.

## O que o instalador faz

0. Antes de qualquer coisa, procura o **Google Chrome especificamente**
   (não "o navegador padrão" — a extensão só funciona no Chrome de
   qualquer forma). Se não encontrar em nenhum dos lugares de sempre
   (registro `App Paths` em HKLM/HKCU, depois `Program Files`,
   `Program Files (x86)` e `%LOCALAPPDATA%`), mostra um aviso com o link
   pra baixar o Chrome e **aborta a instalação inteira** — nada é
   copiado.
1. Instala silenciosamente (sem tela de licença, sem escolha de pasta) em
   `%USERPROFILE%\Desktop\TaqCITi (não apagar)\`.
2. Copia esse caminho para a área de transferência.
3. Abre o Chrome (o mesmo executável encontrado no passo 0) em
   `chrome://extensions`.
4. Abre o guia visual (`installer/guide/index.html`) com o caminho já
   preenchido, numa cópia salva em `%LOCALAPPDATA%\TaqCITi\guide\`, também
   no Chrome.

Não é necessário desinstalar entre versões: rodar o instalador de novo
sobrescreve os arquivos na mesma pasta.

## Observações

- O `.exe` não é assinado digitalmente — o Windows SmartScreen pode exibir um
  aviso ("Windows protegeu o seu PC") no primeiro uso. É esperado sem um
  certificado de assinatura de código; o usuário pode clicar em "Mais
  informações" → "Executar assim mesmo".
- A pasta de instalação fica na Área de Trabalho porque é onde o Chrome vai
  ler os arquivos direto (`Carregar sem compactação`). Mover, renomear ou
  apagar essa pasta depois quebra a extensão.
