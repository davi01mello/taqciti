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

- `src/home/` — **a HOME**: a página principal, em aba inteira. É o que o ícone
  da extensão abre. Assistente, Reuniões, Documentos e Conexões.
- `src/content/` — captura das legendas do Meet e a **sidebar de reunião**, que
  só existe dentro do Meet (`src/content/ui/MeetingSidebar.tsx`).
- `src/features/transcription/` — agregação e limpeza da transcrição (puro, sem I/O).
- `src/features/meeting/` — máquina de estados da reunião, nomeação, detecção de próxima reunião.
- `src/features/history/` — histórico local (chrome.storage.local).
- `src/background/` — service worker: roteia mensagens, persiste o histórico,
  abre (ou foca) a aba da HOME.
- `src/document/` — a página de geração de documento a partir de uma reunião.

Duas superfícies, e só duas. O popup e o histórico em tela cheia (o antigo
`src/sidepanel/`) foram removidos: as três telas mostravam o mesmo histórico de
jeitos diferentes, e o que elas faziam mora na navegação interna da HOME.

## Próximos passos

Base para evoluir para outros fluxos além da transcrição pura — por exemplo,
um fluxo de reuniões entre gestores e membros de equipe.
