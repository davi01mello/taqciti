/**
 * A marca TaqCITi.
 *
 * O arquivo em `public/brand` é o recorte da arte original: as letras
 * vieram do canal alfa dela, que já é limpo — traço cheio, borda
 * suavizada, sem fundo. O que foi descartado é só o halo de neon, que na
 * origem se espalha por centenas de pixels em alfa quase zero; num
 * cabeçalho de 26px ele vira quase toda a caixa e o nome se lê como
 * mancha. Fora dele, nenhum pixel visível foi tocado.
 *
 * `height` manda e a largura segue a proporção (≈3,44:1). Sem margem
 * negativa, sem correção óptica: o recorte já é justo às letras, então o
 * alinhamento sai do próprio layout.
 */
export function Wordmark({
  height = 26,
  className = '',
}: {
  height?: number;
  className?: string;
}) {
  return (
    <img
      src={chrome.runtime.getURL('brand/taqciti-wordmark.png')}
      alt="TaqCITi"
      draggable={false}
      style={{ height }}
      className={`block w-auto select-none ${className}`}
    />
  );
}
