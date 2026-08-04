# TaqCITi Standalone

Extensão Chrome de transcrição automática de reuniões do Google Meet — captura
invisível, histórico 100% local. Sem envio a nenhum backend, sem conta de
produto, sem diagnóstico técnico: só escuta a reunião e guarda a transcrição.

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

Depois do build, carregue a pasta `dist/` em `chrome://extensions` → Modo
desenvolvedor → "Carregar sem compactação".

## Distribuição

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

- `src/content/` — captura das legendas do Meet e o painel injetado na página.
- `src/features/transcription/` — agregação e limpeza da transcrição (puro, sem I/O).
- `src/features/meeting/` — máquina de estados da reunião, nomeação, detecção de próxima reunião.
- `src/features/history/` — histórico local (chrome.storage.local).
- `src/background/` — service worker: roteia mensagens, persiste o histórico.
- `src/popup/`, `src/sidepanel/` — UI da extensão.

## Próximos passos

Base para evoluir para outros fluxos além da transcrição pura — por exemplo,
um fluxo de reuniões entre gestores e membros de equipe.
