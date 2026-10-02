# Reuniões e Documentos — verificação local

Verificação em 20/09/2026, no projeto real. O workspace já continha uma implementação parcial; ela foi preservada e completada. Nenhum instalador, release ou publicação foi produzido.

## Resultado

- A entrada antiga `src/document/index.html?meetingId=…` encaminha para a reunião correspondente na HOME. Também preserva `record` e o foco em notas quando informado. A geração e os documentos vinculados abrem dentro da HOME.
- Reunião ampla com transcrição à esquerda e notas à direita, na proporção 2:1. Em largura estreita, inclusive no código da sidebar, transcrição e notas alternam mantendo os elementos montados.
- Notas continuam em `taq:notes`, separadas da captura e vinculadas por `meetingId`. Registros antigos da mesma reunião são agregados em ordem, separados por `---`; seus originais ficam preservados em `anteriores` quando o agregado é editado. Registros de formato desconhecido não são apagados por uma edição.
- Documentos têm coleção própria `taq:documents`, identificador, título, conteúdo, formato, datas e vínculos opcionais com reunião/conversa. O editor suporta Markdown e texto simples, com exportação `.md`/`.txt`, sem depender de IA.
- Escritas têm fila por registro e coordenação entre contextos da extensão. Falhas mantêm o rascunho, permitem nova tentativa e download do rascunho. Navegação interna aguarda salvamento; fechamento com trabalho pendente tem proteção `beforeunload` e descarregamento no `pagehide`.
- Exclusão confirmada remove reunião, notas, marcações e prints em uma única chamada ao storage; preserva documentos, retirando o vínculo. A confirmação informa esse comportamento. Falha da chamada não é apresentada como sucesso. A captura ativa precisa ser encerrada antes da exclusão.
- Não há descarte automático de documentos ou reuniões ao atingir uma contagem arbitrária. A cota real do navegador continua aplicável, com falha explícita de gravação.
- Geração existente conecta seu resultado à coleção. Quando respostas atualizam apenas o HTML, o texto desse HTML é preservado em formato de texto simples no editor. Falha ao aplicar respostas preserva as respostas no fim do conteúdo editável.

## Testes executados

| Verificação | Resultado / evidência |
| --- | --- |
| Suíte unitária e componentes | 46 arquivos, **556 testes aprovados** (`npm.cmd test -- --reporter=dot`) |
| Tipos | `npm.cmd run typecheck` aprovado |
| Lint | `npm.cmd run lint` aprovado, sem avisos |
| Compilação | `npm.cmd run build` aprovado; extensão compilada em `dist` |
| Compatibilidade do endereço antigo | Edge abriu a entrada antiga e chegou à mesma reunião na HOME |
| Duas colunas | Coordenadas e proporção verificadas no navegador em 1440 × 1000 |
| Alternância estreita | 390 × 844; rolagem e rascunho preservados ao trocar de aba |
| Notas durante captura | Atualização sintética da transcrição não apagou nem misturou as notas |
| HOME e sidebar | Edição gravada na HOME apareceu na sidebar; edição da sidebar apareceu na HOME |
| Renomeação da reunião | Título persistiu e manteve as notas vinculadas |
| Persistência de documento | Documento criado pelo fluxo de geração com resposta de teste interceptada; armazenamento real da extensão |
| Edição, renomeação e download | Conteúdo e título persistiram; bytes do `.md` baixado iguais ao conteúdo salvo |
| Reabertura do navegador | Processo do Edge encerrado e reaberto com o mesmo perfil temporário; conteúdo, título e origem preservados |
| Falha ao salvar geração | Resultado continuou disponível, sem “Salvo”; nova tentativa persistiu e ofereceu abrir |
| Falha ao salvar edição | Editor manteve rascunho e bloqueou saída silenciosa; nova tentativa funcionou |
| Notas antigas e concorrência | Testes cobrem agregação, originais, duas reuniões editadas rapidamente e falha de uma escrita antiga durante edição mais recente |
| Exclusão com falha | Teste confirma preservação da reunião, das notas e do vínculo do documento |

O teste no navegador está em `scripts/verify-meetings-documents.cjs`. Usa Playwright Core e Edge **153.0.4234.48**, com extensão compilada e perfil temporário isolado. Não usa o perfil pessoal. A página da sidebar foi exercitada em uma aba estreita da extensão; não foi uma sessão real do Google Meet. O resultado estruturado está em [resultados.json](resultados.json).

Para repetir, execute o build e depois `node scripts/verify-meetings-documents.cjs <caminho-do-playwright-core>`. `BROWSER_PATH` pode apontar para outro navegador Chromium compatível com carregamento de extensão. O teste cria seu próprio perfil temporário.

## Capturas

- [Reunião ampla](reuniao-larga.png)
- [Reunião estreita — notas](reuniao-estreita.png)
- [Sidebar — mesmas notas](sidebar-notas.png)
- [Documentos — lista real da coleção de teste](documentos-lista.png)
- [Documento — editor](documento-editor.png)
- [Documento — falha de persistência](documento-falha.png)
- [Arquivo baixado durante a verificação](documento-teste.md)

## Geração real, dados de teste e limites

**Persistência real:** as verificações no Edge usaram `chrome.storage.local` real, inclusive após fechar e reabrir o navegador. As falhas foram injetadas apenas no perfil de teste.

**Dados de teste:** títulos e conteúdos têm o marcador `[TESTE]`. `/api/generate` foi interceptado com uma resposta sintética para exercitar geração → persistência → abrir → editar → baixar. Isso não representa geração real por IA. Não foram adicionados registros de teste ao perfil pessoal nem registros fictícios para preencher a lista de produção.

**Não executado nesta rodada:** chamada real aos provedores de IA e captura de uma reunião ao vivo no Meet. O fluxo de geração existente foi mantido, sem nova arquitetura de agentes. A conversa atual não tem um fluxo próprio de geração; a coleção já aceita seu vínculo opcional, mas nenhum fluxo foi inventado. Documentos antigos que só existiam em downloads não foram recuperados nem apresentados como salvos.

**Limite do fechamento:** as proteções evitam saída inadvertida com alterações pendentes; não constituem garantia contra encerramento forçado do sistema ou confirmação explícita de descarte pelo usuário.
