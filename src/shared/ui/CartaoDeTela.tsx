/**
 * O cartão da CAPTURA DE TELA sob pedido (`capture_screen`).
 *
 * A ferramenta só o prepara; quem captura é a pessoa, no clique, porque o
 * navegador exige o gesto e o seletor de tela (ver `features/taq/capturaDeTela.ts`).
 * Cada passo diz o que de fato aconteceu:
 *
 *   ocioso → capturando → prévia (ainda NÃO guardada) → salva | descartada
 *   cancelado / falhou: voltam ao ocioso com o motivo, e nada foi guardado.
 *
 * Duas fontes: "a aba da reunião" (o print que o aplicativo já tem, só da aba
 * ativa da reunião em andamento) e "escolher a tela" (o seletor do sistema).
 * Nunca há captura contínua: cada clique é um quadro.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CartaoDaResposta } from '@/features/taq/contratos';
import { guardarPrint, type Print } from '@/features/annotations/shots';
import {
  EXPLICACAO_DA_FALHA,
  capturarQuadroDaTela,
  nomeDoArquivoDaCaptura,
  type QuadroDaTela,
} from '@/features/taq/capturaDeTela';
import { EXPLICACAO, type MotivoDeFalha } from '@/background/captura';
import { useHistoryState } from '@/features/history/useHistory';
import { usePlatform } from '@/shared/platform/context';

type Cartao = Extract<CartaoDaResposta, { tipo: 'captura_de_tela' }>;

type Passo =
  | { passo: 'ocioso'; aviso?: string }
  | { passo: 'capturando' }
  | { passo: 'previa'; quadro: Extract<QuadroDaTela, { ok: true }> }
  | { passo: 'salva'; quadro: Extract<QuadroDaTela, { ok: true }>; print: Print };

/** A imagem em outra aba, sem pôr a data URL na barra de endereço. */
async function abrirImagem(dataUrl: string): Promise<boolean> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const url = URL.createObjectURL(blob);
    const janela = window.open(url, '_blank', 'noopener');
    // O objeto vive o bastante para a aba carregar.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return janela !== null;
  } catch {
    return false;
  }
}

