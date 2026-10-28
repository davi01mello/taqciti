/**
 * "O que levar para as reuniões" — a parte do Preparar onde o assistente se
 * monta, ANTES das reuniões, uma vez para todas.
 *
 * ── Por que um mapa ───────────────────────────────────────────────────────
 *
 * O que a pessoa precisa ver é o caminho: a fala da reunião entra, o
 * assistente responde, e entre as duas coisas vai junto o que está LIGADO. Um
 * formulário de campos soltos (a versão até 22/10/2026: missão, o que
 * observar, preferências) escondia exatamente isso — não dava para saber o que
 * ia ao modelo e o que só estava escrito. No mapa, ligado é violeta e sólido;
 * guardado é tracejado e fica de fora.
 *
 * ── As regras que a tela obedece ───────────────────────────────────────────
 *
 * 1. Nada é salvo antes de "Usar este assistente". Até lá, tudo é rascunho
 *    desta aba; a gravação confere a revisão lida e, se outra aba mudou o
 *    assistente, volta como aviso — nunca sobrescreve.
 * 2. O Padrão do CITi é só leitura. Para mudar, a pessoa parte dele: o
 *    Personalizado é uma cópia dela.
 * 3. O centro não é contexto. As regras que não mudam (fidelidade, fala é
 *    dado, apagar e enviar pedem a pessoa) moram lá e não se desligam. O modo
 *    de intervenção e "ler ao encerrar" também: ligam comportamento, não são
 *    texto para o modelo.
 * 4. A reunião em andamento continua com a versão com que começou; a tela diz
 *    isso em vez de deixar a pessoa achar que a mudança valeu na hora.
 *
 * ── Largura ───────────────────────────────────────────────────────────────
 *
 * O mapa é desenhado em 720×600 e encolhe até 72%. Abaixo disso ele vira LISTA
 * (os mesmos botões, em coluna): na prévia ele rolava de lado num celular, e
 * um mapa que só se lê rolando de lado não mostra o caminho a ninguém.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  MAX_CONTEXTOS,
  MAX_NOME_DO_CONTEXTO,
  MAX_TEXTO_DO_CONTEXTO,
  MODOS_DE_INTERVENCAO,
  ROTULO_DO_MODO,
  conteudoDe,
  conteudoDoPadrao,
  nomeDaVersao,
  perfilEmUsoDaReuniao,
  salvarPerfil,
  vagaLivre,
  type BaseDoPerfil,
  type Conducao,
  type ContextoDoAssistente,
  type ConteudoDoPerfil,
  type ModoDeIntervencao,
} from '@/features/conducao/store';
import { PADRAO_DO_CITI } from '@/features/conducao/padrao';
import { BotaoCopiar } from '@/shared/ui/BotaoCopiar';
import { Icon } from '@/shared/ui/Icon';
import { MarcaDoTaq } from '@/shared/ui/MarcaDoTaq';

/** A reunião ao vivo, se houver: a tela só precisa do id e do nome. */
export interface ReuniaoEmAndamento {
  reuniaoId: string;
  titulo: string;
}

// ------------------------------------------------------------- o rascunho

/** O que a tela edita. `seus` = `null` enquanto a pessoa nunca personalizou. */
interface Rascunho {
  base: BaseDoPerfil;
  seus: ContextoDoAssistente[] | null;
  buscaNaInternet: boolean;
  modo: ModoDeIntervencao;
  ler: boolean;
  padraoVersao: number;
}

function rascunhoDe(salvo: ConteudoDoPerfil | null): Rascunho {
  const s = salvo ?? conteudoDoPadrao();
  return {
    base: s.base,
    seus: s.base === 'personalizado' ? s.contextos : null,
    buscaNaInternet: s.base === 'personalizado' && s.buscaNaInternet,
    modo: s.base === 'personalizado' ? s.intervencao.modo : PADRAO_DO_CITI.modo,
    ler: s.lerAoEncerrar === true,
    padraoVersao: s.padraoVersao,
  };
}

