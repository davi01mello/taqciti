/**
 * O que a IA não conseguiu determinar, perguntado a quem estava na reunião.
 *
 * Aparece DEPOIS da geração e ANTES da entrega, porque é o único momento em
 * que as duas coisas são verdade ao mesmo tempo: o documento já existe (então
 * as perguntas são concretas, e não um formulário em branco) e ainda não foi
 * para o Google Docs (então responder não gera uma segunda versão do arquivo).
 *
 * **Responder é opcional.** Pular entrega o documento com as lacunas marcadas
 * em `**[A preencher: ...]**`, visíveis para quem for ler. Bloquear a entrega
 * até tudo estar preenchido transformaria uma ata incompleta — que é
 * aceitável, e o desenho inteiro assume isso — numa ata que não sai.
 */
import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import type { Pergunta, Resposta } from './answers';

interface QuestionsFormProps {
  perguntas: Pergunta[];
  /** Em andamento: some o botão duas vezes enquanto o servidor responde. */
  salvando?: boolean;
  onConfirmar: (respostas: Resposta[]) => void;
  onPular: () => void;
}

export function QuestionsForm({ perguntas, salvando, onConfirmar, onPular }: QuestionsFormProps) {
  const [valores, setValores] = useState<Record<string, string>>({});

  const preenchidas = perguntas.filter((p) => valores[p.id]?.trim()).length;

  const confirmar = () => {
    if (salvando) return;
    // Só as preenchidas. Resposta em branco é "não sei", e o servidor mantém
    // a lacuna — mandar string vazia só gastaria banda para o mesmo efeito.
    onConfirmar(
      perguntas
        .filter((p) => valores[p.id]?.trim())
        .map((p) => ({ questionId: p.id, answer: valores[p.id]!.trim() })),
    );
  };

  return (
    <div className="glass absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[60vh] overflow-y-auto rounded-panel p-3 shadow-float animate-entry">
      <p className="text-body font-semibold text-foreground">
        {perguntas.length === 1
          ? 'Uma informação não estava na reunião'
          : `${perguntas.length} informações não estavam na reunião`}
      </p>
      <p className="mt-1 text-caption text-muted">
        Responda o que souber. O que ficar em branco aparece marcado no documento.
      </p>

      <div className="mt-3 space-y-3">
        {perguntas.map((pergunta) => (
          <label key={pergunta.id} className="block">
            <span className="text-caption font-semibold text-foreground">{pergunta.question}</span>
            {/* O motivo importa: sem ele a pergunta parece arbitrária, e quem
                responde não sabe se é para chutar ou deixar em branco. */}
            <span className="mt-0.5 block text-micro text-muted">{pergunta.why}</span>
            <input
              type="text"
              value={valores[pergunta.id] ?? ''}
              disabled={salvando}
              onChange={(e) => setValores((v) => ({ ...v, [pergunta.id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirmar();
                }
              }}
              className="mt-1.5 w-full rounded-control border border-borderc bg-white/[0.04] px-2.5 py-1.5 text-body text-foreground outline-none transition-colors duration-200 ease-flow focus:border-white/25 disabled:opacity-50"
            />
          </label>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button variant="primary" onClick={confirmar} aria-disabled={salvando}>
          {salvando
            ? 'Salvando...'
            : preenchidas === 0
              ? 'Continuar sem responder'
              : `Continuar com ${preenchidas}`}
        </Button>
        <button
          type="button"
          onClick={() => !salvando && onPular()}
          aria-disabled={salvando}
          className={`rounded-control px-3 py-1.5 text-caption font-semibold text-muted transition-colors duration-200 ease-flow hover:bg-white/[0.07] hover:text-foreground ${
            salvando ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          Pular
        </button>
      </div>
    </div>
  );
}
