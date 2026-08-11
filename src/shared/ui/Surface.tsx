/**
 * Superfície de vidro do design system. Antes cada tela desenhava a sua (o
 * painel no Meet em CSS solto, a janela principal em Tailwind), e por isso
 * "tinha página diferente de página". Agora existe uma só, em quatro pesos.
 *
 * O nível diz o PAPEL, não a aparência — é o que impede um campo de entrada de
 * receber por engano o vidro da moldura do app. As receitas vivem em
 * `shared/config/glass.css`; aqui só se escolhe qual e com que raio.
 */
import type { HTMLAttributes, ReactNode } from 'react';

type Level = 'chrome' | 'card' | 'item' | 'inset';

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  level?: Level;
  children: ReactNode;
}

const LEVELS: Record<Level, string> = {
  /** Moldura do app: cabeçalho, barra de controles, modal. O vidro mais denso. */
  chrome: 'glass rounded-card',
  /** Um bloco que flutua sobre o fundo. */
  card: 'glass-raised rounded-panel',
  /** Um item de lista ou controle secundário — sem blur, para a lista rolar leve. */
  item: 'glass-subtle rounded-panel',
  /** Um campo ou trecho rebaixado: vidro que afunda em vez de subir. */
  inset: 'glass-sunken rounded-control',
};

export function Surface({ level = 'card', children, className = '', ...rest }: SurfaceProps) {
  return (
    <div {...rest} className={`${LEVELS[level]} ${className}`}>
      {children}
    </div>
  );
}
