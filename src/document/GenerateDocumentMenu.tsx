/**
 * Botão "Gerar Documento" com menu de dois níveis. Nenhum dos contextos onde
 * este botão vive (janela principal redimensionável, painel flutuante no Meet) tem
 * largura garantida pra dois níveis lado a lado, então o nível 2 SUBSTITUI o
 * nível 1 (drill-down) em vez de abrir como submenu lateral.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import {
  DOCUMENT_TYPE_LABELS,
  requestGeneration,
  type DocumentType,
  type GenerationResult,
  type GenerationSource,
} from './generateDocument';

type Area = 'gente' | 'producao';

// "Abrir no DocCiti" fica fora do drill-down, direto no nível 1: é a única
// saída pra quem quer montar algo fora do que o servidor já gera, então
// precisa de um clique só, não dois.
const AREA_DEFS: { key: Area; label: string }[] = [
  { key: 'gente', label: 'Gente e gestão' },
  { key: 'producao', label: 'Produção' },
];

type MenuItem =
  | { kind: 'generate'; documentType: DocumentType; label: string }
  | { kind: 'disabled'; label: string };

const AREA_ITEMS: Record<Area, MenuItem[]> = {
  gente: [
    { kind: 'generate', documentType: 'x1', label: DOCUMENT_TYPE_LABELS.x1 },
    { kind: 'disabled', label: 'Feedback' },
  ],
  producao: [
    { kind: 'generate', documentType: 'ata', label: DOCUMENT_TYPE_LABELS.ata },
    { kind: 'generate', documentType: 'daily', label: DOCUMENT_TYPE_LABELS.daily },
    { kind: 'generate', documentType: 'planning', label: DOCUMENT_TYPE_LABELS.planning },
    { kind: 'generate', documentType: 'review', label: DOCUMENT_TYPE_LABELS.review },
  ],
};

type Generating =
  | { status: 'idle' }
  | { status: 'loading'; documentType: DocumentType }
  | { status: 'error'; documentType: DocumentType; message: string };

interface GenerateDocumentMenuProps {
  source: GenerationSource;
  onGenerated: (result: Extract<GenerationResult, { status: 'success' }>) => void;
  className?: string;
}

export function GenerateDocumentMenu({
  source,
  onGenerated,
  className = '',
}: GenerateDocumentMenuProps) {
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState<Area | null>(null);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [generating, setGenerating] = useState<Generating>({ status: 'idle' });
  const wrapperRef = useRef<HTMLDivElement>(null);

  const busy = generating.status === 'loading';

  const reset = () => {
    setOpen(false);
    setArea(null);
    setGenerating({ status: 'idle' });
  };

  // Clicar fora fecha — mas não durante uma geração em andamento, pra não
  // abandonar o pedido sem o usuário ver se deu certo ou não.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (busy) return;
      if (wrapperRef.current && event.composedPath().includes(wrapperRef.current)) return;
      reset();
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [open, busy]);

  // Escape volta um nível antes de fechar. Listener na fase de CAPTURA do
  // document — não no wrapper — porque trocar de nível troca os botões de
  // DOM, o que derruba o foco pro <body>; um handler que depende de bolhar a
  // partir do elemento focado perde o próximo Escape. Capture no document
  // dispara antes de qualquer handler de Escape em fase de bolha (ex.: o
  // painel do Meet se recolhendo com o mesmo Escape), então stopPropagation
  // aqui evita os dois picarem o mesmo tecla.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      event.stopPropagation();
      if (area) goBack();
      else reset();
    };
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [open, area, busy]);

  const goToArea = (key: Area) => {
    setDirection('forward');
    setArea(key);
  };

  const goBack = () => {
    setDirection('back');
    setArea(null);
    setGenerating({ status: 'idle' });
  };

  const generate = (documentType: DocumentType) => {
    if (busy) return;
    setGenerating({ status: 'loading', documentType });
    void requestGeneration(source, documentType).then((result) => {
      if (result.status === 'success') {
        onGenerated(result);
        reset();
      } else {
        setGenerating({ status: 'error', documentType, message: result.message });
      }
    });
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <Button
        variant="primary"
        className="w-full"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => (open ? reset() : setOpen(true))}
      >
        Gerar Documento
      </Button>

      {open && (
        <div className="glass absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-panel p-1.5 shadow-soft animate-entry">
          {area === null ? (
            <div
              key="root"
              className={direction === 'forward' ? 'animate-slide-in-right' : 'animate-slide-in-left'}
            >
              {AREA_DEFS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => goToArea(a.key)}
                  className="flex w-full items-center justify-between rounded-control px-3 py-2.5 text-left text-body font-semibold text-foreground transition-colors duration-200 ease-flow hover:bg-white/8"
                >
                  {a.label}
                  <Icon name="chevron" size={14} className="-rotate-90 text-muted" />
                </button>
              ))}
            </div>
          ) : (
            <div
              key={area}
              className={direction === 'forward' ? 'animate-slide-in-right' : 'animate-slide-in-left'}
            >
              <button
                type="button"
                onClick={() => !busy && goBack()}
                aria-disabled={busy}
                className={`mb-1 flex items-center gap-1.5 rounded-control px-3 py-2 text-caption font-semibold text-muted transition-colors duration-200 ease-flow hover:bg-white/5 hover:text-foreground ${busy ? 'pointer-events-none opacity-50' : ''}`}
              >
                <Icon name="chevron" size={13} className="rotate-90" />
                {AREA_DEFS.find((a) => a.key === area)?.label}
              </button>

              {AREA_ITEMS[area].map((item) => {
                if (item.kind === 'disabled') {
                  return (
                    <div
                      key={item.label}
                      className="flex w-full items-center justify-between rounded-control px-3 py-2.5 text-body text-muted/60"
                    >
                      {item.label}
                      <span className="text-micro">em breve</span>
                    </div>
                  );
                }

                const label =
                  generating.status === 'loading' && generating.documentType === item.documentType
                    ? `Gerando ${item.label}...`
                    : item.label;

                return (
                  <button
                    key={item.documentType}
                    type="button"
                    aria-disabled={busy}
                    onClick={() => generate(item.documentType)}
                    className={`flex w-full items-center rounded-control px-3 py-2.5 text-left text-body font-semibold text-foreground transition-colors duration-200 ease-flow hover:bg-white/8 ${busy ? 'pointer-events-none opacity-50' : ''}`}
                  >
                    {label}
                  </button>
                );
              })}

              {generating.status === 'error' && (
                <p className="mt-1 px-3 pb-1 text-caption text-red-300">{generating.message}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
