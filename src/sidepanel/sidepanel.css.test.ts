/**
 * A trava da SOBREPOSIÇÃO — a regra cuja violação tem sintoma conhecido.
 *
 * ── O defeito ─────────────────────────────────────────────────────────────
 *
 * `visibility` é herdada, e um descendente com `visible` reaparece mesmo dentro
 * de um ancestral `hidden`. As duas seções da sidebar são empilhadas e a que
 * não está em uso fica `visibility: hidden`; a aba ativa da reunião, lá dentro,
 * dizia `visibility: visible`. O resultado era a transcrição ao vivo desenhada
 * POR CIMA do campo "Escreva sua ideia…" e da onda, na seção Conversa, sempre
 * que havia captura correndo.
 *
 * jsdom não resolve cascata nem herança de `visibility` — montar os componentes
 * e perguntar "está visível?" devolveria a mesma resposta antes e depois da
 * correção. O que dá para provar é a regra em si, que é onde o defeito mora.
 *
 * Isto não substitui olhar a tela. Prova só que este erro específico não
 * voltou. Mesmo espírito de `home.css.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/sidepanel/sidepanel.css'), 'utf8');

/** O corpo da primeira regra cujo seletor casa exatamente. */
function bloco(seletor: string): string {
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const achado = new RegExp(`(^|[,}])\\s*${escapado}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!achado) throw new Error(`regra não encontrada: ${seletor}`);
  return achado[2] ?? '';
}

describe('a seção escondida fica escondida inteira', () => {
  it('o painel fora de uso some, e o painel ativo aparece', () => {
    expect(bloco('.tq-painel')).toMatch(/visibility:\s*hidden/);
    expect(bloco('.tq-painel.ativo')).toMatch(/visibility:\s*visible/);
  });

  /*
   * O coração da correção: a aba ativa HERDA a visibilidade do painel. Com
   * `visible` ela ressuscitaria dentro do painel escondido, que é o defeito.
   */
  it('a aba ativa da reunião herda a visibilidade em vez de forçá-la', () => {
    const regra = bloco('.tq-reuniao-parte.ativa');
    expect(regra).toMatch(/visibility:\s*inherit/);
    expect(regra).not.toMatch(/visibility:\s*visible/);
  });

  it('a aba inativa continua escondida e fora do fluxo de leitura', () => {
    expect(bloco('.tq-reuniao-parte')).toMatch(/visibility:\s*hidden/);
  });

  /*
   * A onda é decoração: se ela pegasse o ponteiro, clicar numa fala perto do
   * rodapé da transcrição deixaria de selecioná-la.
   */
  it('a onda da transcrição não intercepta o ponteiro', () => {
    const regra = bloco('.tq-transcricao-palco .tq-wave');
    expect(regra).toMatch(/pointer-events:\s*none/);
    expect(regra).toMatch(/position:\s*absolute/);
    expect(regra).toMatch(/bottom:\s*0/);
  });
});
