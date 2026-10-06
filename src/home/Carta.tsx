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
 * O que funciona sem canal está à mão, na mesma folha: copiar o texto para
 * colar onde quiser. Não há `mailto:` nem outro atalho: enviar só se faz pelo Taq.
 *
 * ── A carta e o Taq ───────────────────────────────────────────────────────
 *
 * O ÚNICO caminho de envio é o agente, pelo mesmo caminho do chat
 * (`send_email`), com diretório, idempotência e a decisão de mostrar uma prévia
 * ou não tomada em código. A carta não envia por conta própria; só entrega o pedido:
 *
 *   - "Redigir com o Taq" pede o texto do e-mail, com a reunião como contexto;
 *     a resposta vem na conversa, para a pessoa ler e colar aqui;
 *   - "Enviar" (com o Gmail e o diretório conectados) entrega o e-mail como
 *     está escrito — para, assunto e mensagem, palavra por palavra — e o Taq
 *     envia ou mostra a prévia, e diz o que aconteceu.
 */
import { useEffect, useRef, useState } from 'react';
import { capacidadesDisponiveis } from '@/features/integracoes/estado';
import { SinalTaqciti } from '@/shared/ui/SinalTaqciti';

type Canal = 'email' | 'mensagem';

interface Props {
  assunto?: string;
  corpo?: string;
  /** O nome do que iria anexado. Só o nome: o anexo é dito, não carregado. */
  anexo?: string | null;
  /** Entrega um pedido ao Taq (a conversa abre com a reunião como contexto). */
  onPedirAoTaq?: (texto: string) => void;
  onFechar: () => void;
  onIrConexoes: () => void;
}

/** O pedido de envio: o conteúdo vai entre marcas, para o Taq não reescrevê-lo. */
export function pedidoDeEnvio(p: { para: string; assunto: string; texto: string; anexo: string | null }): string {
  return [
    'Envie este e-mail, exatamente como está escrito, sem mudar nenhuma palavra do assunto nem da mensagem.',
    `Para: ${p.para.trim()}`,
    `Assunto: ${p.assunto.trim()}`,
    ...(p.anexo ? [`Anexo: ${p.anexo} (a transcrição ou o documento desta reunião)`] : []),
    'Mensagem:',
    '"""',
    p.texto.trim(),
    '"""',
  ].join('\n');
}

export function pedidoDeRedacao(p: { para: string; assunto: string; texto: string }): string {
  return [
    'Redija o texto de um e-mail com base nesta reunião, em português, direto e cordial. ' +
      'Responda aqui na conversa só com o assunto e a mensagem, para eu revisar.',
    ...(p.para.trim() ? [`Para: ${p.para.trim()}`] : []),
    ...(p.assunto.trim() ? [`Assunto sugerido: ${p.assunto.trim()}`] : []),
    ...(p.texto.trim() ? ['O que já escrevi:', '"""', p.texto.trim(), '"""'] : []),
  ].join('\n');
}

export function Carta({
  assunto = '',
  corpo = '',
  anexo = null,
  onPedirAoTaq,
  onFechar,
  onIrConexoes,
}: Props) {
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

  // O envio pelo Taq só é oferecido com o Gmail E o diretório de pé: é o que
  // `send_email` exige. Sem eles, a carta continua dizendo o que falta.
  const [emailPronto, setEmailPronto] = useState(false);
  useEffect(() => {
    let vivo = true;
    void capacidadesDisponiveis()
      .then((c) => vivo && setEmailPronto(c.has('email') && c.has('diretorio')))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 1800);
    return () => clearTimeout(t);
  }, [copiado]);

  const nomeDoCanal = canal === 'email' ? 'o Gmail' : 'o WhatsApp';
  const podeEnviarPeloTaq =
    canal === 'email' &&
    emailPronto &&
    !!onPedirAoTaq &&
    para.trim().length > 0 &&
    titulo.trim().length > 0 &&
    texto.trim().length > 0;

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
          {canal === 'email' && emailPronto ? (
            <p className="tq-carta-aviso" role="status">
              O Taq envia pela sua conta do CITi e conta aqui o que aconteceu.
            </p>
          ) : (
            <p className="tq-carta-aviso" role="status">
              Para enviar daqui, conecte {nomeDoCanal}.{' '}
              <button type="button" onClick={onIrConexoes}>
                Abrir Conexões
              </button>
            </p>
          )}
          {onPedirAoTaq && (
            <button
              type="button"
              className="tq-carta-descartar"
              onClick={() => onPedirAoTaq(pedidoDeRedacao({ para, assunto: titulo, texto }))}
            >
              Redigir com o Taq
            </button>
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
            disabled={!podeEnviarPeloTaq}
            title={
              podeEnviarPeloTaq
                ? 'O Taq envia este e-mail pela sua conta do CITi.'
                : canal === 'email' && emailPronto
                  ? 'Preencha para quem, o assunto e a mensagem.'
                  : `Conecte ${nomeDoCanal} em Conexões para enviar daqui.`
            }
            onClick={() => {
              if (!podeEnviarPeloTaq) return;
              onPedirAoTaq?.(pedidoDeEnvio({ para, assunto: titulo, texto, anexo }));
            }}
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
