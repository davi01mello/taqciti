# LGPD no TaqCiti — rascunho para decisão

> **RASCUNHO, não é parecer jurídico.** Escrito em 28/10/2026 para fechar a Fase 5 do
> [`plano-de-seguranca.md`](plano-de-seguranca.md). Cada item termina com a **decisão** que falta.
> Antes de valer, precisa da leitura de quem responde pela proteção de dados no CITi.

## 1. O que o TaqCiti trata

| Dado | Onde fica | De quem |
|---|---|---|
| Transcrição das legendas, notas, prints, documentos | No navegador de quem gravou (`chrome.storage.local`) | Participantes da reunião, inclusive externos (clientes) |
| Cópia sincronizada do acervo | Banco do servidor (Supabase), por pessoa, com RLS | Os mesmos |
| Trechos enviados à IA para gerar documento ou responder | Provedores de IA (Google, Groq; Anthropic, OpenAI, xAI se configurados) | Os mesmos |
| Conta Google do CITi (e-mail) e uso diário de IA | Banco do servidor (`uso_de_ia`) | Membros do CITi |

Áudio e vídeo **não** são gravados: só o texto das legendas do Meet.

## 2. Base legal

Proposta: **legítimo interesse do CITi** (art. 7º, IX) para registrar e documentar reuniões de trabalho,
com **transparência ativa** aos participantes. Consentimento (art. 7º, I) seria frágil: um participante
externo que não consente teria de sair da reunião, e o consentimento pode ser revogado a qualquer hora.

- Legítimo interesse exige o **teste de balanceamento (LIA)**, art. 10. Esboço:
  - *Finalidade:* atas e resumos fiéis de reuniões de projeto.
  - *Necessidade:* só o texto falado na reunião, só quando alguém do CITi aceita registrar.
  - *Expectativa do titular:* reunião de trabalho com aviso no chat do Meet (já automático desde `9009a74`).
  - *Salvaguardas:* dados no navegador por padrão, sincronização opcional, retenção limitada (seção 4),
    nada usado para treinar modelo (chave `private`).
- **Decisão:** adotar legítimo interesse + LIA? (Alternativa: consentimento explícito dos participantes.)

## 3. Provedores de IA fora do Brasil

A transferência internacional exige uma das hipóteses do art. 33. O caminho prático são as **cláusulas-padrão
contratuais da ANPD** (Resolução CD/ANPD nº 19/2024).

- Conferir, para cada provedor em uso, se o contrato ou os termos de dados (DPA) aceitam as cláusulas-padrão
  ou têm equivalente, e se a chave usada é de plano que **não treina** com os dados.
- Hoje em produção: `DOCCITI_DATA_POLICY=private` (confirmado em 28/10/2026).
- **Decisão:** quais provedores ficam autorizados, e quem confere os DPAs.

## 4. Retenção

Proposta de prazos (a confirmar):

| Dado | Prazo proposto | Como |
|---|---|---|
| Cópia sincronizada no servidor | 12 meses sem acesso → apagar | Rotina no Supabase (não implementada) |
| Contagem de uso de IA (`uso_de_ia`) | 90 dias | Rotina no Supabase (não implementada) |
| Dados no navegador | Enquanto a pessoa mantiver; "apagar reunião" leva tudo dela | Já existe (`limparVinculosDaReuniao`) |
| Logs da Vercel e do Supabase | Padrão do provedor | Conferir no painel |

- **Decisão:** os prazos. Com eles definidos, a rotina de expurgo é código pequeno e testável.

## 5. Direitos do titular

Um participante pode pedir acesso ou exclusão do que disse. Proposta: canal único (e-mail de proteção de
dados do CITi); quem gravou apaga a reunião na extensão e o pedido fica registrado. Na sincronização seguinte o
servidor apaga o conteúdo e guarda só uma lápide (o id marcado como apagado, sem texto), para outra
máquina não restaurá-lo.

- **Decisão:** o canal e o responsável.

## 6. Incidente

Roteiro mínimo (Resolução CD/ANPD nº 15/2024):

1. Conter: revogar o segredo da extensão (`DOCCITI_CHAVE_LEGADA=recusar`, rotacionar `DOCCITI_SHARED_KEY`),
   revogar tokens do conector, e voltar ao deploy anterior se o problema for de código.
2. Avaliar se há risco ou dano relevante aos titulares.
3. Se houver, comunicar a ANPD e os titulares em até **3 dias úteis** do conhecimento.
4. Registrar o incidente (o que houve, dados afetados, medidas) e guardar o registro por **5 anos**.

- **Decisão:** quem é o encarregado (DPO) e quem aciona o roteiro.
