/**
 * "Você" não é nome de ninguém.
 *
 * O Google Meet rotula a própria pessoa como "Você" na lista de participantes
 * e nas legendas, e só troca pelo nome real quando ele aparece no DOM. A
 * extensão já resolve isso quando consegue — `speakerIdentity.ts` faz o rename
 * retroativo da transcrição inteira assim que o nome real surge. Mas quando o
 * nome nunca aparece (aba em segundo plano, tile fora da tela, participante que
 * não abriu a câmera), o que chega aqui é uma transcrição em que uma das
 * pessoas se chama literalmente "Você".
 *
 * O Pensante então lista "Você" como participante, e a ata sai dizendo que
 * Você participou da reunião. Isso não é o modelo errando: a transcrição diz
 * "Você", e ele obedeceu.
 *
 * ── Por que isto é código e não instrução no prompt ────────────────────────
 *
 * Mesma lição das âncoras (ver o README, "O modelo não informa offsets"):
 * quando existe uma regra determinística, ela vale mais no código do que na
 * boa vontade do modelo. O `guidance` da seção diz a mesma coisa, para ele não
 * remar contra — mas quem garante é isto aqui.
 *
 * ── Duas formas, dois destinos ─────────────────────────────────────────────
 *
 *   "Bernardo Belfort (Você)"  → tem nome real. Limpa a decoração e pronto.
 *   "Você"                     → não tem nome nenhum. Vira LACUNA, e a pessoa
 *                                que gerou o documento é quem sabe responder.
 *
 * A segunda NUNCA é descartada em silêncio: aquela pessoa participou da
 * reunião de verdade, e sumir com ela seria pior do que chamá-la de "Você".
 * Ela fica na lista, com `[A preencher: ...]` no lugar do nome.
 */

/**
 * Os rótulos que significam "quem gravou", em pt e en.
 *
 * Comparados sempre em caixa baixa e sem acento, porque a mesma reunião produz
 * "Você", "voce" e "VOCÊ" dependendo de onde o texto foi lido. Espelha
 * `src/features/transcription/sanitize.ts` na extensão, que faz o mesmo corte
 * do outro lado — se um dia divergirem, o sintoma é exatamente este bug
 * voltando.
 */
const ROTULOS = new Set(['voce', 'vc', 'you', 'eu', 'me', 'myself', 'self', 'tu']);

/** Caixa baixa, sem acento, sem espaço sobrando. */
function normalizar(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * O nome é SÓ um rótulo de self, sem nome de verdade junto?
 *
 * `"Você"` → `true`. `"Bernardo Belfort (Você)"` → `false`, porque ali existe
 * nome — passe por `limparRotuloDeSelf` primeiro.
 */
export function ehRotuloDeSelf(nome: string): boolean {
  return ROTULOS.has(normalizar(nome));
}

/**
 * Tira a decoração de self de um nome que já tem nome.
 *
 * `"Bernardo Belfort (Você)"` → `"Bernardo Belfort"`.
 * `"Você"` → `"Você"` (não há o que limpar; quem trata é `ehRotuloDeSelf`).
 *
 * Só remove o parêntese quando o que sobra ainda é um nome. Sem essa condição,
 * `"(Você)"` viraria string vazia e o participante sumiria da ata sem deixar
 * rastro — que é justamente o modo de falhar que este módulo existe para
 * evitar.
 */
export function limparRotuloDeSelf(nome: string): string {
  const casou = nome.match(/^(.*?)\s*[（(]\s*([^)）]*?)\s*[)）]\s*$/u);
  if (!casou) return nome.trim();

  const [, antes = '', dentro = ''] = casou;

  // "Maria (RH)" não é decoração de self — é informação, e jogá-la fora seria
  // perda. Só o parêntese que CONTÉM um rótulo de self é descartável.
  if (!ehRotuloDeSelf(dentro)) return nome.trim();

  // "(Você)" sozinho: sem nada antes do parêntese não sobra nome, e devolver
  // string vazia sumiria com o participante da ata sem deixar rastro.
  return antes.trim() || nome.trim();
}

/** O texto que substitui o nome quando ele é lacuna. Uma frase só, porque vai
 *  para dentro de `[A preencher: ...]` na ata e para o formulário de perguntas. */
export const PERGUNTA_DO_NOME =
  'Qual é o nome da pessoa que a transcrição identifica apenas como "{rotulo}"?';
