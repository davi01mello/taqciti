# Como instalar a extensão TaqCITi no Chrome

Siga esses 5 passos. Leva menos de 2 minutos.

## 1. Baixe o arquivo

Você vai receber um arquivo chamado algo como `taqciti-v0.1.0.zip`. Salve ele em
qualquer pasta do seu computador (por exemplo, na área de trabalho).

## 2. Descompacte o arquivo

Clique com o botão direito no arquivo `.zip` e escolha **"Extrair tudo..."**
(ou "Descompactar"). Isso vai criar uma pasta com o mesmo nome, contendo os
arquivos da extensão.

> Guarde essa pasta em um lugar fixo — não é possível apagar ou mover a pasta
> depois de instalar a extensão sem que ela pare de funcionar.

## 3. Abra a página de extensões do Chrome

Copie e cole este endereço na barra de endereços do Chrome e aperte Enter:

```
chrome://extensions
```

## 4. Ative o "Modo do desenvolvedor"

No canto superior direito da página, tem um botão/interruptor chamado
**"Modo do desenvolvedor"**. Clique para ativar.

## 5. Carregue a extensão

Com o "Modo do desenvolvedor" ativado, vão aparecer novos botões no topo da
página. Clique em **"Carregar sem compactação"** e selecione a pasta que você
descompactou no passo 2 (não o arquivo `.zip`, a pasta).

Pronto! A extensão TaqCITi vai aparecer na lista e já está pronta para uso.

---

### Perguntas frequentes

**Preciso repetir esses passos toda vez que abrir o Chrome?**
Não. Depois de carregada, a extensão fica instalada normalmente, como
qualquer outra.

**Recebi uma versão nova. O que eu faço?**
Descompacte o novo arquivo `.zip` em uma pasta separada, vá em
`chrome://extensions`, remova a versão antiga (botão "Remover") e repita o
passo 5 apontando para a pasta nova.

**O Chrome mostra um aviso dizendo que o "Modo do desenvolvedor" pode ser
perigoso. É normal?**
Sim. Esse aviso aparece para qualquer extensão carregada dessa forma (fora da
Chrome Web Store) e não indica nenhum problema com a TaqCITi.

**O Chrome avisa que a extensão pode "ler e alterar todos os seus dados nos
sites que você visita". Por quê?**
Porque o TaqCITi é uma janela flutuante que precisa continuar disponível
enquanto você navega — o botão fica à mão em qualquer página, não só dentro do
Google Meet. Para desenhar essa janela por cima de uma página, o Chrome exige
acesso a essa página, e não existe permissão mais estreita que signifique
"desenhar por cima, sem ler nada".

Na prática, o que a extensão faz com esse acesso é: desenhar o próprio painel e,
**apenas em `meet.google.com`**, ler as legendas da reunião. Nenhuma outra página
é lida, e nada sai do seu computador — o histórico fica todo em armazenamento
local, sem backend nenhum.

Se preferir não conceder isso, é possível restringir o acesso pela própria
página `chrome://extensions` → TaqCITi → **Detalhes** → **Acesso ao site**,
escolhendo "Em sites específicos" e deixando só `meet.google.com`. O TaqCITi
continua gravando reuniões normalmente; o que se perde é o botão nas outras
páginas.