function conteudoDoRascunho(r: Rascunho): ConteudoDoPerfil {
  const ler = r.ler ? { lerAoEncerrar: true as const } : {};
  if (r.base === 'padrao')
    return {
      base: 'padrao',
      padraoVersao: PADRAO_DO_CITI.versao,
      contextos: [],
      buscaNaInternet: false,
      intervencao: { modo: PADRAO_DO_CITI.modo },
      ...ler,
    };
  return {
    base: 'personalizado',
    padraoVersao: r.padraoVersao,
    contextos: r.seus ?? [],
    buscaNaInternet: r.buscaNaInternet,
    intervencao: { modo: r.modo },
    ...ler,
  };
}

/** A cópia do padrão que vira o Personalizado: contextos dela, ainda ligados. */
function copiaDoPadrao(): ContextoDoAssistente[] {
  return PADRAO_DO_CITI.contextos.map((c) => ({ ...c, ligado: true, origem: 'padrao' as const }));
}

// ---------------------------------------------------------------- o mapa

const LARGURA = 720;
const ALTURA = 600;
const CENTRO = { x: 360, y: 300 };
/** Onde cada vaga fica na elipse em volta do centro (graus). */
const ANGULOS = [155, 205, 120, 60, 240, 300, 28, 332];
/** Abaixo desta escala o mapa vira lista. */
const ESCALA_MINIMA = 0.72;

function posicao(vaga: number) {
  const r = ((ANGULOS[vaga] ?? 0) * Math.PI) / 180;
  return { x: Math.round(CENTRO.x + 250 * Math.cos(r)), y: Math.round(CENTRO.y - 190 * Math.sin(r)) };
}

