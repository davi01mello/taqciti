/**
 * O popup do 4º botão: sugestões e avisos do Taq durante a reunião.
 *
 * Compacto e embaixo da fileira de ações, como a pergunta rápida — não é um
 * modal, não tira a transcrição da tela e NÃO ganha foco ao abrir: quem clicou
 * no botão continua nele, e Esc o fecha devolvendo a leitura. Abri-lo marca o
 * que está à vista como lido (some o ponto do botão); fechar não apaga nada.
 *
 * Itens do organizador só aparecem quando o mecanismo real do projeto
 * reconhece a pessoa como organizadora (`souOrganizador`). Sem isso a lista
 * mostra só o que serve a qualquer um e diz por quê.
 */
import { useEffect } from 'react';
import { marcarComoLidos, type Aviso } from '@/features/avisos/store';
import { ListaDeAvisos } from '@/shared/ui/ListaDeAvisos';

interface Props {
  visiveis: readonly Aviso[];
  historico: readonly Aviso[];
  participantes: readonly string[];
  souOrganizador: boolean | null;
  onAbrir: (aviso: Aviso) => void;
  onFechar: () => void;
}

export function SugestoesDoOrganizador({
  visiveis,
  historico,
  participantes,
  souOrganizador,
  onAbrir,
  onFechar,
}: Props) {
  // Ler é abrir: o que estava novo e à vista deixa de ser novo.
  const novos = visiveis.filter((a) => !a.lido).map((a) => a.id);
  const chaveDosNovos = novos.join('|');
  useEffect(() => {
    if (novos.length) void marcarComoLidos(novos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDosNovos]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onFechar]);

  return (
    <section
      className="tq-avisos-popup"
      id="tq-avisos-popup"
      role="region"
      aria-label="Avisos e sugestões do Taq"
    >
      <ListaDeAvisos
        avisos={visiveis}
        historico={historico}
        participantes={participantes}
        onAbrir={onAbrir}
        vazio="Nada pendente. O Taq avisa aqui quando algo da reunião precisar de você."
      />
      {souOrganizador !== true && (
        <p className="tq-avisos-nota">
          {souOrganizador === false
            ? 'Você não aparece como organizador desta reunião: as sugestões para quem organiza ficam ocultas.'
            : 'Não foi possível confirmar quem organiza esta reunião: as sugestões para o organizador ficam ocultas.'}
        </p>
      )}
    </section>
  );
}
