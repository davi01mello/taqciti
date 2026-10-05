# A ajuda do TaqCiti — referência verificada

O agente de Operações e Ajuda (`app_assistant`) não explica o TaqCiti de
memória. Ele consulta a referência **`src/features/taq/ajuda.ts`**, que é dado
versionado junto ao código, por duas ferramentas de leitura:

| Ferramenta | O que devolve |
| --- | --- |
| `get_app_capabilities` | as funcionalidades da versão atual, por assunto; para cada uma, se o agente a executa (e com qual ferramenta) ou se é só manual; e o que é planejado ou inexistente |
| `get_usage_guide` | os passos verificados de uma dúvida, com os nomes exatos da tela, os pré-requisitos, as limitações e o estado da verificação |

Nenhuma das duas chama um modelo. O "o agente executa" **não** está escrito à
mão: sai do registro de ferramentas (`FERRAMENTAS_BASE` + `FERRAMENTAS_DE_APP`).
O Taq também tem as duas ferramentas (instruções `taq-v5`), para não explicar o
app de memória quando a delegação ao especialista falha. Isso foi visto ao vivo
com a v4: por limite de cota, o Taq inventou uma opção “enviar por e-mail”.

## Três categorias que não se confundem

- **Funcionalidade** (`FUNCIONALIDADES`): o que a tela faz hoje.
- **Operação do agente** (`ferramenta` da funcionalidade, conferida no
  registro): o que o Taq faz sozinho. Sem ferramenta, a funcionalidade é só
  manual, e o agente explica os passos sem afirmar que fez.
- **Fora do app** (`FORA_DO_APP`): planejado, ligado a um especialista `planned`
  do catálogo, ou indisponível. Planejado nunca vira passo de uso.

Assuntos: captura, reuniões, conversas, documentos, exportação, configurações e
navegação.

## Como a referência se mantém verdadeira

`src/features/taq/ajuda.test.ts` quebra quando:

- um rótulo citado não existe, literalmente, nos arquivos de `implementacao` da
  entrada (renomeou um botão? atualize a entrada);
- um nome entre aspas nos passos não está entre os rótulos conferidos;
- uma ferramenta citada não está registrada ou não é de um agente disponível;
- uma ferramenta de operação registrada não tem entrada na referência;
- um especialista dado como planejado foi ativado no catálogo;
- uma entrada marcada `interface` tem rótulo que a volta na tela não viu.

**Volta na tela** (`scripts/verify-ajuda.cjs`): carrega uma build de
desenvolvimento no Edge, com perfil isolado e dados `[TESTE]`, percorre a HOME
e a sidebar (o simulador de reunião da build de desenvolvimento dá a tela ao
vivo) e grava em `docs/verification/ajuda/resultado.json` quais rótulos
apareceram. A geração de documento é simulada, sem IA.

```powershell
npx vite build --mode development --outDir <pasta>
node scripts/verify-ajuda.cjs <caminho do playwright-core> <pasta>
```

## Estado da verificação (23/09/2026)

**Confirmadas na interface** (os rótulos foram vistos na extensão rodando), 22
entradas: pausar, marcar trecho, ver e abrir reuniões, renomear, apagar e
desfazer exclusão de reunião, notas, conversar com o Taq, perguntar sobre um
trecho, nova conversa e trocar de conversa, apagar conversa, anexar arquivo,
copiar resposta, texto para o Claude, gerar documento, ver, editar e apagar
documento, baixar transcrição, baixar documento, enviar ao Google Docs e efeitos
visuais.

"Confirmada" quer dizer que os nomes e o caminho existem na tela. O fluxo
inteiro não foi executado em todas: o envio ao Google Docs, por exemplo, só
teve o botão visto, porque a build tinha o cliente OAuth configurado.

**Só conferidas no código, ainda precisam de verificação na tela:**

| Entrada | O que falta ver | Por quê |
| --- | --- | --- |
| Registrar reunião | “Deseja registrar esta reunião?”, “Iniciar captura” (cápsula), “Preparando a transcrição…” | a cápsula só existe numa página do Google Meet de verdade |
| Encerrar a captura | “Abrir no TaqCiti” | o simulador não tem estado de reunião encerrada |
| Prints | “Descartar”, “Apagar este print” | exigem capturar a aba do Meet |
| Avisar no chat | “Enviar ao chat” | só no primeiro minuto de uma captura real |
| Esconder a cápsula | “Esconder a cápsula do TaqCiti” | só no Meet |
| Abrir a sidebar e a HOME | “Abrir no TaqCiti” | idem "Encerrar" |
| Sincronizar e conectar | “Gerar endereço”, “Conectar na Claude/ChatGPT”, “Revogar” | exigem a sincronização ligada com uma conta Google |

