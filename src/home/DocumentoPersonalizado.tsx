/**
 * Um documento PERSONALIZADO: a prévia do PDF de verdade, o histórico de
 * versões e o pedido de alteração em linguagem natural.
 *
 * ── A prévia é o arquivo, não uma aproximação ────────────────────────────
 *
 * A página mostrada é o PDF que o servidor renderiza da árvore da revisão —
 * o mesmo que o botão "Baixar PDF" entrega. Nada de HTML parecido: se o
 * arquivo sai com um defeito, a pessoa o vê aqui antes de baixar.
 *
 * ── Alterar é pontual ────────────────────────────────────────────────────
 *
 * A pessoa escolhe onde o pedido vale (a capa, uma seção ou o documento
 * todo); o servidor só pode mexer nos blocos desse escopo e responde com a
 * revisão que ela estava vendo. Se outra aba gravou no meio, a alteração é
 * recusada em vez de sobrescrever. O que o servidor recusou aparece dito, com
 * o motivo.
 *
 * ── Voltar não apaga ─────────────────────────────────────────────────────
 *
 * Restaurar uma versão cria uma versão nova. O histórico só cresce (até o
 * teto), então desfazer uma restauração é restaurar de novo.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { baixarComoDocx, baixarComoPdf } from '@/document/baixarDocumento';
import { nomeDoArquivo } from '@/document/googleDocs';
import { editarPersonalizado, renderizarArvore } from '@/features/documents/personalizado/cliente';
import { guardarEdicao } from '@/features/documents/personalizado/documento';
import { opcoesDeEscopo } from '@/features/documents/personalizado/escopo';
import { arvoreParaMarkdown } from '@/features/documents/personalizado/markdown';
import type { FonteDoDocumento, ResultadoDoServidor } from '@/features/documents/personalizado/tipos';
import {
  lerHistorico,
  restaurarVersao,
  versaoAtual,
  type HistoricoDoDocumento,
  type VersaoDoDocumento,
} from '@/features/documents/personalizado/versoes';
import { apagarDocumento, atualizarDocumento, type DocumentoGuardado } from '@/features/documents/store';
import { transcriptToText } from '@/features/history/export';
import { STORAGE_KEYS } from '@/shared/config/constants';
import { onLocalChange } from '@/shared/services/storage';
import type { MeetingRecord } from '@/shared/types/domain';
import { Icon } from '@/shared/ui/Icon';
import { formatDate, formatTime } from '@/shared/ui/format';

interface Props {
  documento: DocumentoGuardado;
  /** Para montar as fontes da edição e achar a reunião de origem. */
  registros: MeetingRecord[];
  onVoltar: () => void;
  onIrParaReuniao: (meetingId: string) => void;
}

type Previa =
  | { estado: 'carregando' }
  | { estado: 'pronta'; url: string; pdf: string; paginas?: number; avisos: string[]; provisorio: boolean }
  | { estado: 'erro'; mensagem: string };

const ORIGEM: Record<VersaoDoDocumento['origem'], string> = {
  geracao: 'Geração',
  edicao: 'Alteração',
  restauracao: 'Restauração',
};

