/**
 * A revisão de EXPOSIÇÃO — o que, num texto que vai sair do TaqCiti, parece
 * dado pessoal ou segredo.
 *
 * Determinística e assumidamente incompleta: reconhece formatos (e-mail,
 * telefone, CPF e CNPJ com dígito verificador, cartão pelo Luhn, credencial
 * rotulada, chave longa). Não entende contexto — "o salário da Ana" passa. Por
 * isso o resultado é um AVISO para a pessoa revisar, e nunca um "pode enviar".
 *
 * Quem controla o acesso continua sendo a política (`politica.ts`): esta
 * revisão não libera nem bloqueia nada.
 */

export type TipoSensivel =
  | 'email'
  | 'telefone'
  | 'cpf'
  | 'cnpj'
  | 'cartao'
  | 'credencial'
  | 'chave';

export interface TrechoSensivel {
  tipo: TipoSensivel;
  inicio: number;
  fim: number;
  texto: string;
}

export const NOME_DO_TIPO: Record<TipoSensivel, string> = {
  email: 'endereço de e-mail',
  telefone: 'telefone',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  cartao: 'número de cartão',
  credencial: 'senha ou token rotulado',
  chave: 'sequência longa que parece chave de acesso',
};

const digitos = (s: string) => s.replace(/\D/g, '');

function cpfValido(s: string): boolean {
  const d = digitos(s);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i += 1) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

function cnpjValido(s: string): boolean {
  const d = digitos(s);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, p, i) => acc + p * Number(d[i]), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

function luhn(s: string): boolean {
  const d = digitos(s);
  if (d.length < 13 || d.length > 19) return false;
  let soma = 0;
  for (let i = 0; i < d.length; i += 1) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    soma += n;
  }
  return soma % 10 === 0;
}

const PADROES: Array<{ tipo: TipoSensivel; re: RegExp; valida?: (s: string) => boolean }> = [
  { tipo: 'email', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { tipo: 'cnpj', re: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, valida: cnpjValido },
  { tipo: 'cpf', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, valida: cpfValido },
  { tipo: 'cartao', re: /\b(?:\d[ -]?){13,19}\b/g, valida: luhn },
  {
    tipo: 'telefone',
    re: /(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g,
  },
  {
    tipo: 'credencial',
    re: /\b(?:senha|password|token|api[_ -]?key|chave de api|secret)\s*[:=]\s*\S+/gi,
  },
  { tipo: 'chave', re: /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g },
];

/** Os trechos que parecem sensíveis, sem sobreposição, na ordem do texto. */
export function acharSensiveis(texto: string): TrechoSensivel[] {
  const achados: TrechoSensivel[] = [];
  for (const { tipo, re, valida } of PADROES) {
    for (const m of texto.matchAll(re)) {
      const inicio = m.index ?? 0;
      const fim = inicio + m[0].length;
      if (valida && !valida(m[0])) continue;
      if (achados.some((a) => inicio < a.fim && fim > a.inicio)) continue;
      achados.push({ tipo, inicio, fim, texto: m[0] });
    }
  }
  return achados.sort((a, b) => a.inicio - b.inicio);
}

/** Uma cópia com cada trecho sensível trocado pelo nome do tipo. O original fica. */
export function ocultarSensiveis(texto: string, trechos = acharSensiveis(texto)): string {
  let saida = '';
  let pos = 0;
  for (const t of trechos) {
    saida += `${texto.slice(pos, t.inicio)}[${NOME_DO_TIPO[t.tipo]} ocultado]`;
    pos = t.fim;
  }
  return saida + texto.slice(pos);
}

/** Avisos curtos para a pessoa: "2 endereços de e-mail", sem repetir o dado. */
export function avisosDeExposicao(trechos: readonly TrechoSensivel[]): string[] {
  const contagem = new Map<TipoSensivel, number>();
  for (const t of trechos) contagem.set(t.tipo, (contagem.get(t.tipo) ?? 0) + 1);
  return [...contagem].map(
    ([tipo, n]) => `Contém ${n === 1 ? 'um' : n} ${NOME_DO_TIPO[tipo]}${n > 1 ? ' (vários)' : ''}: confira antes de compartilhar.`,
  );
}
