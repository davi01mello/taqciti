/**
 * A CARTA — escrever um e-mail ou uma mensagem a partir de uma reunião ou de um
 * documento, numa folha de papel no lugar da tela.
 *
 * ── O que ela não finge ──────────────────────────────────────────────────
 *
 * Enviar daqui depende de um canal conectado em Conexões (o Gmail para e-mail,
 * o WhatsApp para mensagem), e esta versão ainda não conecta nenhum dos dois.
 * Então o botão "Enviar" existe, mas fica desligado, e a própria carta diz por
 * quê — na carta, e não num aviso depois do clique. Nada aqui simula um envio:
 * um "Enviado para fulano" que não saiu é o pior tipo de mentira de interface,
 * porque a pessoa só descobre quando o destinatário diz que não recebeu.
 *
 * O que funciona hoje está à mão, na mesma folha: abrir o rascunho no app de
 * e-mail do computador (um `mailto:` com destinatário, assunto e texto) e
 * copiar o texto para colar onde quiser.
 */
import { useEffect, useRef, useState } from 'react';
import { SinalTaqciti } from '@/shared/ui/SinalTaqciti';

type Canal = 'email' | 'mensagem';

interface Props {
  assunto?: string;
  corpo?: string;
  /** O nome do que iria anexado. Só o nome: o anexo é dito, não carregado. */
  anexo?: string | null;
  onFechar: () => void;
  onIrConexoes: () => void;
}

export function Carta({ assunto = '', corpo = '', anexo = null, onFechar, onIrConexoes }: Props) {
  const [canal, setCanal] = useState<Canal>('email');
  const [para, setPara] = useState('');
  const [titulo, setTitulo] = useState(assunto);
  const [texto, setTexto] = useState(corpo);
  const [copiado, setCopiado] = useState(false);
  const paraRef = useRef<HTMLInputElement>(null);
  const caixaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    paraRef.current?.focus();
    caixaRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 1800);
    return () => clearTimeout(t);
  }, [copiado]);

  const nomeDoCanal = canal === 'email' ? 'o Gmail' : 'o WhatsApp';
  const mailto =
    `mailto:${encodeURIComponent(para.trim())}` +
    `?subject=${encodeURIComponent(titulo)}&body=${encodeURIComponent(texto)}`;

  return (
    <div className="tq-carta-caixa" ref={caixaRef}>
      <article className="tq-carta" aria-label="Carta para enviar">
        <span className="tq-carta-selo" aria-hidden="true">
          <SinalTaqciti altura={24} />
        </span>

        <div className="tq-carta-canais" role="tablist" aria-label="Canal">
          {(
            [
              ['email', 'E-mail'],
              ['mensagem', 'Mensagem'],
            ] as const
          ).map(([id, rotulo]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={canal === id}
              onClick={() => setCanal(id)}
            >
              {rotulo}
            </button>
          ))}
        </div>

        <label className="tq-carta-linha">
          <span>Para</span>
          <input
            ref={paraRef}
            type="text"
            data-tq-escrita
            autoComplete="off"
            value={para}
            placeholder={canal === 'email' ? 'nome@empresa.com.br' : 'Nome ou número'}
            onChange={(e) => setPara(e.target.value)}
          />
        </label>
        {canal === 'email' && (
          <label className="tq-carta-linha">
            <span>Assunto</span>
            <input
              type="text"
              data-tq-escrita
              value={titulo}
              placeholder="Sobre o quê"
              onChange={(e) => setTitulo(e.target.value)}
            />
          </label>
        )}
        <textarea
          className="tq-carta-corpo"
          data-tq-escrita
          aria-label="Mensagem"
          placeholder="Escreva aqui…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        {anexo && <span className="tq-carta-anexo">{anexo}</span>}

        <div className="tq-carta-pe">
          <p className="tq-carta-aviso" role="status">
            Para enviar daqui, conecte {nomeDoCanal}.{' '}
            <button type="button" onClick={onIrConexoes}>
              Abrir Conexões
            </button>
          </p>
          {canal === 'email' && (
            <a className="tq-carta-descartar" href={mailto}>
              Abrir no e-mail
            </a>
          )}
          <button
            type="button"
            className="tq-carta-descartar"
            onClick={() => {
              void navigator.clipboard
                .writeText(canal === 'email' && titulo ? `${titulo}\n\n${texto}` : texto)
                .then(() => setCopiado(true))
                .catch(() => setCopiado(false));
            }}
          >
            {copiado ? 'Copiado' : 'Copiar texto'}
          </button>
          <button type="button" className="tq-carta-descartar" onClick={onFechar}>
            Descartar
          </button>
          <button
            type="button"
            className="tq-carta-enviar"
            disabled
            title={`Conecte ${nomeDoCanal} em Conexões para enviar daqui.`}
          >
            Enviar
          </button>
        </div>
      </article>
    </div>
  );
}

/** O ícone de "enviar" das pílulas: um avião de papel, no traço do `Icon`. */
export function IconeEnviar({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" />
    </svg>
  );
}
