import { describe, expect, it } from 'vitest';
import { isUiChromeText, parseCaptionRegion, stripUiChrome } from './captionParser';
import {
  ENGLISH_STRUCTURAL_FIXTURE,
  PORTUGUESE_SHAPE_FIXTURE,
} from './captionFixtures';

/** Monta uma região de legenda a partir de HTML, como o Meet entrega. */
function region(html: string): Element {
  const host = document.createElement('div');
  host.setAttribute('role', 'region');
  host.innerHTML = html;
  document.body.replaceChildren(host);
  return host;
}

describe('filtro do chrome nativo do Meet', () => {
  it('reconhece um nó que é só o botão de rolar', () => {
    expect(isUiChromeText('arrow_downward')).toBe(true);
    expect(isUiChromeText('Ir para o final')).toBe(true);
    expect(isUiChromeText('  IR   ATÉ O FIM!!! ')).toBe(true);
    expect(isUiChromeText('Ir ate o fim')).toBe(true);
    expect(isUiChromeText('Jump to bottom')).toBe(true);
  });

  it('não trata fala de verdade como chrome', () => {
    expect(isUiChromeText('vamos falar da proposta')).toBe(false);
    expect(isUiChromeText('Vamos ir até o fim do projeto')).toBe(false);
  });

  it('arranca o chrome de um blob concatenado (o bug do "Ir para o final")', () => {
    expect(stripUiChrome('arrow_downwardIr para o final')).toBe('');
    expect(stripUiChrome('olá pessoal arrow_downward tudo bem')).toBe('olá pessoal tudo bem');
    expect(stripUiChrome('vamos ir até o fim do projeto')).toBe(
      'vamos ir até o fim do projeto',
    );
  });

  it('deixa a fala intacta quando não há chrome', () => {
    expect(stripUiChrome('  reunião   sobre  dados ')).toBe('reunião sobre dados');
  });
});

describe('camada 1 — classes conhecidas do Meet', () => {
  it('separa falante e texto de cada linha', () => {
    const parsed = parseCaptionRegion(
      region(`
        <div class="nMcdL"><span class="KcIKyf">Ana Souza</span><div class="bh44bd">bom dia pessoal</div></div>
        <div class="nMcdL"><span class="KcIKyf">Bruno Lima</span><div class="bh44bd">bom dia Ana</div></div>
      `),
    );
    expect(parsed.source).toBe('shapes');
    expect(parsed.lines.map((line) => [line.speaker, line.text])).toEqual([
      ['Ana Souza', 'bom dia pessoal'],
      ['Bruno Lima', 'bom dia Ana'],
    ]);
  });
});

describe('camada 2 — estrutural, quando o Meet troca as classes', () => {
  it('funciona com avatar <img>', () => {
    const parsed = parseCaptionRegion(
      region(`
        <div><div><img src="a.png"><span>Ana Souza</span><div>bom dia pessoal</div></div></div>
      `),
    );
    expect(parsed.source).toBe('structural');
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]?.speaker).toBe('Ana Souza');
    expect(parsed.lines[0]?.text).toBe('bom dia pessoal');
  });

  it('funciona com avatar SEM foto (o caso que derrubava a camada estrutural)', () => {
    const parsed = parseCaptionRegion(
      region(`
        <div><div><div style="background-image: url(a.png)"></div><span>Ana Souza</span><div>bom dia pessoal</div></div></div>
      `),
    );
    expect(parsed.source).toBe('structural');
    expect(parsed.lines[0]?.speaker).toBe('Ana Souza');
    expect(parsed.lines[0]?.text).toBe('bom dia pessoal');
  });

  it('separa duas pessoas em linhas distintas', () => {
    const parsed = parseCaptionRegion(
      region(`
        <div>
          <div><img src="a.png"><span>Ana</span><div>primeira fala</div></div>
          <div><img src="b.png"><span>Bruno</span><div>segunda fala</div></div>
        </div>
      `),
    );
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines.map((line) => line.speaker)).toEqual(['Ana', 'Bruno']);
  });

  it('ignora o botão "Ir para o final" que o Meet põe dentro da região', () => {
    const parsed = parseCaptionRegion(
      region(`
        <div><div><img src="a.png"><span>Ana</span><div>bom dia</div><i>arrow_downward</i></div></div>
      `),
    );
    expect(parsed.lines[0]?.text).toBe('bom dia');
  });

  it('layout/conta em português remove semanticamente “Ir até o fim”', () => {
    const parsed = parseCaptionRegion(region(PORTUGUESE_SHAPE_FIXTURE));
    expect(parsed.source).toBe('shapes');
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]?.speaker).toBe('Ana Souza (Você)');
    expect(parsed.lines[0]?.text).toBe(
      'Vamos até o fim do projeto e depois apresentamos a proposta.',
    );
  });

  it('layout/conta em inglês remove controles por role/aria-label', () => {
    const parsed = parseCaptionRegion(region(ENGLISH_STRUCTURAL_FIXTURE));
    expect(parsed.source).toBe('structural');
    expect(parsed.lines[0]?.speaker).toBe('Jordan Lee');
    expect(parsed.lines[0]?.text).toBe('We agreed to review pricing on Thursday.');
  });
});

describe('camada 3 — degradado, mas nunca um blob só', () => {
  it('fatia a região em linhas independentes em vez de uma fala gigante', () => {
    const parsed = parseCaptionRegion(
      region(`
        <div>primeira frase dita</div>
        <div>segunda frase dita</div>
      `),
    );
    expect(parsed.source).toBe('degraded');
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines.map((line) => line.text)).toEqual([
      'primeira frase dita',
      'segunda frase dita',
    ]);
    // Nós diferentes ⇒ captionIds diferentes ⇒ segmentos que não se sobrescrevem.
    expect(parsed.lines[0]?.node).not.toBe(parsed.lines[1]?.node);
  });

  it('região vazia não vira linha nenhuma', () => {
    const parsed = parseCaptionRegion(region('<div>   </div>'));
    expect(parsed.source).toBe('empty');
    expect(parsed.lines).toEqual([]);
  });

  it('região só com chrome do Meet não vira fala', () => {
    const parsed = parseCaptionRegion(region('<div>arrow_downward</div>'));
    expect(parsed.lines).toEqual([]);
  });

  it('controle interativo é removido sem apagar texto legítimo ao lado', () => {
    const parsed = parseCaptionRegion(
      region(`
        <div>
          <span>Vamos ir até o fim do projeto.</span>
          <button aria-label="Ir até o fim">Ir até o fim</button>
        </div>
      `),
    );
    expect(parsed.lines.map((line) => line.text)).toEqual([
      'Vamos ir até o fim do projeto.',
    ]);
  });
});
