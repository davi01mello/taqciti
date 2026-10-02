/**
 * O Markdown das respostas do Taq, virado em elementos React — nunca em HTML.
 *
 * O texto vem do modelo, e o modelo lê transcrições que qualquer pessoa da
 * reunião pode ter ditado. Por isso nada aqui passa por `innerHTML`: cada
 * pedaço reconhecido vira um elemento, e o resto fica texto. Um `<script>` no
 * meio da resposta aparece escrito, como qualquer outra palavra.
 *
 * Só o subconjunto que as instruções pedem ao modelo (ver
 * `server/lib/prompts/taq/v4.md`, "Forma da resposta"):
 *
 *   blocos   parágrafo, `#`–`####`, lista com `-`/`*`/`•` (um nível de
 *            aninhamento), lista numerada, citação `>`, bloco ``` e `---`
 *   linha    **negrito**, *itálico* ou _itálico_, `código`, link http(s) e as
 *            referências `[r4]` / `[r1, r2]`, que viram botões da fonte
 *
 * Tabela e HTML não entram: as instruções proíbem, e a coluna da sidebar é
 * estreita demais para uma tabela ser legível.
 */
import type { ReactNode } from 'react';

interface Props {
  texto: string;
  /** Clique numa referência `[rN]`. Ausente = a referência fica como texto. */
  onCitar?: (ref: string) => void;
}

type Bloco =
  | { tipo: 'p'; linhas: string[] }
  | { tipo: 'h'; nivel: number; texto: string }
  | { tipo: 'ul' | 'ol'; itens: Array<{ texto: string; filhos: string[] }> }
  | { tipo: 'citacao'; linhas: string[] }
  | { tipo: 'codigo'; texto: string }
  | { tipo: 'hr' };

const TITULO = /^(#{1,4})\s+(.+)$/;
const ITEM_UL = /^(\s*)[-*•]\s+(.*)$/;
const ITEM_OL = /^(\s*)\d+[.)]\s+(.*)$/;
const CITACAO = /^>\s?(.*)$/;
const REGUA = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

export function blocosDoMarkdown(texto: string): Bloco[] {
  const linhas = texto.replace(/\r\n?/g, '\n').split('\n');
  const blocos: Bloco[] = [];
  let i = 0;
  while (i < linhas.length) {
    const linha = linhas[i]!;
    if (!linha.trim()) {
      i += 1;
      continue;
    }
    if (linha.trimStart().startsWith('```')) {
      const corpo: string[] = [];
      i += 1;
      while (i < linhas.length && !linhas[i]!.trimStart().startsWith('```')) corpo.push(linhas[i++]!);
      i += 1;
      blocos.push({ tipo: 'codigo', texto: corpo.join('\n') });
      continue;
    }
    if (REGUA.test(linha)) {
      blocos.push({ tipo: 'hr' });
      i += 1;
      continue;
    }
    const titulo = TITULO.exec(linha.trim());
    if (titulo) {
      blocos.push({ tipo: 'h', nivel: titulo[1]!.length, texto: titulo[2]! });
      i += 1;
      continue;
    }
    if (CITACAO.test(linha.trim())) {
      const corpo: string[] = [];
      while (i < linhas.length && CITACAO.test(linhas[i]!.trim()))
        corpo.push(CITACAO.exec(linhas[i++]!.trim())![1]!);
      blocos.push({ tipo: 'citacao', linhas: corpo });
      continue;
    }
    const tipoDaLista = ITEM_UL.test(linha) ? 'ul' : ITEM_OL.test(linha) ? 'ol' : null;
    if (tipoDaLista) {
      const padrao = tipoDaLista === 'ul' ? ITEM_UL : ITEM_OL;
      const recuoBase = padrao.exec(linha)![1]!.length;
      const itens: Array<{ texto: string; filhos: string[] }> = [];
      while (i < linhas.length) {
        const atual = linhas[i]!;
        if (!atual.trim()) {
          // Linha em branco só continua a lista se a seguinte for outro item.
          const proxima = linhas[i + 1] ?? '';
          if (ITEM_UL.test(proxima) || ITEM_OL.test(proxima)) {
            i += 1;
            continue;
          }
          break;
        }
        const item = ITEM_UL.exec(atual) ?? ITEM_OL.exec(atual);
        if (item && item[1]!.length > recuoBase && itens.length) {
          itens[itens.length - 1]!.filhos.push(item[2]!);
        } else if (item && padrao.test(atual)) {
          itens.push({ texto: item[2]!, filhos: [] });
        } else if (!item && /^\s+/.test(atual) && itens.length) {
          // Continuação recuada do item anterior.
          itens[itens.length - 1]!.texto += ` ${atual.trim()}`;
        } else {
          break;
        }
        i += 1;
      }
      blocos.push({ tipo: tipoDaLista, itens });
      continue;
    }
    const corpo: string[] = [];
    while (
      i < linhas.length &&
      linhas[i]!.trim() &&
      !TITULO.test(linhas[i]!.trim()) &&
      !ITEM_UL.test(linhas[i]!) &&
      !ITEM_OL.test(linhas[i]!) &&
      !CITACAO.test(linhas[i]!.trim()) &&
      !REGUA.test(linhas[i]!) &&
      !linhas[i]!.trimStart().startsWith('```')
    ) {
      corpo.push(linhas[i++]!);
    }
    blocos.push({ tipo: 'p', linhas: corpo });
  }
  return blocos;
}

