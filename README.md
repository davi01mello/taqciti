# TaqCiti

Extensão para Chrome e Edge que transcreve reuniões do Google Meet: captura
invisível das legendas, histórico no próprio computador, e geração de ata a
partir do que foi dito.

> **Nome.** Até a versão 2.1.2 o produto se chamava "TaqCITi Standalone". O
> sufixo descrevia a ORIGEM — a extração do núcleo de captura da extensão
> antiga (`citi-flow-companion`), sem a plataforma CITi Flow — e deixou de
> distinguir coisa alguma: não existe uma edição "não standalone" com que se
> contrapor. O nome agora é só **TaqCiti**. A extensão original continua
> existindo e funcionando sem nenhuma mudança; este é um projeto separado.

## O que ela faz

- **Captura** as legendas do Meet enquanto a reunião acontece, sem gravar áudio
  nem vídeo, e só depois de a pessoa aceitar (ver `src/features/meeting/`).
- **Guarda** a transcrição, as notas, as marcações de trecho e os prints no
  `chrome.storage.local`, indexados pela reunião.
- **Gera documentos** (ata, x1, …) a partir da transcrição, pelo servidor em
  `server/` — este é o único caminho que sai do computador, e ele começa com um
  clique explícito.
- **Sincroniza e expõe um conector**, opcionalmente: a seção Conexões liga a
  sincronização com o servidor e entrega o endereço do conector MCP, para um
  cliente de IA ler as reuniões. Desligado é um estado completo — quem nunca
  ligar nada tem a captura, os documentos e as notas do mesmo jeito.

### O que dá para apagar, e de onde

Tudo que a extensão guarda tem como sair, na superfície em que aparece, e
sempre atrás de uma confirmação que diz o que vai junto:

| O quê | Onde | O que a confirmação avisa |
| --- | --- | --- |
| Reunião | HOME → Reuniões → a reunião → menu secundário do rodapé | Leva junto notas, marcações e prints; os documentos gerados **ficam**, sem o vínculo |
| Documento | HOME → Documentos, no ícone de lixeira do item — ou dentro do editor, no menu secundário | A reunião de origem não é afetada |
| Conversa | HOME → menu de conversas (canto superior direito), na lixeira da linha | As mensagens saem para sempre |
| Notas da reunião | HOME → Reuniões → a reunião → lixeira no topo da coluna de notas | A transcrição não é afetada |

Apagar a nota remove o REGISTRO, e não só o texto: esvaziar o campo à mão deixa
para trás os originais preservados de versões antigas (ver `apagarNota` em
`src/features/annotations/notes.ts`).

E apagar aqui basta: a sincronização compara assinaturas por item, então "estava
guardado e sumiu daqui" vira uma remoção no servidor na passada seguinte (ver
`src/features/sync/sincronizacao.ts`). Não existe uma segunda lixeira do outro
lado para lembrar de esvaziar.

## Rodando localmente

```bash
npm install
npm run dev      # build de desenvolvimento com hot reload
npm run build    # build de produção em dist/
npm run typecheck
npm test
```

Depois do build, carregue a pasta `dist/` em `chrome://extensions` (Chrome)
ou `edge://extensions` (Edge) → Modo desenvolvedor → "Carregar sem
compactação".

O servidor de geração é um projeto Next.js à parte, em `server/`, com o próprio
`README.md` e o próprio `package.json`.

## Verificação no navegador

`npm test` roda em jsdom, que **não faz layout**: ele prova estrutura e o que
foi gravado no storage, nunca que algo está visível, alinhado ou dentro da
caixa. O que depende disso tem passada própria no navegador, com a extensão
compilada e um perfil temporário isolado — nunca o perfil pessoal:

```bash
npm run build
node scripts/verify-apagar.cjs <caminho-do-playwright-core>
node scripts/verify-meetings-documents.cjs <caminho-do-playwright-core>
```

Os relatórios e as capturas ficam em [`docs/verification/`](docs/verification):
[apagar](docs/verification/apagar/RELATORIO.md) e
[reuniões e documentos](docs/verification/meetings-documents/RELATORIO.md). A
primeira delas existe porque uma regra de CSS mais específica deixava a lixeira
da conversa com 296px de largura — os testes de componente passavam.

