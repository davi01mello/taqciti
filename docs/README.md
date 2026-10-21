# Documentação do TaqCiti

Ponto de entrada de tudo o que está documentado. Para quem vai **mexer no código**, comece
pelo [`CLAUDE.md`](../CLAUDE.md) da raiz: comandos, convenções e as armadilhas que já
custaram caro. Para quem vai **instalar ou usar**, vá a [`INSTALL.md`](../INSTALL.md) e à
[ajuda do TaqCiti](ajuda-do-taqciti.md).

> **O que não está aqui, de propósito.** Este repositório é público. A documentação
> descreve variáveis de ambiente só pelo NOME e pela função; não traz chaves, URLs de
> produção, IDs de conta ou de projeto, nem conteúdo de reunião real. Exemplos e fixtures
> usam dados inventados.

## Arquitetura (o estado atual do código)

Seis documentos, um por área. Cada um aponta arquivos e linhas, registra as decisões e as
armadilhas que os comentários do código guardam, e diz como testar a área.

| Documento | Cobre |
|---|---|
| [`arquitetura/extensao-captura.md`](arquitetura/extensao-captura.md) | Captura da reunião no Meet: detecção da sala, legendas, portão de consentimento, estados, cápsula, abertura da sidebar, mensageria e persistência |
| [`arquitetura/extensao-interface.md`](arquitetura/extensao-interface.md) | As telas (Home, sidebar, página do documento), o padrão de plataforma, componentes compartilhados, tema, fluxo de gerar documento |
| [`arquitetura/taq-assistente.md`](arquitetura/taq-assistente.md) | O assistente Taq: ciclo do turno, ferramentas e seus limites, memória, subsistemas, servidor e prompts |
| [`arquitetura/servidor-documentos.md`](arquitetura/servidor-documentos.md) | Geração de documentos: pipeline, agentes, modelo de dados, compilador e variantes visuais, guardas de fidelidade, camada de IA, rotas |
| [`arquitetura/conector-sync-integracoes.md`](arquitetura/conector-sync-integracoes.md) | Conector MCP, sincronização, esquema do servidor, identidade, integrações Google e segurança |
| [`arquitetura/build-release-operacao.md`](arquitetura/build-release-operacao.md) | Estrutura do repositório, builds, testes, CI, release, instaladores, deploy e checklist de publicação |

## Produto e processo

| Documento | Para quê |
|---|---|
| [`ajuda-do-taqciti.md`](ajuda-do-taqciti.md) | Referência de ajuda ao usuário, verificada contra a interface |
| [`taq-agentes.md`](taq-agentes.md) | Arquitetura, contratos e especialistas do Taq |
| [`taq-progresso.md`](taq-progresso.md) | Estado das etapas do Taq e do que foi medido |
| [`segundo-cerebro.md`](segundo-cerebro.md) | O "segundo cérebro": estado dos pontos, acompanhamentos e decisões |
| [`documentos-personalizados.md`](documentos-personalizados.md) | Documentos pedidos em linguagem natural, no padrão visual do CITi |
| [`redesenho-dos-documentos.md`](redesenho-dos-documentos.md) | Diagnóstico e plano para tornar os documentos úteis e fiéis (a fase de fidelidade está implementada; as demais estão desenhadas) |
| [`roteiro-reuniao-real.md`](roteiro-reuniao-real.md) | Roteiro manual para testar numa reunião de verdade |
| [`verification/`](verification) | Relatórios das passadas de verificação no navegador |

## Integrações e segurança

| Documento | Para quê |
|---|---|
| [`plano-de-seguranca.md`](plano-de-seguranca.md) | Mapa das fragilidades e plano de correção em fases (as fases 1 a 3 estão commitadas: servidor, extensão e política de dados/conector; as fases 4 e 5 não começaram) |
| [`google-oauth-setup.md`](google-oauth-setup.md) | Configuração do cliente OAuth do Google e dos escopos |
| [`integracoes-google-workspace.md`](integracoes-google-workspace.md) | O que o Taq faz em Gmail, Agenda e Docs, e como |

## Servidor (`server/`)

| Documento | Para quê |
|---|---|
| [`server/README.md`](../server/README.md) | Visão do servidor, contratos das rotas e variáveis |
| [`server/lib/ai/README.md`](../server/lib/ai/README.md) | A camada de provedores de IA |
| [`server/lib/conector/README.md`](../server/lib/conector/README.md) | O conector MCP, em detalhe |
| [`server/docs/deploy.md`](../server/docs/deploy.md) | Como o servidor vai ao ar |
| [`server/docs/HANDOFF.md`](../server/docs/HANDOFF.md) | Histórico de decisões do servidor. **Parcialmente superado**: ver [`arquitetura/servidor-documentos.md`](arquitetura/servidor-documentos.md) |
| [`server/docs/divida-verificacao-provedores.md`](../server/docs/divida-verificacao-provedores.md) | Dívida de verificação dos provedores de IA |

## Distribuição

| Documento | Para quê |
|---|---|
| [`INSTALL.md`](../INSTALL.md) | Instalação da extensão |
| [`publicar-release.md`](publicar-release.md) | Passo a passo para cortar e conferir uma release |
| `installer/*/README.md` | Instaladores de Windows, macOS e Linux, e o guia do instalador |

## Como manter isto em dia

- Mudou uma decisão no código? Atualize o comentário de topo do arquivo **e** o documento
  de `arquitetura/` da área, no mesmo commit.
- Um documento que descreve o que "vai ser feito" deve dizer a data e o que já foi feito
  (veja `redesenho-dos-documentos.md`); documento sem data envelhece sem aviso.
- Antes de commitar um `.md`, procure chave, URL de deploy, ID de conta e nome de pessoa ou
  de cliente. Em dúvida, troque por um placeholder descritivo (`<URL-DE-PRODUCAO>`).
