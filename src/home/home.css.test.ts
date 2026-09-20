/**
 * Invariantes de composição que só o CSS decide — e que já foram quebradas.
 *
 * Isto não substitui olhar a tela; nenhuma asserção sobre texto de CSS prova
 * que algo *parece* certo. O que ela prova é o contrário: que uma regra
 * específica, cuja violação tem sintoma conhecido, não voltou. As três aqui são
 * exatamente as que produziram os defeitos relatados:
 *
 *   1. compositor e onda presos na janela (`fixed`/`sticky`), que é o que
 *      fazia a escrita parecer um rodapé e a animação acompanhar a leitura do
 *      histórico em vez de sair da tela;
 *   2. a camada da animação interceptando clique, seleção e rolagem;
 *   3. o texto exibido selecionável, com o realce de seleção quebrando a
 *      superfície — e a exceção do campo de escrita sumindo junto.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Caminho a partir da raiz do projeto: o ambiente do Vitest aqui é jsdom, e
// `import.meta.url` chega como `http://localhost/...`, que `fileURLToPath`
// recusa.
const css = readFileSync(resolve(process.cwd(), 'src/home/home.css'), 'utf8');

/** O corpo da primeira regra cujo seletor casa exatamente. */
function bloco(seletor: string): string {
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const achado = new RegExp(`(^|[,}])\\s*${escapado}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!achado) throw new Error(`regra não encontrada: ${seletor}`);
  return achado[2] ?? '';
}

describe('a conversa, a escrita e a onda pertencem ao mesmo fluxo', () => {
  it.each(['.tq-palco', '.tq-conversa', '.tq-escrita', '.tq-campo', '.tq-wave'])(
    '%s não se prende à janela',
    (seletor) => {
      const regra = bloco(seletor);
      expect(regra).not.toMatch(/position:\s*fixed/);
      expect(regra).not.toMatch(/position:\s*sticky/);
    },
  );

  /* A onda é ancorada ao FIM do conteúdo, e é isso que a faz rolar junto. */
  it('a onda é absoluta dentro do miolo, com o miolo como referência', () => {
    expect(bloco('.tq-wave')).toMatch(/position:\s*absolute/);
    expect(bloco('.tq-main')).toMatch(/position:\s*relative/);
  });
});

describe('a animação é fundo, e só fundo', () => {
  it('não intercepta clique, seleção nem rolagem', () => {
    expect(bloco('.tq-wave')).toMatch(/pointer-events:\s*none/);
  });

  /* Sem a máscara, a borda de cima do canvas vira a linha reta que cortava a
     página em duas — o "corte horizontal". */
  it('dissolve no fundo por máscara, sem revelar a borda do canvas', () => {
    expect(bloco('.tq-wave')).toMatch(/mask-image:\s*linear-gradient\(to bottom, transparent/);
  });
});

describe('o compositor não ganha moldura ao ser focado', () => {
  /*
   * `:focus-visible` casa num campo de texto sempre que ele recebe foco,
   * inclusive por clique — então a regra genérica de foco desenhava um
   * retângulo verde de 2px em volta do campo no instante em que se clicava
   * para escrever. Era a caixa que este compositor existe para não ter, e só
   * aparecia no estado focado.
   */
  it('o campo de escrita cancela o contorno de foco', () => {
    expect(css).toMatch(/\.tq-campo textarea:focus-visible\s*\{[^}]*outline:\s*none/);
  });

  /* O foco precisa continuar anunciado — sem moldura, por revelação. */
  it('o foco revela os controles e a dica de teclas', () => {
    expect(css).toMatch(/\.tq-escrita:focus-within \.tq-campo-acoes/);
    expect(css).toMatch(/\.tq-escrita:focus-within \.tq-dica-teclas/);
  });
});

describe('o cursor nativo e o desenhado nunca coexistem', () => {
  /*
   * A causa do cursor aparecendo onde não devia: `cursor: none` era
   * incondicional, e a camada desenhada era ligada por JavaScript. Amarradas à
   * mesma classe, ou há um ou há o outro — nunca os dois, nunca nenhum.
   */
  it('esconder o cursor do sistema depende da camada estar acesa', () => {
    expect(css).toMatch(/body\.tq-pointer-in \.tq-home,\s*body\.tq-pointer-in \.tq-home \*\s*\{[^}]*cursor:\s*none/);
  });

  it('não existe `cursor: none` fora dessa condição', () => {
    const regras = css.match(/[^{}]+\{[^}]*cursor:\s*none[^}]*\}/g) ?? [];
    expect(regras).toHaveLength(1);
    expect(regras[0]).toContain('tq-pointer-in');
  });
});

describe('o texto exibido não é selecionável, o rascunho é', () => {
  it('a tela inteira bloqueia a seleção', () => {
    expect(bloco('.tq-home')).toMatch(/user-select:\s*none/);
  });

  it('o campo de escrita é a exceção', () => {
    expect(css).toMatch(
      /\.tq-home textarea,\s*\.tq-home input\s*\{[^}]*user-select:\s*text/,
    );
  });
});
