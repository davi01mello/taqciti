/**
 * As três seções que não são a conversa: Reuniões, Documentos e Conexões.
 *
 * Todas leem dados REAIS ou dizem que não há dado nenhum. Nenhuma inventa lista
 * de exemplo — o protótipo de referência tinha "EXEMPLO DE HISTÓRICO" porque
 * precisava se mostrar com o storage vazio; aqui o storage é de verdade, e
 * vazio é uma informação, não um buraco para preencher com ficção.
 *
 * ── O que veio do painel antigo ────────────────────────────────────────────
 *
 * Abrir uma reunião mostrava a transcrição numa tela cheia à parte, com título
 * editável, copiar, baixar e apagar. Aquela tela saiu, e essas funções estão
 * aqui — mesmas mensagens para o background, mesmos dados, dentro da HOME.
 * Antes, clicar numa reunião aqui levava para fora da página.
 */
import { useEffect, useState } from 'react';
import type { MeetingRecord } from '@/shared/types/domain';
import { usePlatform } from '@/shared/platform/context';
import { downloadTranscript, transcriptToText } from '@/features/history/export';
import { Icon } from '@/shared/ui/Icon';
import { TranscriptView } from '@/shared/ui/TranscriptView';
import {
  countWords,
  formatCount,
  formatDate,
  formatDurationHuman,
  formatTime,
  hostName,
} from '@/shared/ui/format';

