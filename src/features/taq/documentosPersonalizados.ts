/**
 * Pedidos de documento que NÃO são do catálogo, mas que o TaqCiti sabe montar
 * (`create_custom_document`): relatório, proposta, parecer, plano de ação,
 * manual, briefing, memorando.
 *
 * A lista é a do que o documento personalizado entrega bem — não a de tudo que
 * existe. Formatos que o TaqCiti NÃO gera (apresentação, planilha, e-mail,
 * slides) ficam de fora de propósito: continuam indo para o Claude, e chamá-los
 * de "documento" aqui os empurraria para uma ferramenta que não os faz.
 *
 * Mora sozinho, sem import de `ferramentas.ts`, porque o contexto, o
 * roteamento e a política precisam dele e `ferramentas.ts` importa os três.
 */
import { normalizar } from './busca';

const PALAVRAS =
  /\b(relatorios?|propostas?|pareceres?|parecer|plano de acao|planos de acao|manual|manuais|briefing|memorando)\b/;

/**
 * Outro formato no mesmo pedido: "prepare um e-mail sobre o relatório" pede o
 * e-mail, e o relatório é só o assunto. Quem decide, nesses casos, é o fluxo
 * do formato (comunicação, ou o texto para levar ao Claude).
 */
const OUTRO_FORMATO =
  /\b(e-?mails?|mensagens?|recados?|comunicados?|slides?|apresentacao|apresentacoes|planilhas?|newsletter|post)\b/;

/** O pedido nomeia um documento que o personalizado monta? */
export function nomeiaDocumentoPersonalizado(texto: string): boolean {
  const t = normalizar(texto);
  return PALAVRAS.test(t) && !OUTRO_FORMATO.test(t);
}

/** Verbo de criação seguido da palavra: "monte um relatório", "faça uma proposta". */
const CRIACAO_E_PALAVRA = new RegExp(
  '\\b(cri\\w*|ger\\w*|mont\\w*|escrev\\w*|redij\\w*|elabor\\w*|prepar\\w*|produz\\w*|faca|faz|fazer)\\b.*' +
    PALAVRAS.source,
);

export function pedeDocumentoPersonalizado(texto: string): boolean {
  const t = normalizar(texto);
  return CRIACAO_E_PALAVRA.test(t) && !OUTRO_FORMATO.test(t);
}
