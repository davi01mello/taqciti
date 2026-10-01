/**
 * Os PRINTS da reunião, na HOME.
 *
 * Os prints eram guardados com a reunião (`features/annotations/shots.ts`), mas
 * só a sidebar os mostrava — e só enquanto a reunião estava viva. Ao "Abrir no
 * TaqCiti" a reunião aparecia sem eles, e parecia que tinham se perdido. Aqui
 * eles ficam junto do resto do registro: uma faixa de miniaturas, e o clique
 * amplia.
 *
 * ── O ampliado é um modal de verdade ─────────────────────────────────────
 *
 * Renderizado por portal na raiz da HOME: dentro de `.tq-main` (que cria a
 * própria camada) ele ficava por baixo da barra do topo e da navegação lateral,
 * clicáveis por cima do escurecido. E ele prende o foco, trava a rolagem da
 * página e devolve o foco a quem o abriu. Apagar pede confirmação ali mesmo.
 *
 * Nenhum print vai para a IA nem para o servidor: continuam neste computador.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apagarPrint, observarPrints, type Print } from '@/features/annotations/shots';
import { formatTime } from '@/shared/ui/format';
import { Icon } from '@/shared/ui/Icon';

/** "Planning da semana" + 14:05 → "planning-da-semana-14h05.jpg". */
function nomeDoArquivo(titulo: string, at: number): string {
  const base =
    titulo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'print';
  return `${base}-${formatTime(at).replace(':', 'h')}.jpg`;
}

export function PrintsDaReuniao({ meetingId, titulo }: { meetingId: string; titulo: string }) {
  const [prints, setPrints] = useState<Print[]>([]);
  const [ampliadoId, setAmpliadoId] = useState<string | null>(null);
  const ampliado = prints.find((p) => p.id === ampliadoId) ?? null;
  const faixaRef = useRef<HTMLUListElement | null>(null);

  useEffect(
    () => observarPrints((todos) => setPrints(todos.filter((p) => p.meetingId === meetingId))),
    [meetingId],
  );

  if (prints.length === 0) return null;

  // Da mais antiga para a mais nova: a faixa se lê na ordem da reunião.
  const emOrdem = [...prints].sort((a, b) => a.at - b.at);

  return (
    <section className="tq-prints-reuniao" aria-label="Prints desta reunião">
      <span className="tq-prints-reuniao-rotulo">
        <Icon name="image" size={13} />
        {prints.length} {prints.length === 1 ? 'print' : 'prints'}
      </span>
      <ul ref={faixaRef}>
        {emOrdem.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              data-print={p.id}
              title={`Ampliar o print das ${formatTime(p.at)}`}
              onClick={() => setAmpliadoId(p.id)}
            >
              <img src={p.dataUrl} alt={`Print das ${formatTime(p.at)}`} />
            </button>
          </li>
        ))}
      </ul>

      {ampliado && (
        <Ampliado
          print={ampliado}
          titulo={titulo}
          onFechar={(apagado) => {
            setAmpliadoId(null);
            // O foco volta à miniatura que abriu; se ela foi apagada, à faixa.
            requestAnimationFrame(() => {
              const faixa = faixaRef.current;
              const alvo =
                (!apagado && faixa?.querySelector<HTMLElement>(`[data-print="${ampliado.id}"]`)) ||
                faixa?.querySelector<HTMLElement>('button');
              alvo?.focus();
            });
          }}
        />
      )}
    </section>
  );
}

function Ampliado({
  print,
  titulo,
  onFechar,
}: {
  print: Print;
  titulo: string;
  onFechar: (apagado: boolean) => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const dialogoRef = useRef<HTMLDivElement | null>(null);
  const fecharRef = useRef<HTMLButtonElement | null>(null);
  const onFecharRef = useRef(onFechar);
  onFecharRef.current = onFechar;

  // Trava a rolagem da página e põe o foco no diálogo.
  useEffect(() => {
    const raiz = document.documentElement;
    const antes = raiz.style.overflow;
    raiz.style.overflow = 'hidden';
    fecharRef.current?.focus();
    return () => {
      raiz.style.overflow = antes;
    };
  }, []);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onFecharRef.current(false);
        return;
      }
      // O foco não sai do diálogo.
      if (e.key !== 'Tab') return;
      const focaveis = dialogoRef.current?.querySelectorAll<HTMLElement>('a[href], button');
      if (!focaveis || focaveis.length === 0) return;
      const primeiro = focaveis[0]!;
      const ultimo = focaveis[focaveis.length - 1]!;
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);

  const apagar = async () => {
    try {
      await apagarPrint(print.id);
      onFechar(true);
    } catch {
      setErro('Não foi possível apagar o print.');
      setConfirmando(false);
    }
  };

  const hora = formatTime(print.at);
  const raiz = document.querySelector('.tq-home') ?? document.body;

  return createPortal(
    <div
      ref={dialogoRef}
      className="tq-print-ampliado"
      role="dialog"
      aria-modal="true"
      aria-label={`Print das ${hora}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onFechar(false);
      }}
    >
      <figure>
        <img src={print.dataUrl} alt={`Print das ${hora}`} />
        <figcaption>
          {confirmando ? (
            <>
              <span role="status">Apagar este print? Não dá para desfazer.</span>
              <button type="button" className="tq-acao" onClick={() => void apagar()}>
                Apagar
              </button>
              <button type="button" className="tq-acao" onClick={() => setConfirmando(false)}>
                Cancelar
              </button>
            </>
          ) : (
            <>
              <span>{erro ?? hora}</span>
              <a
                className="tq-acao"
                href={print.dataUrl}
                download={nomeDoArquivo(titulo, print.at)}
              >
                <Icon name="arrowDown" size={14} />
                Baixar
              </a>
              <button type="button" className="tq-acao" onClick={() => setConfirmando(true)}>
                Apagar
              </button>
            </>
          )}
          <button
            ref={fecharRef}
            type="button"
            className="tq-acao tq-acao-icone"
            aria-label="Fechar"
            title="Fechar"
            onClick={() => onFechar(false)}
          >
            <Icon name="close" size={14} />
          </button>
        </figcaption>
      </figure>
    </div>,
    raiz,
  );
}
