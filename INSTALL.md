# Como instalar a extensão TaqCITi

A extensão funciona tanto no **Google Chrome** quanto no **Microsoft Edge**
(os dois são baseados em Chromium e carregam extensões do mesmo jeito) — em
Windows, macOS ou Linux.

Existem dois caminhos:

- **Instalador automático** (recomendado) — um `.exe` (Windows), `.pkg`
  (macOS) ou `.run` (Linux) que copia os arquivos pra você e abre um guia
  visual com o passo a passo já preenchido.
- **Instalação manual** — baixar o `.zip` da extensão e carregar a pasta
  direto no navegador. Útil se você não recebeu um instalador, ou prefere
  não rodar um executável.

Os dois entregam a mesma extensão; a diferença é só o quanto de trabalho o
instalador automático faz por você.

---

## 1. Instalador automático (recomendado)

Pegue o arquivo certo pro seu sistema — `taqciti-instalador-windows-*.exe`,
`taqciti-instalador-mac-*.pkg` ou `taqciti-instalador-linux-*.run` — com
quem te enviou o link (GitHub Release ou pasta do Drive do time).

### Windows

1. Dê duplo-clique no `.exe`.
2. **Se você tiver Chrome e Edge instalados**, o instalador pergunta qual
   dos dois usar — escolha e clique em "Avançar". Se só tiver um dos dois,
   ele segue direto com esse, sem perguntar nada.
3. A instalação é silenciosa: sem tela de licença, sem escolha de pasta. Ao
   terminar, uma aba abre no navegador escolhido com o guia visual — os
   dois passos finais (ativar o "Modo do desenvolvedor" e "Carregar sem
   compactação") já vêm com o caminho da pasta preenchido e copiado pra
   área de transferência.

> O Windows SmartScreen pode avisar "Windows protegeu o seu PC" — é
> esperado, o `.exe` não tem certificado de assinatura de código. Clique em
> "Mais informações" → "Executar assim mesmo".

### macOS

1. Dê duplo-clique no `.pkg`.
2. **É esperado que o Gatekeeper bloqueie na primeira vez**, com algo como
   `"TaqCITi.pkg" não pode ser aberto porque é de um desenvolvedor não
   identificado` — não é um problema com o arquivo, é só a ausência de uma
   assinatura de desenvolvedor Apple (conta paga, fora do escopo atual).
   Para contornar:
   1. Clique com o **botão direito** (ou Control+clique) no arquivo `.pkg`.
   2. Escolha **Abrir**.
   3. Na janela de aviso que aparece, clique em **Abrir** de novo.
   4. Só precisa fazer isso na primeira vez que abrir *esse* arquivo
      específico — versões futuras do instalador vão pedir de novo, porque
      cada arquivo é avaliado à parte.
3. O instalador vai pedir a senha do seu usuário (padrão de qualquer
   `.pkg`, assinado ou não) e depois abre o guia visual com o passo a
   passo preenchido, no navegador que já é o padrão do seu Mac.

### Linux

1. Dê permissão de execução e rode:
   ```bash
   chmod +x taqciti-instalador-linux-*.run
   ./taqciti-instalador-linux-*.run
   ```
2. Copia os arquivos, copia o caminho pra área de transferência (se
   `xclip` ou `xsel` estiverem instalados) e abre o guia visual no
   navegador padrão do sistema.

---

## 2. Instalação manual (a partir do `.zip`)

Vale nos três sistemas operacionais e nos dois navegadores — só muda o
endereço da página de extensões.

### 1. Baixe e descompacte

Salve o `taqciti-vX.X.X.zip` numa pasta fixa do computador (ex.: área de
trabalho) e extraia. **Não apague nem mova essa pasta depois** — é dela
que o navegador vai ler os arquivos direto; movê-la ou apagá-la quebra a
extensão.

### 2. Abra a página de extensões do seu navegador

| Navegador | Endereço |
|---|---|
| Google Chrome | `chrome://extensions` |
| Microsoft Edge | `edge://extensions` |

Copie e cole o endereço correspondente na barra de endereços e aperte
Enter.

### 3. Ative o "Modo do desenvolvedor"

- **Chrome**: interruptor no canto superior direito da página.
- **Edge**: interruptor na barra lateral esquerda da página.

### 4. Carregue a extensão

Com o modo do desenvolvedor ativo, clique em **"Carregar sem
compactação"** (o texto do botão é o mesmo nos dois navegadores) e
selecione a pasta que você descompactou no passo 1 — a pasta em si, não o
arquivo `.zip`.

Pronto! A extensão TaqCITi vai aparecer na lista e já está pronta para uso.

---

### Perguntas frequentes

**Preciso repetir esses passos toda vez que abrir o navegador?**
Não. Depois de carregada, a extensão fica instalada normalmente, como
qualquer outra.

**Recebi uma versão nova. O que eu faço?**
Descompacte o novo arquivo `.zip` em uma pasta separada, vá na página de
extensões do seu navegador, remova a versão antiga (botão "Remover") e
repita o passo 4 apontando para a pasta nova.

**O navegador mostra um aviso dizendo que o "Modo do desenvolvedor" pode
ser perigoso. É normal?**
Sim. Esse aviso aparece para qualquer extensão carregada dessa forma (fora
da loja oficial) e não indica nenhum problema com a TaqCITi.

**O navegador avisa que a extensão pode "ler e alterar todos os seus dados
nos sites que você visita". Por quê?**
Porque o TaqCITi é uma janela flutuante que precisa continuar disponível
enquanto você navega — o botão fica à mão em qualquer página, não só dentro
do Google Meet. Para desenhar essa janela por cima de uma página, o
navegador exige acesso a essa página, e não existe permissão mais estreita
que signifique "desenhar por cima, sem ler nada".

Na prática, o que a extensão faz com esse acesso é: desenhar o próprio painel e,
**apenas em `meet.google.com`**, ler as legendas da reunião. Nenhuma outra página
é lida, e nada sai do seu computador — o histórico fica todo em armazenamento
local, sem backend nenhum.

Se preferir não conceder isso, é possível restringir o acesso pela própria
página de extensões do navegador → TaqCITi → **Detalhes** → **Acesso ao
site**, escolhendo "Em sites específicos" e deixando só `meet.google.com`.
O TaqCITi continua gravando reuniões normalmente; o que se perde é o botão
nas outras páginas.