function Cabecalho({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <header className="tq-pagina-topo">
      <h1>{titulo}</h1>
      <p>{sub}</p>
    </header>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="tq-vazio">{children}</p>;
}

/** Só reuniões com transcrição servem de contexto para qualquer coisa. */
function temConteudo(r: MeetingRecord): boolean {
  return r.segments.length > 0;
}

// ---------------------------------------------------------------- Reuniões

export function PaginaReunioes({
  registros,
  carregado,
  inicial,
  onGerar,
}: {
  registros: MeetingRecord[];
  carregado: boolean;
  /** Reunião que a seção já abre, quando a URL pediu uma. Só o valor INICIAL. */
  inicial: string | null;
  onGerar: (id: string) => void;
}) {
  const [abertaId, setAbertaId] = useState<string | null>(inicial);

  // A reunião pode sumir (apagada aqui mesmo, ou noutra aba): a tela volta
  // para a lista em vez de ficar num detalhe sem dono.
  const aberta = abertaId ? (registros.find((r) => r.id === abertaId) ?? null) : null;
  useEffect(() => {
    if (abertaId && carregado && !aberta) setAbertaId(null);
  }, [abertaId, carregado, aberta]);

  if (aberta) {
    return (
      <DetalheDaReuniao
        registro={aberta}
        onVoltar={() => setAbertaId(null)}
        onGerar={() => onGerar(aberta.id)}
      />
    );
  }

  return (
    <div className="tq-pagina">
      <Cabecalho titulo="Reuniões" sub="O que a extensão capturou neste computador." />

      {!carregado ? (
        <Vazio>Lendo o histórico…</Vazio>
      ) : registros.length === 0 ? (
        <Vazio>
          Nenhuma reunião guardada ainda. Entre numa reunião do Google Meet, aceite
          registrar quando o TaqCiti perguntar, e a transcrição aparece aqui.
        </Vazio>
      ) : (
        <div className="tq-lista">
          {registros.map((r) => (
            <button
              key={r.id}
              type="button"
              className="tq-item"
              onClick={() => setAbertaId(r.id)}
            >
              <span>
                <strong>{r.title}</strong>
                <small>
                  {formatDate(r.startedAt)} · {formatTime(r.startedAt)} ·{' '}
                  {formatDurationHuman(r.durationSeconds)} · {r.segments.length} trecho
                  {r.segments.length === 1 ? '' : 's'}
                  {r.status === 'recording' ? ' · gravando' : ''}
                </small>
              </span>
              <Icon name="arrowUpRight" size={16} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Uma reunião por inteiro, dentro da HOME.
 *
 * O título é editável e a edição vai pelo mesmo `ui/history/rename` de antes —
 * o background continua sendo o dono do histórico. Apagar pede confirmação
 * porque é irreversível e leva a transcrição junto.
 */
function DetalheDaReuniao({
  registro,
  onVoltar,
  onGerar,
}: {
  registro: MeetingRecord;
  onVoltar: () => void;
  onGerar: () => void;
}) {
  const platform = usePlatform();
  const [titulo, setTitulo] = useState(registro.title);
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // O título vindo do storage manda enquanto ninguém está editando aqui.
  useEffect(() => setTitulo(registro.title), [registro.title]);

  const palavras = countWords(registro.segments.map((s) => s.text));

  const copiar = () => {
    void navigator.clipboard
      .writeText(transcriptToText(registro.segments))
      .then(() => setAviso('Transcrição copiada'))
      .catch(() => setAviso('Não foi possível copiar'));
  };

  return (
    <div className="tq-pagina">
      <button type="button" className="tq-voltar" onClick={onVoltar}>
        <Icon name="chevron" size={14} className="tq-girado" />
        Reuniões
      </button>

      <input
        className="tq-titulo-editavel"
        value={titulo}
        maxLength={200}
        spellCheck={false}
        aria-label="Nome da reunião"
        onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setTitulo(registro.title);
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          const novo = titulo.trim();
          if (novo.length > 0 && novo !== registro.title) {
            void platform.send({
              type: 'ui/history/rename',
              id: registro.id,
              title: novo,
            });
          } else {
            setTitulo(registro.title);
          }
        }}
      />

      <p className="tq-meta">
        {formatDate(registro.startedAt)} · {formatTime(registro.startedAt)} ·{' '}
        {formatDurationHuman(registro.durationSeconds)}
        {palavras > 0 && ` · ${formatCount(palavras)} palavras`}
        {registro.participants.length > 0 &&
          ` · ${registro.participants.map((p) => p.name).join(', ')}`}
      </p>

      <div className="tq-acoes">
        <button type="button" className="tq-acao" onClick={copiar}>
          Copiar
        </button>
        <button
          type="button"
          className="tq-acao"
          onClick={() => downloadTranscript(registro)}
        >
          Baixar .txt
        </button>
        <button type="button" className="tq-acao" onClick={onGerar}>
          <Icon name="doc" size={14} />
          Gerar documento
        </button>
        <button
          type="button"
          className="tq-acao tq-acao-perigo"
          onClick={() => setConfirmando(true)}
        >
          Apagar
        </button>
      </div>

      {aviso && (
        <p className="tq-aviso-curto" role="status">
          {aviso}
        </p>
      )}

      {confirmando && (
        <div className="tq-confirma" role="alertdialog" aria-label="Apagar do histórico?">
          <p>
            <strong>Apagar &ldquo;{registro.title}&rdquo;?</strong> A transcrição sai
            deste computador para sempre.
          </p>
          <div className="tq-acoes">
            <button
              type="button"
              className="tq-acao tq-acao-perigo"
              onClick={() => {
                setConfirmando(false);
                void platform.send({ type: 'ui/history/delete', id: registro.id });
                onVoltar();
              }}
            >
              Apagar
            </button>
            <button
              type="button"
              className="tq-acao"
              onClick={() => setConfirmando(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* `scroll={false}`: quem rola é a PÁGINA. Uma caixa de rolagem aqui
          dentro seria a caixa aninhada que engole a roda do mouse. */}
      <div className="tq-transcricao">
        <TranscriptView
          segments={registro.segments}
          selfName={hostName(registro.participants)}
          emptyMessage="Nenhuma fala foi capturada nesta reunião."
          scroll={false}
        />
      </div>
    </div>
  );
}

// -------------------------------------------------------------- Documentos

export function PaginaDocumentos({
  registros,
  carregado,
  onGerar,
}: {
  registros: MeetingRecord[];
  carregado: boolean;
  onGerar: (id: string) => void;
}) {
  const comConteudo = registros.filter(temConteudo);

  return (
    <div className="tq-pagina">
      <Cabecalho titulo="Documentos" sub="O que suas reuniões podem virar." />

      {/*
        Estado honesto: documentos gerados NÃO são guardados hoje. Não existe
        chave de storage para eles (ver STORAGE_KEYS) — a página de geração
        entrega o arquivo e termina ali. Então esta tela não tem histórico para
        mostrar, e diz isso, em vez de listar exemplos.
      */}
      <div className="tq-aviso">
        <strong>Ainda não há histórico de documentos.</strong> Os documentos gerados
        são entregues na hora (download ou Google Docs) e não ficam registrados na
        extensão. Guardar esse histórico é trabalho pendente — até lá, a lista abaixo
        é o caminho de ida: as reuniões a partir das quais dá para gerar um documento
        agora.
      </div>

      {!carregado ? (
        <Vazio>Lendo o histórico…</Vazio>
      ) : comConteudo.length === 0 ? (
        <Vazio>
          Nenhuma reunião com transcrição ainda. Sem transcrição não há o que
          transformar em documento.
        </Vazio>
      ) : (
        <div className="tq-lista">
          {comConteudo.map((r) => (
            <button
              key={r.id}
              type="button"
              className="tq-item"
              onClick={() => onGerar(r.id)}
            >
              <span>
                <strong>{r.title}</strong>
                <small>
                  {formatDate(r.startedAt)} · gerar ata, X1, daily, planning ou review
                </small>
              </span>
              <Icon name="doc" size={16} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Conexões

export function PaginaConexoes({ registros }: { registros: MeetingRecord[] }) {
  const comConteudo = registros.filter(temConteudo);

  return (
    <div className="tq-pagina">
      <Cabecalho
        titulo="Conexões"
        sub="Como levar o contexto das suas reuniões para outro assistente."
      />

      {/*
        Nenhuma integração existe. Nem ChatGPT, nem Claude: não há OAuth, nem
        cliente de API, nem chave guardada em lugar nenhum do projeto. O que
        existe de verdade é a exportação da transcrição — e é ela que este
        tutorial usa. Prometer "conectar" um botão que não conecta nada seria o
        tipo de coisa que só se descobre depois de clicar.
      */}
      <div className="tq-aviso">
        <strong>Nenhuma integração automática está implementada.</strong> O TaqCiti
        não se conecta ao ChatGPT nem ao Claude — não há login, permissão nem envio
        automático. O caminho abaixo é manual, e funciona hoje.
      </div>

      <div className="tq-guia">
        <details open>
          <summary>1. Baixe a transcrição da reunião</summary>
          <p>
            Escolha a reunião na lista abaixo. O arquivo <code>.txt</code> sai com o
            título, a data e as falas na ordem — é exatamente o que a extensão
            capturou.
          </p>
          {comConteudo.length === 0 ? (
            <Vazio>Nenhuma reunião com transcrição para exportar ainda.</Vazio>
          ) : (
            <div className="tq-lista tq-lista-densa">
              {comConteudo.slice(0, 6).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="tq-item"
                  onClick={() => downloadTranscript(r)}
                >
                  <span>
                    <strong>{r.title}</strong>
                    <small>{formatDate(r.startedAt)} · baixar .txt</small>
                  </span>
                  <Icon name="arrowDown" size={16} />
                </button>
              ))}
            </div>
          )}
        </details>

        <details>
          <summary>2. Abra o ChatGPT ou o Claude</summary>
          <p>
            Nos dois, arraste o arquivo para o campo de mensagem ou use o anexo. Eles
            leem <code>.txt</code> direto, sem conversão.
          </p>
          <p>
            Se a transcrição for longa, prefira anexar o arquivo a colar o texto: o
            anexo não consome o limite da janela de mensagem do mesmo jeito.
          </p>
        </details>

        <details>
          <summary>3. Peça o que você precisa</summary>
          <p>
            Um pedido específico rende mais que “resuma”. Por exemplo: “Liste as
            decisões, quem ficou responsável por cada uma e o que ficou sem dono.”
          </p>
          <p>
            Para uma ata formatada, o próprio TaqCiti já faz — veja a aba Documentos,
            que usa o servidor do projeto e devolve o arquivo pronto.
          </p>
        </details>
      </div>
    </div>
  );
}
