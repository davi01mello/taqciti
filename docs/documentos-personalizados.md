# Documentos personalizados no padrão CITi

Estado em 08/10/2026. Quem pede um documento em linguagem natural recebe um PDF
(e um Word) com estrutura montada para o pedido, no padrão visual do CITi, só com
o que as reuniões escolhidas sustentam — e pode alterá-lo por pedido, com
histórico de versões.

## Como funciona

```
pedido + reuniões ──► redator (1 chamada) ──► ContentTree ──► compilador ──► PDF / DOCX
                         │                       ▲                │
                         └─ citações literais ───┘                └─ manifesto + relatório
```

- **A árvore é a fonte de verdade.** Blocos com `blockId` estável: capa, título,
  parágrafo, lista, tabela, imagem, referência, sumário, quebra de seção. O PDF e
  o DOCX saem dela; a extensão guarda só a árvore (o arquivo é refeito pelo
  servidor, sem modelo, em `/api/documentos/renderizar`).
- **Sustentação em código.** Um bloco `fato` só entra se uma citação dele existe,
  literalmente, numa fonte selecionada. Sem isso ele sai do documento e vira
  problema no relatório. Recomendação nunca vira fato. A capa (cliente, autor,
  data) vem da pessoa, não do modelo.
- **Edição por patch.** `substituir` / `remover` / `inserir_depois` sobre blockIds,
  com a revisão esperada (409 se mudou). O escopo selecionado na tela é imposto:
  fora dele, o servidor recusa. Bloco escrito por uma pessoa e não selecionado não
  é tocado. A capa não pode ser removida.
- **Perfil.** `server/lib/documentos/perfil.ts`: identidade documental versionada,
  com proveniência por regra. Variantes `ata` (modelo da Ata) e `editorial`
  (medida da Apostila Unit Economics). **Provisório**: nenhum responsável do CITi
  o validou. Fonte ausente sem substituição autorizada bloqueia a variante.

## Rotas (servidor)

| Rota | O que faz | Modelo |
| --- | --- | --- |
| `POST /api/documentos/gerar` | pedido + fontes → árvore, PDF, manifesto, relatório | sim (`leitor`, prompt `redator/v1`) |
| `POST /api/documentos/editar` | árvore + pedido (+ escopo) → patch aplicado, PDF novo | sim (prompt `redator/v2`) |
| `POST /api/documentos/renderizar` | árvore → PDF e/ou DOCX | não |

Mesma tranca de `/api/generate` (`x-docciti-key`). 400 entrada inválida · 401 chave ·
409 revisão desatualizada · 413 fontes longas · 422 nada sustentado / árvore
inválida · 502 provedor.

## Na extensão

- **Gerar:** HOME → reunião → *Criar documento* → texto livre → *Gerar com o padrão
  CITi* (a reunião aberta é a única fonte). Ou pedir ao Taq: `create_custom_document`
  (relatório, proposta, parecer, plano de ação, manual, briefing, memorando).
- **Abrir:** Documentos → o documento: prévia do PDF real, escopo (capa / seção /
  tudo), *Pedir alteração*, *Baixar PDF*, *Baixar Word*, *Versões* (ver e restaurar;
  restaurar cria versão nova).
- **Armazenamento:** `chrome.storage.local` (`taq:documentVersions`), até 30
  versões por documento. **Só no navegador**: limpar os dados do navegador apaga o
  histórico.

## Limites (ditos de propósito)

- Padrão CITi **provisório**; Neue Haas Display substituída por Barlow e a fonte dos
  rótulos técnicos por JetBrains Mono, ambas **autorizadas** em 08/10/2026 e
  registradas no perfil.
- **Word:** a fonte Barlow precisa estar instalada; a capa é tipográfica (sem a arte
  de fundo); o sumário é campo do Word, atualizado ao abrir; edição feita no Word
  **não volta** ao TaqCiti. **Nunca foi aberto no Word** (não há Word nem LibreOffice
  na máquina de desenvolvimento): a verificação é estrutural, no XML do pacote.
- **Imagens:** só ativos aprovados do perfil; não há envio de imagem pela pessoa.
- **Relatório de qualidade:** sustentação das citações, estrutura e layout medido por
  código (página quase vazia, título no pé, sobra na última página). **Não há revisor
  visual por modelo**: sobreposição, contraste e glifos não são checados.
- Fontes: só reuniões (transcrição). Outros documentos como fonte ainda não.

## Publicar (ordem importa)

1. **Servidor primeiro** (`server/`): traz as rotas, os prompts `redator/v1`, `v2` e
   `taq/documents-v4`. Os assets de `server/lib/documentos/assets/` precisam ir junto
   (a leitura é por `process.cwd()`, como `lib/render/assets/`).
2. Extensão depois. Extensão nova contra servidor velho falha ao gerar.
3. Conferir com `next start` + um POST real em `/api/documentos/renderizar` (PDF e
   DOCX) — foi o que se fez em 08/10/2026 contra a build local.

## Como se verifica

- Servidor: `cd server; npx vitest run lib/documentos lib/prompts lib/render`.
- Extensão: `npx vitest run src/features/documents src/features/taq src/home`.
- Navegador real (Edge, servidor simulado): `scripts/verify-ajuda.cjs` percorre
  gerar → abrir → alterar → ver/restaurar versão e atualiza
  `docs/verification/ajuda/`.
- Redator real, reunião **sintética**: `DOCUMENTOS_LIVE=1 npx vitest run
  lib/documentos/gerar.live.test.ts` (em `server/`). Gasta chamadas ao provedor.
  Medido em 08/10/2026 com `gemini-3.5-flash`: geração ~12 s (raciocínio médio),
  edição ~1,5 s; zero afirmações removidas; proposta não decidida não virou decisão.
  `DOCUMENTOS_RACIOCINIO_GERACAO` / `_EDICAO` trocam o nível (`low` foi 7 s, mas
  perdeu blocos por citação parafraseada).
- Taq ao vivo: `src/features/taq/taq.live.test.ts` (ver o cabeçalho). Em 08/10/2026
  o caso do relatório passou (read_meeting → create_custom_document, 59 s); o da ata
  ficou inconclusivo porque a cota do provedor do Taq esgotou após várias execuções.

## O que ainda não existe

- Histórico de versões no servidor (hoje só no navegador).
- Imagem enviada pela pessoa; outras fontes além de reuniões.
- Revisor visual por modelo sobre as páginas renderizadas.
- Validação do perfil por um responsável do CITi.