/** Base64 → URL de blob. Revogada quando a prévia sai da tela. */
function urlDoPdf(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

export function DocumentoPersonalizado({ documento, registros, onVoltar, onIrParaReuniao }: Props) {
  const [historico, setHistorico] = useState<HistoricoDoDocumento | null | undefined>(undefined);
  /** A revisão que está na prévia. `null` = a atual. */
  const [vista, setVista] = useState<number | null>(null);
  const [previa, setPrevia] = useState<Previa>({ estado: 'carregando' });
  const [tentativa, setTentativa] = useState(0);

  const [escopoId, setEscopoId] = useState('todo');
  const [pedido, setPedido] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [baixandoWord, setBaixandoWord] = useState(false);
  const [retorno, setRetorno] = useState<{ tipo: 'ok' | 'aviso' | 'erro'; linhas: string[] } | null>(null);

  const recarregar = useCallback(async () => {
    try {
      setHistorico(await lerHistorico(documento.id));
    } catch {
      setHistorico(null);
    }
  }, [documento.id]);

  useEffect(() => {
    void recarregar();
    // Outra aba (ou o Taq) pode gravar uma versão nova: a tela acompanha.
    return onLocalChange<unknown>(STORAGE_KEYS.documentVersions, () => void recarregar());
  }, [recarregar]);

  const atual = historico ? versaoAtual(historico) : null;
  const versaoVista = useMemo(
    () => (historico ? (historico.versoes.find((v) => v.revisao === (vista ?? versaoAtual(historico).revisao)) ?? null) : null),
    [historico, vista],
  );
  const vendoAntiga = !!versaoVista && !!atual && versaoVista.revisao !== atual.revisao;

  // A prévia: o PDF desta revisão, renderizado pelo servidor a partir da árvore.
  useEffect(() => {
    if (!versaoVista || !historico) return;
    let vivo = true;
    let url: string | null = null;
    setPrevia({ estado: 'carregando' });
    void renderizarArvore(versaoVista.arvore, historico.variante).then((r) => {
      if (!vivo) return;
      if (r.status !== 'ok' || !r.dados.pdf) {
        setPrevia({ estado: 'erro', mensagem: r.status === 'ok' ? 'O servidor não devolveu o PDF.' : r.message });
        return;
      }
      url = urlDoPdf(r.dados.pdf);
      setPrevia({
        estado: 'pronta',
        url,
        pdf: r.dados.pdf,
        ...(r.dados.manifesto.paginas ? { paginas: r.dados.manifesto.paginas } : {}),
        avisos: r.dados.avisos,
        provisorio: r.dados.manifesto.perfilEstado === 'provisorio',
      });
    });
    return () => {
      vivo = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [versaoVista, historico?.variante, tentativa]); // eslint-disable-line react-hooks/exhaustive-deps

  const opcoes = useMemo(() => (atual ? opcoesDeEscopo(atual.arvore) : []), [atual]);
  const reuniao = documento.meetingId ? (registros.find((r) => r.id === documento.meetingId) ?? null) : null;

  const fontes = useMemo<FonteDoDocumento[]>(
    () =>
      (historico?.fontesIds ?? [])
        .map((id) => registros.find((r) => r.id === id))
        .filter((r): r is MeetingRecord => !!r)
        .map((r) => ({ id: r.id, titulo: r.title, texto: transcriptToText(r.segments) })),
    [historico?.fontesIds, registros],
  );
  const fontesAusentes = (historico?.fontesIds.length ?? 0) - fontes.length;

  const alterar = async () => {
    if (!historico || !atual || ocupado || vendoAntiga) return;
    const texto = pedido.trim();
    if (!texto) return;
    setOcupado(true);
    setRetorno(null);

    const escopo = opcoes.find((o) => o.id === escopoId)?.blockIds;
    const resposta = await editarPersonalizado({
      arvore: atual.arvore,
      revisaoEsperada: atual.revisao,
      pedido: texto,
      fontes,
      ...(escopo ? { escopo } : {}),
      ...(historico.variante ? { variante: historico.variante } : {}),
    });

    if (resposta.status !== 'ok') {
      setRetorno({ tipo: 'erro', linhas: [resposta.message] });
      setOcupado(false);
      if (resposta.codigo === 'conflito') void recarregar();
      return;
    }
    const r: ResultadoDoServidor = resposta.dados;
    const linhas: string[] = [];
    if (r.observacao) linhas.push(r.observacao);
    for (const recusa of r.recusadas ?? []) linhas.push(`Não apliquei: ${recusa}`);
    for (const p of r.relatorio.problemas.filter((x) => x.tipo === 'sustentacao')) linhas.push(p.descricao);
    for (const l of r.lacunas) linhas.push(`Falta saber: ${l.pergunta}`);

    try {
      const gravada = await guardarEdicao(documento.id, atual.revisao, r, texto);
      if (gravada.tipo === 'sem_mudanca') {
        setRetorno({ tipo: 'aviso', linhas: ['Nada foi alterado.', ...linhas] });
      } else if (gravada.tipo === 'conflito') {
        setRetorno({
          tipo: 'erro',
          linhas: ['O documento mudou em outro lugar enquanto eu trabalhava. Nada foi gravado; veja a versão atual e peça de novo.'],
        });
        void recarregar();
      } else if (gravada.tipo === 'ok') {
        setPedido('');
        setVista(null);
        setHistorico(gravada.historico);
        setRetorno({ tipo: 'ok', linhas: [`Alteração aplicada (revisão ${r.arvore.revisao}).`, ...linhas] });
      } else {
        setRetorno({ tipo: 'erro', linhas: ['Não foi possível gravar a alteração.'] });
      }
    } catch {
      setRetorno({ tipo: 'erro', linhas: ['Não foi possível salvar a alteração neste computador.'] });
    }
    setOcupado(false);
  };

  const restaurar = async (revisao: number) => {
    if (!atual || ocupado) return;
    setOcupado(true);
    setRetorno(null);
    try {
      const r = await restaurarVersao(documento.id, revisao, atual.revisao);
      if (r.tipo !== 'ok') {
        setRetorno({ tipo: 'erro', linhas: ['Não foi possível restaurar: o documento mudou. Veja a versão atual.'] });
        void recarregar();
      } else {
        const nova = versaoAtual(r.historico);
        await atualizarDocumento(documento.id, { title: nova.arvore.titulo, content: arvoreParaMarkdown(nova.arvore) });
        setVista(null);
        setHistorico(r.historico);
        setRetorno({ tipo: 'ok', linhas: [`Revisão ${revisao} restaurada como revisão ${nova.revisao}.`] });
      }
    } catch {
      setRetorno({ tipo: 'erro', linhas: ['Não foi possível restaurar a versão.'] });
    }
    setOcupado(false);
  };

  const baixar = () => {
    if (previa.estado !== 'pronta') return;
    baixarComoPdf(previa.pdf, nomeDoArquivo('Documento', versaoVista?.arvore.titulo ?? documento.title, reuniao?.title ?? '', new Date()));
  };

  /** O Word editável da versão que está na tela, gerado agora a partir da árvore. */
  const baixarWord = async () => {
    if (!historico || !versaoVista || baixandoWord) return;
    setBaixandoWord(true);
    const r = await renderizarArvore(versaoVista.arvore, historico.variante, ['docx']);
    setBaixandoWord(false);
    if (r.status !== 'ok' || !r.dados.docx) {
      setRetorno({ tipo: 'erro', linhas: [r.status === 'ok' ? 'O servidor não devolveu o Word.' : r.message] });
      return;
    }
    baixarComoDocx(
      r.dados.docx,
      nomeDoArquivo('Documento', versaoVista.arvore.titulo, reuniao?.title ?? '', new Date()),
    );
    // O que o Word não leva, dito: quem abre no Word precisa saber.
    setRetorno({
      tipo: 'aviso',
      linhas: [
        ...r.dados.avisos,
        'Alterações feitas no Word não voltam para o TaqCiti: para mudar o documento aqui, use “Pedir alteração”.',
      ],
    });
  };

  const apagar = async () => {
    if (
      !window.confirm(
        'Apagar este documento e todas as versões dele? A reunião de origem não é apagada.',
      )
    )
      return;
    await apagarDocumento(documento.id);
    onVoltar();
  };

  return (
    <div className="tq-pagina tq-documento tq-personalizado">
      <button type="button" className="tq-voltar" onClick={onVoltar}>
        <Icon name="chevron" size={14} className="tq-girado" />
        Documentos
      </button>

      <div className="tq-documento-topo">
        <h2 className="tq-titulo-editavel">{atual?.arvore.titulo ?? documento.title}</h2>
      </div>
      <p className="tq-meta">
        Documento personalizado · criado em {formatDate(documento.createdAt)} · atualizado em{' '}
        {formatDate(documento.updatedAt)} às {formatTime(documento.updatedAt)}
        {atual ? ` · revisão ${atual.revisao}` : ''}
      </p>

      {reuniao && (
        <div className="tq-vinculados" aria-label="Reunião de origem">
          <Icon name="history" size={13} />
          <button type="button" className="tq-chip" onClick={() => onIrParaReuniao(reuniao.id)}>
            {reuniao.title}
          </button>
        </div>
      )}

      {historico === undefined && <p className="tq-meta">Carregando…</p>}
      {historico === null && (
        <p role="alert">Não encontrei o histórico deste documento neste computador.</p>
      )}

      {historico && versaoVista && (
        <>
          {vendoAntiga && (
            <div className="tq-aviso" role="status">
              Você está vendo a revisão {versaoVista.revisao}, que não é a atual.{' '}
              <button type="button" className="tq-acao" onClick={() => setVista(null)}>
                Voltar à atual
              </button>{' '}
              <button type="button" className="tq-acao" disabled={ocupado} onClick={() => void restaurar(versaoVista.revisao)}>
                Restaurar esta
              </button>
            </div>
          )}

          <div className="tq-personalizado-previa" aria-label="Prévia do PDF">
            {previa.estado === 'carregando' && <p className="tq-meta">Montando o PDF…</p>}
            {previa.estado === 'erro' && (
              <div role="alert">
                <p>{previa.mensagem}</p>
                <button type="button" className="tq-acao" onClick={() => setTentativa((n) => n + 1)}>
                  Tentar de novo
                </button>
              </div>
            )}
            {previa.estado === 'pronta' && (
              <>
                <iframe title={`PDF de ${versaoVista.arvore.titulo}`} src={previa.url} />
                <p className="tq-meta">
                  {previa.paginas ? `${previa.paginas} página(s) · ` : ''}
                  {previa.provisorio
                    ? 'padrão CITi provisório (ainda não validado por um responsável)'
                    : 'padrão CITi validado'}
                </p>
                {previa.avisos.map((a) => (
                  <p key={a} className="tq-meta">
                    {a}
                  </p>
                ))}
              </>
            )}
          </div>

          <div className="tq-personalizado-alterar" data-tq-escrita>
            <label>
              Onde alterar{' '}
              <select
                value={escopoId}
                disabled={ocupado || vendoAntiga}
                onChange={(e) => setEscopoId(e.target.value)}
              >
                <option value="todo">Documento todo</option>
                {opcoes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              value={pedido}
              disabled={ocupado || vendoAntiga}
              aria-label="Pedido de alteração"
              placeholder="Ex.: Reescreva esta seção de forma mais direta · Troque só o título da capa"
              onChange={(e) => setPedido(e.target.value)}
            />
            {fontesAusentes > 0 && (
              <p className="tq-meta">
                {fontesAusentes === 1 ? 'Uma reunião usada como fonte não está' : `${fontesAusentes} reuniões usadas como fonte não estão`}{' '}
                mais neste computador: conteúdo novo que dependa dela não será sustentado.
              </p>
            )}
            <button
              type="button"
              className="tq-acao"
              disabled={ocupado || vendoAntiga || !pedido.trim()}
              onClick={() => void alterar()}
            >
              {ocupado ? 'Trabalhando…' : 'Pedir alteração'}
            </button>
          </div>

          {retorno && (
            <div
              className={retorno.tipo === 'erro' ? 'tq-aviso tq-aviso-falha' : 'tq-aviso'}
              role={retorno.tipo === 'erro' ? 'alert' : 'status'}
            >
              {retorno.linhas.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
          )}

          <div className="tq-rodape-acoes">
            <button type="button" className="tq-acao" disabled={previa.estado !== 'pronta'} onClick={baixar}>
              <Icon name="arrowDown" size={14} />
              Baixar PDF
            </button>
            <button type="button" className="tq-acao" disabled={baixandoWord} onClick={() => void baixarWord()}>
              <Icon name="arrowDown" size={14} />
              {baixandoWord ? 'Gerando o Word…' : 'Baixar Word'}
            </button>
            <button type="button" className="tq-acao" onClick={() => void apagar()}>
              Apagar documento
            </button>
          </div>

          <h3 className="tq-personalizado-subtitulo">Versões</h3>
          <ol className="tq-personalizado-historico">
            {[...historico.versoes].reverse().map((v) => (
              <li key={v.revisao} aria-current={v.revisao === (vista ?? atual?.revisao) ? 'true' : undefined}>
                <span>
                  <strong>Revisão {v.revisao}</strong> · {ORIGEM[v.origem]} · {formatDate(v.criadaEm)} {formatTime(v.criadaEm)}
                  {v.pedido ? ` — ${v.pedido}` : ''}
                </span>
                <span className="tq-acoes">
                  <button type="button" className="tq-acao" onClick={() => setVista(v.revisao === atual?.revisao ? null : v.revisao)}>
                    Ver
                  </button>
                  {v.revisao !== atual?.revisao && (
                    <button type="button" className="tq-acao" disabled={ocupado} onClick={() => void restaurar(v.revisao)}>
                      Restaurar
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
