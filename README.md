# TaqCITi Standalone

Extensão para Chrome e Edge de transcrição automática de reuniões do Google
Meet — captura invisível, histórico 100% local. Sem envio a nenhum backend,
sem conta de produto, sem diagnóstico técnico: só escuta a reunião e guarda
a transcrição.

Extraída do núcleo de captura da extensão TaqCITi (repositório
`citi-flow-companion`), removendo tudo que dependia da plataforma CITi Flow
(sincronização, autenticação de produto, fluxo de oportunidade comercial,
diagnóstico técnico). A extensão original continua existindo e funcionando
sem nenhuma mudança — este é um projeto separado, para evoluir como produto
independente.

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
- `src/features/transcription/` — agregação e limpeza da transcrição (puro, sem I/O).
- `src/features/meeting/` — máquina de estados da reunião, consentimento de
  captura, nomeação, detecção de próxima reunião.
- `src/features/history/` — histórico local (chrome.storage.local).
- `src/background/` — service worker: roteia mensagens, persiste o histórico,
  abre o painel lateral e a aba da HOME, e faz o print da aba da reunião.
- `src/document/` — a página de geração de documento a partir de uma reunião.

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