/**
 * Um token por vez, na ordem em que aparece. A ordem das alternativas importa:
 * código antes de tudo (dentro dele nada é marcação), negrito antes de itálico.
 */
const EM_LINHA =
  /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(\[r\d+(?:\s*[,;]\s*r\d+)*\])|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|((?<![\p{L}\p{N}])\*[^*\s][^*\n]*?\*(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])_[^_\s][^_\n]*?_(?![\p{L}\p{N}]))/gu;

function emLinha(texto: string, onCitar: Props['onCitar'], chave: string): ReactNode[] {
  const saida: ReactNode[] = [];
  let desde = 0;
  let n = 0;
  for (const m of texto.matchAll(EM_LINHA)) {
    const inicio = m.index ?? 0;
    if (inicio > desde) saida.push(texto.slice(desde, inicio));
    const k = `${chave}-${n++}`;
    const [bruto, codigo, negrito, refs, link, italico] = m;
    if (codigo) {
      saida.push(<code key={k}>{codigo.slice(1, -1)}</code>);
    } else if (negrito) {
      saida.push(<strong key={k}>{emLinha(negrito.slice(2, -2), onCitar, k)}</strong>);
    } else if (refs) {
      const lista = refs.slice(1, -1).split(/[,;]/).map((r) => r.trim());
      saida.push(
        <span key={k} className="tq-md-refs">
          {lista.map((ref) =>
            onCitar ? (
              <button
                key={ref}
                type="button"
                className="tq-md-ref"
                title={`Abrir a fonte ${ref}`}
                onClick={() => onCitar(ref)}
              >
                {ref}
              </button>
            ) : (
              <span key={ref} className="tq-md-ref">
                {ref}
              </span>
            ),
          )}
        </span>,
      );
    } else if (link) {
      const fim = link.indexOf('](');
      saida.push(
        <a key={k} href={link.slice(fim + 2, -1)} target="_blank" rel="noopener noreferrer">
          {link.slice(1, fim)}
        </a>,
      );
    } else if (italico) {
      saida.push(<em key={k}>{emLinha(italico.slice(1, -1), onCitar, k)}</em>);
    } else {
      saida.push(bruto);
    }
    desde = inicio + bruto.length;
  }
  if (desde < texto.length) saida.push(texto.slice(desde));
  return saida;
}

function linhasComQuebra(linhas: string[], onCitar: Props['onCitar'], chave: string): ReactNode[] {
  return linhas.flatMap((l, i) => [
    ...(i ? [<br key={`${chave}-br${i}`} />] : []),
    ...emLinha(l.trim(), onCitar, `${chave}-${i}`),
  ]);
}

export function Markdown({ texto, onCitar }: Props) {
  return (
    <div className="tq-md">
      {blocosDoMarkdown(texto).map((b, i) => {
        const k = `b${i}`;
        switch (b.tipo) {
          case 'p':
            return <p key={k}>{linhasComQuebra(b.linhas, onCitar, k)}</p>;
          case 'h':
            return b.nivel <= 2 ? (
              <h3 key={k}>{emLinha(b.texto, onCitar, k)}</h3>
            ) : (
              <h4 key={k}>{emLinha(b.texto, onCitar, k)}</h4>
            );
          case 'citacao':
            return <blockquote key={k}>{linhasComQuebra(b.linhas, onCitar, k)}</blockquote>;
          case 'codigo':
            return (
              <pre key={k}>
                <code>{b.texto}</code>
              </pre>
            );
          case 'hr':
            return <hr key={k} />;
          default: {
            const Lista = b.tipo;
            return (
              <Lista key={k}>
                {b.itens.map((item, j) => (
                  <li key={j}>
                    {emLinha(item.texto, onCitar, `${k}-${j}`)}
                    {item.filhos.length > 0 && (
                      <ul>
                        {item.filhos.map((f, l) => (
                          <li key={l}>{emLinha(f, onCitar, `${k}-${j}-${l}`)}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </Lista>
            );
          }
        }
      })}
    </div>
  );
}