Para uma reunião de verdade, com o Meet no meio, o roteiro manual é
[`docs/roteiro-reuniao-real.md`](docs/roteiro-reuniao-real.md).

## Distribuição

O passo a passo para publicar — servidor no ar, variáveis, tag, e como
conferir que o instalador realmente fala com o servidor — está em
[`docs/publicar-release.md`](docs/publicar-release.md). Vale ler antes de
cortar uma tag: a `v2.0.0` foi publicada apontando para `localhost` e só
funcionava na máquina de quem construiu.

Cada tag `v*.*.*` dispara `.github/workflows/release.yml`, que builda e
compila três instaladores nativos (Windows `.exe`, Linux `.run`, macOS
`.pkg` — ver `installer/`) e os publica em dois canais:

- **GitHub Release da tag** — canal técnico/de auditoria. É onde os
  artefatos ficam versionados de forma permanente, junto do changelog
  gerado automaticamente; útil para debugar qual build gerou qual arquivo.
- **Pasta do Google Drive do time** (`GDRIVE_TAQCITI_FOLDER_ID`) — **canal
  oficial de distribuição pro time**, porque nem todo mundo tem acesso ao
  GitHub ainda. Um upload repetido da mesma versão sobrescreve o arquivo
  existente na pasta em vez de duplicar (ver
  `.github/scripts/upload-to-gdrive.sh`).

Os dois canais coexistem — a Release do GitHub nunca é removida ou
substituída pelo Drive; o Drive é só um destino adicional.

> As pastas que os instaladores criam no computador de quem instala continuam
> se chamando `TaqCITi (não apagar)`. Renomeá-las junto com o produto criaria
> uma segunda pasta a cada atualização, e o navegador continuaria apontando
> para a antiga — o nome do diretório é um caminho, não um rótulo.

## Estrutura

- `src/sidepanel/` — **a SIDEBAR**, no painel lateral nativo do Chrome. É o que
  o ícone da extensão abre. Fora da reunião: conversa e histórico; dentro:
  transcrição, notas, prints e a conversa com o contexto da reunião.
- `src/home/` — **a HOME**: a página principal, em aba inteira. Assistente,
  Reuniões, Documentos e Conexões.
- `src/content/` — captura das legendas do Meet e a **cápsula**, o único
  desenho do TaqCiti dentro da página (`src/content/ui/Capsula.tsx`).
- `src/features/annotations/` — o que a PESSOA acrescenta a uma reunião: notas,
  marcações de trecho, prints e o aviso no chat. Chaves separadas da
  transcrição, de propósito.
- `src/features/documents/` — a coleção de documentos guardados: o que a
  seção Documentos lista, abre, edita e apaga.
- `src/features/transcription/` — agregação e limpeza da transcrição (puro, sem I/O).
- `src/features/meeting/` — máquina de estados da reunião, consentimento de
  captura, nomeação, detecção de próxima reunião.
- `src/features/history/` — histórico local (chrome.storage.local).
- `src/features/sync/` — a sincronização com o servidor, opcional e explícita.
- `src/background/` — service worker: roteia mensagens, persiste o histórico,
  abre o painel lateral e a aba da HOME, e faz o print da aba da reunião.
- `src/document/` — a página de geração de documento a partir de uma reunião.
- `server/` — o servidor Next.js de geração de documento e do conector MCP.

Duas superfícies de produto — a sidebar e a HOME — e uma cápsula. O popup e o
histórico em tela cheia foram removidos numa etapa anterior; o painel flutuante
injetado na página foi removido nesta, quando a sidebar virou o painel nativo.

**Limitação conhecida:** a cápsula não consegue abrir o painel lateral sozinha.
`chrome.sidePanel.open()` exige um gesto do usuário medido no contexto da
extensão, e um clique na página vira mensagem, perdendo o gesto no caminho — o
Chrome responde ``sidePanel.open() may only be called in response to a user
gesture``. A cápsula tenta e, ao ser recusada, diz para clicar no ícone.

## Próximos passos

Base para evoluir para outros fluxos além da transcrição pura — por exemplo,
um fluxo de reuniões entre gestores e membros de equipe.
