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
  /**
   * `true` = mora no corpo do painel de resultado; `false` (padrão) = flutua
   * sobre o botão, no fluxo da geração.
   *
   * O mesmo formulário nos dois lugares de propósito: duas telas de pergunta
   * divergiriam, e a pergunta é a mesma.
   */
  inline?: boolean;
  /**
   * `true` = a página larga (`document/index.html`, 760px); `false` (padrão) =
   * o painel, que tem 396px.
   *
   * **Não é `md:` nem `lg:`.** Breakpoint do Tailwind mede a JANELA, e o painel
   * flutuante vive dentro de um content script — a janela dele é a página do
   * Meet inteira. Um `md:p-5` acertaria a página larga e, de quebra, incharia o
   * painel de 396px, que é exatamente a superfície que não pode mudar. Quem
   * sabe qual das duas é, é quem renderiza.
   */
  ampla?: boolean;
  onConfirmar: (respostas: Resposta[]) => void;
  onPular: () => void;
}

/**
 * As duas densidades, uma ao lado da outra de propósito.
 *
 * A diferença entre o painel e a página larga é o conteúdo desta tabela — não
 * uma dúzia de `ampla ? … : …` espalhados pelo JSX, onde ninguém consegue ver
 * a proporção inteira de uma vez nem perceber que um degrau ficou para trás.
 */
const DENSIDADES = {
  painel: {
    caixa: 'p-3',
    titulo: 'text-body',
    apoio: 'text-caption',
    lista: 'mt-3 space-y-3',
    pergunta: 'text-caption',
    motivo: 'text-micro',
    campo: 'mt-1.5 px-2.5 py-1.5 text-body',
    acoes: 'mt-4',
  },
  pagina: {
    caixa: 'p-5',
    titulo: 'text-title',
    apoio: 'text-body',
    lista: 'mt-5 space-y-4',
    pergunta: 'text-body',
    motivo: 'text-caption',
    campo: 'mt-2 px-3 py-2.5 text-read',
    acoes: 'mt-6',
  },
} as const;

export function QuestionsForm({
  perguntas,
  salvando,
  inline = false,
  ampla = false,
  onConfirmar,
  onPular,
}: QuestionsFormProps) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const d = ampla ? DENSIDADES.pagina : DENSIDADES.painel;

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
    <div
      className={
        inline
          ? // `.glass-raised` no lugar de `bg-white/[0.03]`: 3% de branco sobre
            // um painel quase preto dá 1,05:1 contra o fundo — o formulário não
            // tinha superfície nenhuma, só texto solto com uma borda de 1,30:1.
            // O degrau "cartão que flutua sobre o fundo" é literalmente o papel
            // deste bloco, e ele já existe na escala (ver glass.css).
            `glass-raised rounded-panel animate-entry ${d.caixa}`
          : // Flutuante na página larga: `right-0` o amarrava aos 280px da
            // coluna do menu (DocumentPage), e três campos de texto naquela
            // largura ficam espremidos. A âncora continua sendo o botão; a
            // largura passa a ser a do formulário.
            `glass absolute left-0 top-[calc(100%+8px)] z-50 max-h-[60vh] overflow-y-auto rounded-panel shadow-float animate-entry ${d.caixa} ${
              ampla ? 'w-[420px]' : 'right-0'
            }`
      }
    >
      <p className={`${d.titulo} font-semibold text-foreground`}>
        {perguntas.length === 1
          ? 'Uma informação não estava na reunião'
          : `${perguntas.length} informações não estavam na reunião`}
      </p>
      <p className={`mt-1 ${d.apoio} text-muted`}>
        Responda o que souber. O que ficar em branco aparece marcado no documento.
      </p>

      <div className={d.lista}>
        {perguntas.map((pergunta) => (
          <label key={pergunta.id} className="block">
            <span className={`${d.pergunta} font-semibold text-foreground`}>
              {pergunta.question}
            </span>
            {/* O motivo importa: sem ele a pergunta parece arbitrária, e quem
                responde não sabe se é para chutar ou deixar em branco. */}
            <span className={`mt-0.5 block ${d.motivo} text-muted`}>{pergunta.why}</span>
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
              className={`w-full rounded-control border border-borderc bg-white/[0.04] text-foreground outline-none transition-colors duration-200 ease-flow focus:border-white/25 disabled:opacity-50 ${d.campo}`}
            />
          </label>
        ))}
      </div>

      <div className={`flex items-center gap-2 ${d.acoes}`}>
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