export function CartaoDeTela({
  cartao,
  onAbrirReuniao,
}: {
  cartao: Cartao;
  /** Abre a reunião onde a captura foi guardada. */
  onAbrirReuniao?: (reuniaoId: string) => void;
}) {
  const platform = usePlatform();
  const { records } = useHistoryState();
  const [estado, setEstado] = useState<Passo>({ passo: 'ocioso' });
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Impede um segundo clique enquanto o seletor/captura está aberto. */
  const ocupado = useRef(false);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  /** Só vale guardar numa reunião que ainda existe: excluída no meio, nada é recriado. */
  const reuniaoExiste = cartao.reuniaoId ? records.some((r) => r.id === cartao.reuniaoId) : false;

  const aoCapturar = useCallback((quadro: QuadroDaTela) => {
    if (!montado.current) return;
    if (!quadro.ok) {
      setEstado({ passo: 'ocioso', aviso: EXPLICACAO_DA_FALHA[quadro.motivo] });
      return;
    }
    setEstado({ passo: 'previa', quadro });
    setAviso(null);
  }, []);

  const escolherTela = useCallback(async () => {
    if (ocupado.current) return;
    ocupado.current = true;
    setEstado({ passo: 'capturando' });
    try {
      aoCapturar(await capturarQuadroDaTela());
    } finally {
      ocupado.current = false;
    }
  }, [aoCapturar]);

  const capturarAba = useCallback(async () => {
    if (ocupado.current) return;
    ocupado.current = true;
    setEstado({ passo: 'capturando' });
    try {
      const r = await platform.send<
        | { ok: true; dataUrl: string; meetingId?: string | null }
        | { ok: false; motivo: MotivoDeFalha }
      >({ type: 'ui/print' });
      if (!r || !r.ok) {
        if (montado.current)
          setEstado({
            passo: 'ocioso',
            aviso: r ? EXPLICACAO[r.motivo] : 'Não foi possível capturar a aba da reunião.',
          });
        return;
      }
      aoCapturar({ ok: true, dataUrl: r.dataUrl, largura: 0, altura: 0, fonte: 'aba_da_reuniao' });
    } catch {
      if (montado.current)
        setEstado({ passo: 'ocioso', aviso: 'Não foi possível capturar a aba da reunião.' });
    } finally {
      ocupado.current = false;
    }
  }, [aoCapturar, platform]);

  const salvar = useCallback(async () => {
    if (estado.passo !== 'previa' || !cartao.reuniaoId || salvando) return;
    if (!reuniaoExiste) {
      setAviso('A reunião não existe mais; a imagem não foi guardada. Você ainda pode baixá-la.');
      return;
    }
    setSalvando(true);
    try {
      const print = await guardarPrint(
        cartao.reuniaoId,
        estado.quadro.dataUrl,
        estado.quadro.largura,
        estado.quadro.altura,
      );
      if (montado.current) setEstado({ passo: 'salva', quadro: estado.quadro, print });
    } catch {
      // A prévia continua: nada foi guardado, e quem decide é a pessoa.
      if (montado.current)
        setAviso('Não coube no armazenamento local. Apague algum print da reunião e tente de novo.');
    } finally {
      if (montado.current) setSalvando(false);
    }
  }, [cartao.reuniaoId, estado, reuniaoExiste, salvando]);

  const quadro = estado.passo === 'previa' || estado.passo === 'salva' ? estado.quadro : null;
  const titulo = cartao.titulo ? `Captura de tela — ${cartao.titulo}` : 'Captura de tela';
  const selo =
    estado.passo === 'salva'
      ? 'Guardada'
      : estado.passo === 'previa'
        ? 'Prévia'
        : estado.passo === 'capturando'
          ? 'Capturando…'
          : 'Aguardando você';

  return (
    <section className="tq-c" aria-label={titulo}>
      <header className="tq-c-cab">
        <h4>{titulo}</h4>
        <span className="tq-c-selo">{selo}</span>
      </header>

      {quadro ? (
        <figure className="tq-c-previa">
          <img src={quadro.dataUrl} alt="Prévia da captura de tela" />
        </figure>
      ) : (
        <p className="tq-c-meta">
          {estado.passo === 'capturando'
            ? 'Escolha o que capturar na janela do navegador. É uma imagem só: nada fica gravando.'
            : 'Nenhuma imagem foi feita ainda. Você escolhe o que capturar, vê a prévia e decide se guarda.'}
        </p>
      )}

      <div className="tq-c-acoes">
        {(estado.passo === 'ocioso' || estado.passo === 'capturando') && (
          <>
            <button type="button" onClick={() => void escolherTela()} disabled={estado.passo === 'capturando'}>
              Escolher a tela e capturar
            </button>
            {cartao.emAndamento && (
              <button type="button" onClick={() => void capturarAba()} disabled={estado.passo === 'capturando'}>
                Capturar a aba da reunião
              </button>
            )}
          </>
        )}
        {estado.passo === 'previa' && (
          <>
            {cartao.reuniaoId && (
              <button type="button" onClick={() => void salvar()} disabled={salvando || !reuniaoExiste}>
                {salvando ? 'Guardando…' : 'Salvar na reunião'}
              </button>
            )}
            <button type="button" onClick={() => void abrirImagem(estado.quadro.dataUrl)}>
              Abrir
            </button>
            <a
              className="tq-c-botao-link"
              href={estado.quadro.dataUrl}
              download={nomeDoArquivoDaCaptura(cartao.titulo, Date.now())}
            >
              Baixar
            </a>
            <button type="button" onClick={() => setEstado({ passo: 'ocioso' })}>
              Descartar
            </button>
          </>
        )}
        {estado.passo === 'salva' && (
          <>
            <button type="button" onClick={() => void abrirImagem(estado.quadro.dataUrl)}>
              Abrir
            </button>
            <a
              className="tq-c-botao-link"
              href={estado.quadro.dataUrl}
              download={nomeDoArquivoDaCaptura(cartao.titulo, estado.print.at)}
            >
              Baixar
            </a>
            {onAbrirReuniao && cartao.reuniaoId && (
              <button type="button" onClick={() => onAbrirReuniao(cartao.reuniaoId!)}>
                Ver na reunião
              </button>
            )}
            <button type="button" onClick={() => setEstado({ passo: 'ocioso' })}>
              Capturar outra
            </button>
          </>
        )}
      </div>

      {estado.passo === 'ocioso' && estado.aviso && (
        <p className="tq-c-mudo" role="status">
          {estado.aviso}
        </p>
      )}
      {aviso && (
        <p className="tq-c-mudo" role="status">
          {aviso}
        </p>
      )}
      {estado.passo === 'salva' && (
        <p className="tq-c-ok" role="status">
          Guardada com a reunião “{cartao.titulo}”, neste computador.
        </p>
      )}
      {!cartao.reuniaoId && estado.passo === 'previa' && (
        <p className="tq-c-mudo">Sem reunião no contexto: dá para abrir e baixar, mas não guardar.</p>
      )}
    </section>
  );
}
