# Roteiro de teste do `.pkg` — para quem tem um Mac

Leva uns 10 minutos. Não precisa saber nada do projeto.

Este é o teste que falta. O instalador do macOS **nunca foi executado num
Mac** — e, nesta revisão, nem sequer chegou a ser compilado ainda: existe um
runner macOS configurado no CI, mas nenhuma run passou por ele. Windows e Linux
já foram compilados e instalados de verdade; o macOS, nenhum dos dois.

Se algo não bater com o que está escrito aqui, é um defeito — anote e devolva.

---

## Onde pegar o instalador

Na página **Actions** do repositório, abra a run mais recente do workflow
**Release** e baixe o artefato **`macos-installer`**. Ele vem num zip; dentro
está o `taqciti-instalador-mac-<versão>.pkg`.

> Se não houver run recente: **Actions → Release → Run workflow**, deixe
> **publicar desmarcado** e rode. Isso compila os três instaladores e **não**
> publica nada — nem GitHub Release, nem Drive.

Não compile o `.pkg` na sua própria máquina para este teste: sem as variáveis
de release configuradas, a extensão sai apontando para `localhost` e o envio do
documento não funciona (a captura em si continua funcionando).

---

## 1. Abrir, e passar pelo bloqueio

Dê **dois cliques** no `.pkg`. É esperado que o macOS bloqueie: o pacote não é
assinado com certificado pago da Apple.

- [ ] Apareceu um aviso de **desenvolvedor não identificado**? Feche-o.
- [ ] **Ajustes do Sistema → Privacidade e Segurança**, role até o fim, clique
      em **Abrir Mesmo Assim**, e em **Abrir** no aviso que volta.
- [ ] Em macOS 14 ou anterior, Control+clique no arquivo → **Abrir** também
      resolve. No macOS 15+ esse atalho não libera mais.

> **Pare e avise** se a mensagem for outra — por exemplo *"está danificado e não
> pode ser aberto"*. Isso não é o bloqueio por desenvolvedor não identificado, e
> liberar nos Ajustes não resolve. Mande o texto exato.

**Não desligue a proteção do Mac por Terminal.** Não é necessário.

## 2. Instalar

- [ ] Pediu a senha de administrador? É o normal de qualquer `.pkg`.
- [ ] Terminou na tela de conclusão, sem falha?

Se falhar: menu **Janela → Registro do Instalador**, procure linhas com
`[TaqCITi postinstall]` e mande o trecho.

## 3. O guia abre sozinho

- [ ] Uma aba abriu no seu navegador padrão, com o guia do TaqCiti?

Se não abriu, a instalação pode ter dado certo assim mesmo. Abra à mão:
`~/Library/Application Support/TaqCITi/guide/COMECE_AQUI.html`

## 4. O caminho exibido e copiado — **a parte mais importante**

No guia, escolha **Mac** e avance até **"Localize a pasta preparada"**.

- [ ] Aparece um caminho de verdade, e não o texto "Pasta gerada pelo
      instalador"?
- [ ] O caminho é `/Users/<você>/Desktop/TaqCITi (não apagar)`?
      (Sem Área de Trabalho, ele usa `/Users/<você>/TaqCITi (não apagar)` — as
      duas formas estão certas.)
- [ ] **Os acentos estão legíveis?** `não apagar` tem que aparecer assim, não
      como `nÃ£o` nem `n?o`.
- [ ] Clique em **Copiar caminho** e cole em qualquer lugar. Veio igual?

> Se o seu nome de usuário do Mac tiver acento, cedilha ou espaço, este teste
> vale o dobro — é exatamente o caso que já falhou antes.

## 5. Carregar no Chrome

- [ ] Aba nova → cole `chrome://extensions` → Enter.
- [ ] Ligue **Modo do desenvolvedor** (canto superior direito).
- [ ] **Carregar sem compactação** → na janela, **Cmd+Shift+G**, cole o caminho,
      Enter, e selecione **a pasta** (não um arquivo).
- [ ] Apareceu o cartão **TaqCITi Standalone**, versão igual à do nome do
      arquivo `.pkg`, com o ID `jalebpaefejnbacgncgkailhemkdpnhm`?
- [ ] O cartão está **sem** o botão vermelho "Erros"?

## 6. Captura no Meet

- [ ] Abra uma reunião de teste no Google Meet.
- [ ] Ligue as **legendas** do próprio Meet e confira o idioma.
- [ ] Fale uma frase e veja se ela aparece no painel do TaqCiti.

O painel aparece como uma cápsula no lado direito da página; clique nela para
abrir. Se você já estava com o Meet aberto antes de carregar a extensão,
**recarregue a página** antes de testar.

---

## O que devolver

Marque os itens acima e mande junto:

1. A versão do macOS (menu  → Sobre Este Mac).
2. O caminho exibido no passo 4, copiado e colado.
3. O conteúdo deste arquivo:
   ```bash
   cat ~/Library/Application\ Support/TaqCITi/guide/install-path.js
   ```
4. Se algo falhou: o texto exato da mensagem, e em qual passo.

Se quiser desfazer tudo depois: apague a pasta `TaqCITi (não apagar)`, remova a
extensão pelo cartão em `chrome://extensions`, e apague
`~/Library/Application Support/TaqCITi`.