Também não verificado: o que a tela mostra quando o TaqCiti não consegue ligar
as legendas do Meet. A referência diz exatamente isso, em vez de supor.

## Divergências encontradas no mapeamento

Corrigidas na referência, e não no código (fora do escopo):

- A ajuda antiga mandava baixar documento por “Baixar rascunho”. Esse botão só
  aparece quando o salvamento falha; o normal é “Baixar .md”/“Baixar .txt”.
- A cápsula escondida não tem caminho de volta pela interface. Os comentários
  em `Capsula.tsx` e `controller.ts` dizem o contrário, mas nenhum código grava
  `presence: 'open'`.
- A sidebar diz “Dá para começar depois, por aqui mesmo.” ao perguntar se deve
  registrar, mas não há controle que faça isso.
- O envio ao Google Docs falha em silêncio: `GerarDocumento.tsx` ignora
  `via: 'falhou'`.
- `Conexoes.tsx` diz que sem o cliente OAuth web "o mesmo vale para o envio ao
  Google Docs", mas o Docs depende de outro cliente (o do manifesto).
- Os comentários de `homeTab.ts` e `HomePage.tsx` dizem que o ícone abre a
  HOME; hoje ele abre a sidebar.

## Verificação com o modelo

- **Modelo roteirizado** (`especialistas.test.ts`): as ferramentas oferecidas e
  o que a referência devolve. Um comando só manual (apagar ou baixar documento)
  não dispara operação nenhuma.
- **Provedor real** (`taq.live.test.ts`, bloco "ajuda pela referência", Groq
  `openai/gpt-oss-120b`, 23/09/2026): os quatro casos passaram — função
  existente (cita “Gerar documento”), função inexistente (Jira: "não está
  documentado"), planejado (e-mail: "ainda não existe") e só manual (apagar
  documento: passos pela tela, documento intacto, nada afirmado como feito).
  Todo nome entre aspas na resposta é conferido contra a referência. Com a
  cota por minuto do Groq, os casos rodaram um de cada vez.

## Atualização de 01/10/2026 — especialistas de trabalho

Novo assunto **acompanhamento** e 12 entradas novas (`codigo`, conferidas nos
componentes; os rótulos também foram vistos na tela por
`scripts/verify-trabalho.cjs`, em `docs/verification/trabalho/`): analisar
reunião, registrar e acompanhar compromissos, registrar decisão, comparar
fontes, resolver achado, rascunho de mensagem, sugerir horário, estado da
captura, revisar documento, revisar exposição e "O que o Taq faz".

"Enviar e-mail", "agenda", "lembretes" e "copiloto automático" deixaram de ser
**planejado** e passaram a **indisponível**, com a resposta do que existe no
lugar (rascunho copiável, sugestão de horário, Acompanhamento, pergunta sob
pedido). Nenhum especialista do catálogo segue `planned`.

## Atualização de 05/10/2026 — o operador copia, baixa e escolhe fontes

Quatro ferramentas novas do `app_assistant` (instruções `app-assistant-v5`), com
a entrada correspondente na referência (todas `codigo`: conferidas no código, não
na tela):

| Funcionalidade (ajuda) | Ferramenta | Manual na tela × pelo Taq |
| --- | --- | --- |
| “Copiar a transcrição pela conversa” (`copiar_transcricao`) | `copy_transcript` | Manual: “Copiar”, na reunião da HOME. Pelo Taq: prepara o texto com “Copiar texto”; **quem copia é a pessoa**, o Taq nunca diz que copiou. Diz se a transcrição é parcial (reunião em andamento) ou final; nome de falante e horário só quando a captura os registrou. |
| “Baixar um documento” (`baixar_documento`) | `download_document` | Manual: “Baixar .md” no editor. Pelo Taq: `.md` (versão salva, com as edições) ou `.html` (versão da geração, sem as edições). **PDF só pelo “Baixar” logo depois de gerar**: o Taq recusa e diz isso. |
| “Escolher o que vale como contexto da conversa” (`fontes_do_contexto`) | `add_context_source` | Só pelo Taq: não há botão na tela. Persiste na conversa, volta ao reabrir, vale só para ela. |
| “Tirar uma fonte do contexto da conversa” (`tirar_fonte_do_contexto`) | `remove_context_source` | Só pelo Taq. O registro não é apagado. |

`export_transcript` agora também informa `situacao` (parcial ou final).
