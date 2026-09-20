/**
 * A marca TaqCiti: o sinal de waveform mais o nome.
 *
 * ── Por que deixou de ser uma imagem só ────────────────────────────────────
 *
 * Antes isto era um `<img>` do `brand/taqciti-wordmark.png`, um recorte de
 * letreiro de neon com o nome já desenhado. Com a arte nova da marca
 * (`brand/taqciti-mark.png`, a waveform em gradiente), o nome passou a ser
 * TEXTO e o sinal passou a ser a imagem. Três ganhos concretos:
 *
 *   - **Um lockup só, em todo lugar.** Antes o painel mostrava o PNG, o guia
 *     de instalação desenhava "Taq" + "citi" em CSS e a HOME tinha um terceiro
 *     jeito. Agora o componente é a fonte da verdade nas telas React.
 *   - **Escala sem borrar.** Texto é vetor; o PNG antigo era um recorte de
 *     bitmap que perdia nitidez fora do tamanho para o qual foi exportado.
 *   - **Lê em qualquer tamanho.** A waveform some abaixo de ~18px; por isso
 *     `comSinal` existe, e por isso ele desliga sozinho quando não há espaço.
 *
 * `height` manda: o corpo da fonte e o sinal saem dele. Sem margem negativa e
 * sem correção óptica — o alinhamento vem do próprio flex.
 */
interface Props {
  height?: number;
  className?: string;
  /** Desliga o sinal e deixa só o nome. Útil onde a altura é apertada. */
  comSinal?: boolean;
}

export function Wordmark({ height = 26, className = '', comSinal = true }: Props) {
  // Abaixo disso a waveform vira um borrão de dois pixels e atrapalha mais do
  // que assina — nesse caso o nome sozinho é a marca.
  const mostrarSinal = comSinal && height >= 18;
  const corpo = Math.round(height * 0.84);

  return (
    <span
      className={`inline-flex select-none items-center ${className}`}
      style={{ height, gap: Math.round(height * 0.3) }}
      aria-label="TaqCiti"
    >
      {mostrarSinal && (
        <img
          src={chrome.runtime.getURL('brand/taqciti-mark.png')}
          alt=""
          draggable={false}
          style={{ height: Math.round(height * 0.82), width: 'auto' }}
          className="block"
        />
      )}
      <span
        aria-hidden="true"
        style={{
          fontSize: corpo,
          fontWeight: 700,
          letterSpacing: `${-corpo * 0.048}px`,
          lineHeight: 1.1,
        }}
        className="text-foreground"
      >
        Taq<em className="text-primary">Citi</em>
      </span>
    </span>
  );
}
