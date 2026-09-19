# Os dois guias do TaqCITi

Esta pasta tem **dois** guias, que aparecem em momentos diferentes e não se
substituem.

| Arquivo | Quando aparece | Quem abre | O que sabe |
| --- | --- | --- | --- |
| `comece-aqui.template.html` | **antes** de instalar | a pessoa, com dois cliques, depois de extrair o ZIP | os nomes dos instaladores e a versão do pacote |
| `index.html` | **depois** de instalar | o próprio instalador | o caminho real onde a extensão foi copiada |

## `comece-aqui.template.html` — o guia de pré-instalação

É o `COMECE AQUI.html` que fica na raiz do pacote de distribuição. Cobre os
cinco passos, um de cada vez: achar o instalador do seu sistema, passar pelo
aviso do sistema operacional, deixar o instalador terminar, carregar a extensão
no navegador (à mão, porque o Chrome exige) e conferir que funcionou.

É um **template**: `scripts/package-distribution.mjs` troca os marcadores pela
versão, pelos nomes reais dos três instaladores e pelas imagens em data URI, e
grava o resultado como `TaqCITi/COMECE AQUI.html` dentro do ZIP.

Para revisar o visual sem ter os três instaladores em mãos:

```bash
node scripts/package-distribution.mjs --somente-guia --saida release/preview-guia
```

O comando imprime o caminho do arquivo gerado — abra com dois cliques. Os nomes
de instalador ali são de exemplo; num pacote de verdade eles vêm dos arquivos
encontrados.

> Abrir o **template** direto também funciona, e é útil para mexer no CSS sem
> reempacotar: onde faltaria valor, o script embutido cai em texto neutro em vez
> de mostrar o marcador cru. O que não aparece assim são a marca e o ícone, que
> só existem depois da substituição.

## `index.html` — o guia de pós-instalação

Este é copiado para dentro do instalador de cada sistema e aberto por ele no
fim da instalação, já com o caminho de instalação preenchido — cada plataforma
preenche de um jeito (`WriteInstallPathScript` no Inno Setup do Windows, `sed`
no Linux e no macOS). Ver os comentários no topo de cada instalador.

Ele cobre só a parte do navegador, porque é a única que sobra naquele ponto.

## Regras que valem para os dois

- **Abrem por `file://`, offline.** Sem CDN, sem fonte externa, sem `fetch`.
- **São páginas, não instaladores.** HTML aberto por `file://` não executa
  programa nenhum, e nenhum botão pode sugerir que executa.
- **Nada de tela inventada.** Toda instrução tem que sair do comportamento real
  de `installer/windows/taqciti.iss`, `installer/macos/postinstall` e
  `installer/linux/install.sh`. Quando o texto exato de uma mensagem do sistema
  não é conhecido com certeza, descreva o que aparece em vez de fingir uma
  citação.
- **Não afirmam ter detectado nada.** Os botões de avanço são a pessoa dizendo
  que deu certo. O guia não tem como ver a tela dela.