/** A escala que cabe na caixa; `null` = estreita demais: lista. */
function useEscala(caixa: React.RefObject<HTMLDivElement | null>): number | null {
  const [escala, setEscala] = useState<number | null>(1);
  useEffect(() => {
    const el = caixa.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const medir = () => {
      const largura = el.clientWidth;
      if (!largura) return;
      const e = Math.min(1, largura / LARGURA);
      setEscala(e < ESCALA_MINIMA ? null : e);
    };
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, [caixa]);
  return escala;
}

type Selecao = 'centro' | 'busca' | string | null;

function Mapa({
  contextos,
  personalizado,
  busca,
  selecao,
  versao,
  aoEscolher,
  aoAdicionar,
}: {
  contextos: readonly ContextoDoAssistente[];
  personalizado: boolean;
  busca: boolean;
  selecao: Selecao;
  versao: string;
  aoEscolher: (s: Selecao) => void;
  aoAdicionar: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const escala = useEscala(caixa);
  const lista = escala === null;
  const livre = personalizado ? vagaLivre(contextos) : null;
  const ordenados = [...contextos].sort((a, b) => a.vaga - b.vaga);
  const no = (vaga: number): CSSProperties => {
    const p = posicao(vaga);
    return { left: p.x - 96, top: p.y - 26 };
  };

  return (
    <div className={`tq-mapa-caixa${lista ? ' lista' : ''}`} ref={caixa}>
      <div
        className="tq-mapa-medida"
        style={lista ? undefined : { width: LARGURA * escala, height: ALTURA * escala }}
      >
        <div className="tq-mapa-palco" style={lista ? undefined : { transform: `scale(${escala})` }}>
          {!lista && (
            <>
              <div className="tq-mapa-brilho" aria-hidden="true" />
              <svg className="tq-mapa-fios" viewBox={`0 0 ${LARGURA} ${ALTURA}`} aria-hidden="true">
                <ellipse className="tq-fio-orbita" cx={CENTRO.x} cy={CENTRO.y} rx="250" ry="190" />
                <line className="tq-fio-fala" x1={CENTRO.x} y1="68" x2={CENTRO.x} y2="220" />
                <line className="tq-fio-saida" x1={CENTRO.x} y1="380" x2={CENTRO.x} y2="532" />
                <line
                  className={`tq-fio-busca${busca ? ' ligado' : ''}${selecao === 'busca' ? ' sel' : ''}`}
                  x1={CENTRO.x}
                  y1={CENTRO.y}
                  x2="520"
                  y2={CENTRO.y}
                />
                {ordenados.map((c) => {
                  const p = posicao(c.vaga);
                  return (
                    <line
                      key={c.id}
                      className={`tq-fio${c.ligado ? ' ligado' : ''}${selecao === c.id ? ' sel' : ''}`}
                      x1={CENTRO.x}
                      y1={CENTRO.y}
                      x2={p.x}
                      y2={p.y}
                    />
                  );
                })}
                {livre !== null && (
                  <line className="tq-fio tq-fio-vaga" x1={CENTRO.x} y1={CENTRO.y} x2={posicao(livre).x} y2={posicao(livre).y} />
                )}
              </svg>
              <div className="tq-mapa-anel" aria-hidden="true" />
            </>
          )}

          <div className="tq-mapa-entrada">
            <span className="tq-mapa-vivo" aria-hidden="true" />
            <span>
              Fala da reunião <small>ao vivo</small>
            </span>
          </div>

          <button
            type="button"
            className={`tq-mapa-centro${selecao === 'centro' ? ' sel' : ''}`}
            aria-pressed={selecao === 'centro'}
            onClick={() => aoEscolher(selecao === 'centro' ? null : 'centro')}
          >
            <MarcaDoTaq estado="repouso" tamanho={lista ? 28 : 40} />
            <span>
              <b>Assistente</b>
              <small>{versao}</small>
            </span>
          </button>

          {ordenados.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`tq-mapa-no${c.ligado ? '' : ' guardado'}${selecao === c.id ? ' sel' : ''}`}
              style={lista ? undefined : no(c.vaga)}
              aria-pressed={selecao === c.id}
              onClick={() => aoEscolher(selecao === c.id ? null : c.id)}
            >
              {personalizado ? <span className="tq-mapa-ponto" aria-hidden="true" /> : <Icon name="lock" size={13} />}
              <span className="tq-mapa-no-txt">
                <b>{c.nome || 'Sem nome'}</b>
                <small>
                  {!personalizado
                    ? 'Padrão · fixo'
                    : !c.ligado
                      ? 'Guardado · fica fora'
                      : c.origem === 'padrao'
                        ? 'Do padrão CITi'
                        : 'Seu contexto'}
                </small>
              </span>
              <span className="sr-only">, {c.ligado ? 'levando' : 'guardado'}</span>
            </button>
          ))}

          <button
            type="button"
            className={`tq-mapa-busca${busca ? '' : ' desligada'}${selecao === 'busca' ? ' sel' : ''}`}
            aria-pressed={selecao === 'busca'}
            onClick={() => aoEscolher(selecao === 'busca' ? null : 'busca')}
          >
            <Icon name="globe" size={18} />
            <span>
              <b>Busca na internet</b>
              <small className="tq-mapa-estado">{busca ? 'ligada' : 'desligada'}</small>
              <small>{busca ? 'Pede o seu ok antes de cada busca' : 'Nada sai do computador'}</small>
            </span>
          </button>

          {livre !== null ? (
            <button type="button" className="tq-mapa-no tq-mapa-vaga" style={lista ? undefined : no(livre)} onClick={aoAdicionar}>
              <Icon name="plus" size={14} />
              <span>Adicionar contexto</span>
            </button>
          ) : (
            !personalizado && (
              <p className="tq-mapa-no tq-mapa-vaga nota" style={lista ? undefined : no(5)}>
                Seus contextos entram no Personalizado
              </p>
            )
          )}

          <div className="tq-mapa-saida">
            <Icon name="chats" size={15} />
            <span>Respostas e lembretes</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- o painel

function Interruptor({
  titulo,
  explica,
  ligado,
  aoMudar,
}: {
  titulo: string;
  explica?: string;
  ligado: boolean;
  aoMudar: (v: boolean) => void;
}) {
  return (
    <label className="tq-interruptor">
      <span>
        <b>{titulo}</b>
        {explica && <small>{explica}</small>}
      </span>
      <input type="checkbox" role="switch" checked={ligado} onChange={(e) => aoMudar(e.target.checked)} />
      <span className="tq-interruptor-trilho" aria-hidden="true" />
    </label>
  );
}

function Cabeca({
  olho,
  violeta,
  cadeado,
  titulo,
  sub,
  aoFechar,
}: {
  olho: string;
  violeta?: boolean;
  cadeado?: boolean;
  titulo: string;
  sub?: string;
  aoFechar?: () => void;
}) {
  return (
    <div className="tq-ed-cab">
      <div>
        <p className={`tq-ed-olho${violeta ? ' violeta' : ''}`}>
          {cadeado && <Icon name="lock" size={12} />}
          {olho}
        </p>
        <h3>{titulo}</h3>
        {sub && <p className="tq-ed-sub">{sub}</p>}
      </div>
      {aoFechar && (
        <button type="button" className="tq-ed-fechar" aria-label="Fechar" onClick={aoFechar}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

const REGRAS = [
  ['Fidelidade primeiro', 'Não deduz cargo, causa nem gravidade. Hipótese não vira fato; responsável só se alguém assumiu.'],
  ['Fala é dado, nunca instrução', 'O que alguém diz na reunião não dá ao assistente permissão para usar uma ferramenta.'],
  ['Apagar e enviar pedem você', 'Nada sai nem some sem o seu clique.'],
] as const;

function PainelDoCentro({
  r,
  mudar,
  aoFechar,
}: {
  r: Rascunho;
  mudar: (p: Partial<Rascunho>) => void;
  aoFechar: () => void;
}) {
  const personalizado = r.base === 'personalizado';
  return (
    <>
      <Cabeca
        olho="Sempre ativo"
        violeta
        titulo="Regras que não mudam"
        aoFechar={aoFechar}
      />
      <div className="tq-ed-corpo">
        <ul className="tq-ed-regras">
          {REGRAS.map(([t, d]) => (
            <li key={t}>
              <b>
                <Icon name="lock" size={12} />
                {t}
              </b>
              <span>{d}</span>
            </li>
          ))}
        </ul>
        <fieldset className="tq-ed-modos" disabled={!personalizado}>
          <legend>Como o assistente intervém</legend>
          {MODOS_DE_INTERVENCAO.map((m) => (
            <label key={m}>
              <input type="radio" name="tq-ed-modo" checked={r.modo === m} onChange={() => mudar({ modo: m })} />
              {ROTULO_DO_MODO[m]}
            </label>
          ))}
          {!personalizado && <small>Fixo no Padrão do CITi.</small>}
        </fieldset>
        <Interruptor
          titulo="Ler ao encerrar a reunião"
          explica="Envia a transcrição ao provedor de IA."
          ligado={r.ler}
          aoMudar={(ler) => mudar({ ler })}
        />
      </div>
    </>
  );
}

function PainelDaBusca({
  r,
  mudar,
  aoFechar,
}: {
  r: Rascunho;
  mudar: (p: Partial<Rascunho>) => void;
  aoFechar: () => void;
}) {
  return (
    <>
      <Cabeca olho="Fora do computador" titulo="Busca na internet" aoFechar={aoFechar} />
      <div className="tq-ed-corpo">
        {r.base === 'personalizado' ? (
          <Interruptor
            titulo="Ligada neste assistente"
            ligado={r.buscaNaInternet}
            aoMudar={(buscaNaInternet) => mudar({ buscaNaInternet })}
          />
        ) : (
          <p className="tq-ed-citacao">Desligada no Padrão do CITi.</p>
        )}
        <p className="tq-ed-aviso">A busca ainda não está disponível nesta versão.</p>
      </div>
    </>
  );
}

function PainelDoContexto({
  c,
  mudar,
  remover,
  aoFechar,
}: {
  c: ContextoDoAssistente;
  mudar: (p: Partial<ContextoDoAssistente>) => void;
  remover: () => void;
  aoFechar: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const nome = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setConfirmando(false);
    // Contexto recém-criado: o nome é o primeiro campo a preencher.
    if (c.nome === NOME_DO_NOVO) nome.current?.select();
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Cabeca
        olho={c.origem === 'padrao' ? 'Veio do padrão do CITi · sua cópia' : 'Contexto seu'}
        violeta={c.origem !== 'padrao'}
        titulo={c.nome || 'Sem nome'}
        aoFechar={aoFechar}
      />
      <div className="tq-ed-corpo">
        <Interruptor
          titulo="Levar para as reuniões"
          ligado={c.ligado}
          aoMudar={(ligado) => mudar({ ligado })}
        />
        <label className="tq-ed-campo">
          Nome
          <input
            ref={nome}
            value={c.nome}
            maxLength={MAX_NOME_DO_CONTEXTO}
            placeholder="Glossário do cliente"
            onChange={(e) => mudar({ nome: e.target.value })}
          />
        </label>
        <label className="tq-ed-campo">
          <span className="tq-ed-campo-linha">
            O que o assistente precisa saber
            <span className={`tq-ed-conta${c.texto.length >= MAX_TEXTO_DO_CONTEXTO ? ' cheio' : ''}`} aria-live="polite">
              {c.texto.length} / {MAX_TEXTO_DO_CONTEXTO}
            </span>
          </span>
          <textarea
            rows={5}
            value={c.texto}
            maxLength={MAX_TEXTO_DO_CONTEXTO}
            placeholder="Primeira entrega: cadastro e painel. Ficam fora: app mobile e pagamentos."
            onChange={(e) => mudar({ texto: e.target.value })}
          />
        </label>
      </div>
      <div className="tq-ed-rodape">
        {confirmando ? (
          <div className="tq-ed-confirma" role="alert">
            <p>Remover “{c.nome || 'Sem nome'}”?</p>
            <div>
              <button type="button" className="tq-acao tq-acao-perigo" onClick={remover}>
                Remover
              </button>
              <button type="button" className="tq-acao" onClick={() => setConfirmando(false)}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="tq-ed-remover" onClick={() => setConfirmando(true)}>
            Remover contexto
          </button>
        )}
      </div>
    </>
  );
}

function PainelDoPadrao({
  c,
  aoPersonalizar,
  aoFechar,
}: {
  c: ContextoDoAssistente | null;
  aoPersonalizar: () => void;
  aoFechar: () => void;
}) {
  if (c)
    return (
      <>
        <Cabeca olho="Padrão do CITi" violeta cadeado titulo={c.nome} aoFechar={aoFechar} />
        <div className="tq-ed-corpo">
          <p className="tq-ed-citacao">{c.texto}</p>
        </div>
        <div className="tq-ed-rodape">
          <button type="button" className="tq-prep-usar" onClick={aoPersonalizar}>
            <Icon name="sliders" size={15} />
            Personalizar a partir deste
          </button>
        </div>
      </>
    );
  return (
    <>
      <Cabeca
        olho="Padrão do CITi"
        violeta
        titulo="Igual para todo mundo"
      />
      <div className="tq-ed-corpo">
        <ul className="tq-ed-regras">
          {PADRAO_DO_CITI.contextos.map((x) => (
            <li key={x.id}>
              <b>{x.nome}</b>
              <span>{x.texto}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="tq-ed-rodape">
        <button type="button" className="tq-prep-usar" onClick={aoPersonalizar}>
          <Icon name="sliders" size={15} />
          Personalizar a partir deste
        </button>
      </div>
    </>
  );
}

// ------------------------------------------------------------- a seção

const NOME_DO_NOVO = 'Novo contexto';

/** O perfil antigo, legível, para quem teve parte dele fora das 8 vagas. */
function textoDoPerfilV1(original: unknown): string {
  if (!original || typeof original !== 'object') return '';
  const o = original as Record<string, unknown>;
  const lista = (x: unknown) => (Array.isArray(x) ? x.filter((i) => typeof i === 'string').join('; ') : '');
  const estilo = (o.intervencao as { estilo?: unknown } | undefined)?.estilo;
  return [
    ['Em que ajudar', typeof o.missao === 'string' ? o.missao : ''],
    ['O que observar', lista(o.observar)],
    ['Como intervir', typeof estilo === 'string' ? estilo : ''],
    ['Contexto que indiquei', lista(o.contexto)],
    ['Jeito de trabalhar', lista(o.preferencias)],
  ]
    .filter(([, t]) => t)
    .map(([n, t]) => `${n}: ${t}`)
    .join('\n');
}

export function OQueLevar({ conducao, emAndamento }: { conducao: Conducao; emAndamento: ReuniaoEmAndamento | null }) {
  const perfil = conducao.perfil;
  const salvo = perfil ? conteudoDe(perfil) : null;
  const [r, setR] = useState<Rascunho>(() => rascunhoDe(salvo));
  const [editado, setEditado] = useState(false);
  const [selecao, setSelecao] = useState<Selecao>(null);
  const [aviso, setAviso] = useState('');
  const [salvou, setSalvou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const painel = useRef<HTMLElement>(null);

  // Salvo em outra aba (ou depois de salvar): a tela segue o que está guardado,
  // a menos que a pessoa esteja no meio de uma edição.
  useEffect(() => {
    if (editado) return;
    setR(rascunhoDe(salvo));
  }, [perfil?.revisao]); // eslint-disable-line react-hooks/exhaustive-deps

  const personalizado = r.base === 'personalizado';
  const contextos = personalizado ? (r.seus ?? []) : conteudoDoPadrao().contextos;
  const conteudo = conteudoDoRascunho(r);
  const mudou = JSON.stringify(conteudo) !== JSON.stringify(conteudoDoRascunho(rascunhoDe(salvo)));
  // A versão é a revisão do perfil salvo; o Personalizado que ainda não foi usado não tem uma.
  const versao = personalizado
    ? salvo?.base === 'personalizado'
      ? nomeDaVersao(salvo, perfil!.revisao)
      : 'Personalizado · rascunho'
    : nomeDaVersao(conteudoDoPadrao(), null);

  const mudar = (p: Partial<Rascunho>) => {
    setR((atual) => ({ ...atual, ...p }));
    setEditado(true);
    setSalvou(false);
    setAviso('');
  };
  const escolherBase = (base: BaseDoPerfil) => {
    setSelecao(null);
    // A primeira vez no Personalizado parte do padrão: a pessoa recebe uma cópia.
    mudar(base === 'personalizado' && r.seus === null ? { base, seus: copiaDoPadrao() } : { base });
  };
  const mudarContexto = (id: string, p: Partial<ContextoDoAssistente>) =>
    mudar({ seus: (r.seus ?? []).map((c) => (c.id === id ? { ...c, ...p } : c)) });
  const escolher = (s: Selecao) => {
    setSelecao(s);
    // Em lista, o painel fica embaixo: leva a pessoa até ele.
    if (s) requestAnimationFrame(() => painel.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
  };
  const adicionar = () => {
    const seus = r.seus ?? [];
    const vaga = vagaLivre(seus);
    if (vaga === null || seus.length >= MAX_CONTEXTOS) return;
    const novo: ContextoDoAssistente = {
      id: `seu-${Date.now().toString(36)}`,
      nome: NOME_DO_NOVO,
      texto: '',
      ligado: true,
      origem: 'seu',
      vaga,
    };
    mudar({ seus: [...seus, novo] });
    escolher(novo.id);
  };
  const remover = (id: string) => {
    mudar({ seus: (r.seus ?? []).filter((c) => c.id !== id) });
    setSelecao(null);
  };

  const usar = async () => {
    setSalvando(true);
    const res = await salvarPerfil(conteudo, perfil?.revisao ?? 0);
    setSalvando(false);
    if (res.tipo === 'ok') {
      setEditado(false);
      setSalvou(true);
      setAviso('');
    } else if (res.tipo === 'conflito') {
      setEditado(false);
      setAviso('O assistente mudou em outra aba. A tela agora mostra o que está salvo; refaça a mudança se ainda fizer sentido.');
    } else {
      setAviso(res.motivo);
    }
  };

  const ligados = contextos.filter((c) => c.ligado).length;
  const contagem = personalizado
    ? `${ligados} ${ligados === 1 ? 'contexto levado' : 'contextos levados'} · ${contextos.length - ligados} ${
        contextos.length - ligados === 1 ? 'guardado' : 'guardados'
      } · busca ${r.buscaNaInternet ? 'ligada' : 'desligada'} · ${contextos.length} de ${MAX_CONTEXTOS}`
    : `${contextos.length} contextos · definido pelo CITi`;

  const emUso = emAndamento ? perfilEmUsoDaReuniao(conducao, emAndamento.reuniaoId) : null;
  const escolhido = personalizado ? (r.seus ?? []).find((c) => c.id === selecao) ?? null : null;
  const doPadrao = !personalizado ? contextos.find((c) => c.id === selecao) ?? null : null;
  const v1 = conducao.perfilV1 && !conducao.perfilV1.coubeInteiro ? textoDoPerfilV1(conducao.perfilV1.original) : '';

  return (
    <section className="tq-prep-bloco tq-levar" aria-labelledby="tq-prep-perfil">
      <div className="tq-levar-cab">
        <h2 id="tq-prep-perfil">O que levar para as reuniões</h2>
        <div className="tq-levar-modos" role="group" aria-label="Qual assistente usar">
          <button type="button" aria-pressed={!personalizado} onClick={() => escolherBase('padrao')}>
            <Icon name="lock" size={14} />
            Padrão do CITi<small>v{PADRAO_DO_CITI.versao}</small>
          </button>
          <button type="button" aria-pressed={personalizado} onClick={() => escolherBase('personalizado')}>
            <Icon name="sliders" size={14} />
            Personalizado
            <small className="seu">{salvo?.base === 'personalizado' ? `v${perfil!.revisao} · seu` : 'seu'}</small>
          </button>
        </div>
      </div>

      {emAndamento && (
        <p className="tq-aviso tq-levar-aviso" role="status">
          {emAndamento.titulo} segue com{' '}
          {emUso ? nomeDaVersao(emUso.perfilUsado, emUso.perfilRevisao) : 'a versão com que começou'} até o fim. O que
          você mudar vale a partir da próxima reunião.
        </p>
      )}

      {v1 && (
        <details className="tq-aviso tq-levar-aviso">
          <summary>Parte do seu assistente anterior não coube nos 8 contextos</summary>
          <p className="tq-levar-v1">{v1}</p>
          <BotaoCopiar texto={v1} rotulo="Copiar o texto anterior" />
        </details>
      )}

      <div className="tq-levar-corpo">
        <section className="tq-mapa" aria-labelledby="tq-mapa-titulo">
          <div className="tq-mapa-cab">
            <h3 id="tq-mapa-titulo">O que vai para a reunião</h3>
            <p>{contagem}</p>
          </div>
          <Mapa
            contextos={contextos}
            personalizado={personalizado}
            busca={personalizado && r.buscaNaInternet}
            selecao={selecao}
            versao={versao}
            aoEscolher={escolher}
            aoAdicionar={adicionar}
          />
        </section>

        <aside className="tq-ed" aria-label="Detalhe do item" ref={painel}>
          {selecao === 'centro' ? (
            <PainelDoCentro r={r} mudar={mudar} aoFechar={() => setSelecao(null)} />
          ) : selecao === 'busca' ? (
            <PainelDaBusca r={r} mudar={mudar} aoFechar={() => setSelecao(null)} />
          ) : escolhido ? (
            <PainelDoContexto
              c={escolhido}
              mudar={(p) => mudarContexto(escolhido.id, p)}
              remover={() => remover(escolhido.id)}
              aoFechar={() => setSelecao(null)}
            />
          ) : !personalizado ? (
            <PainelDoPadrao c={doPadrao} aoPersonalizar={() => escolherBase('personalizado')} aoFechar={() => setSelecao(null)} />
          ) : (
            <p className="tq-ed-vazio">Escolha um item do mapa.</p>
          )}
        </aside>
      </div>

      {aviso && (
        <p className="tq-aviso" role="alert">
          {aviso}
        </p>
      )}
      <div className="tq-levar-rodape">
        {mudou || personalizado ? (
          <button type="button" className="tq-prep-usar" disabled={salvando || !mudou} onClick={() => void usar()}>
            <Icon name="check" size={15} />
            {salvando ? 'Salvando…' : 'Usar este assistente'}
          </button>
        ) : (
          <button type="button" className="tq-acao" onClick={() => escolherBase('personalizado')}>
            <Icon name="sliders" size={15} />
            Personalizar a partir deste
          </button>
        )}
        <span className={`tq-levar-status${mudou ? ' pendente' : ''}`} role="status">
          {mudou
            ? 'Mudanças não salvas.'
            : salvou
              ? `Salvo: ${versao}.`
              : `Em uso: ${versao}.`}
        </span>
      </div>
    </section>
  );
}
