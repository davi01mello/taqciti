/**
 * Conexões — ligar a sincronização e entregar o endereço do conector.
 *
 * Esta página dizia, honestamente, que nenhuma integração existia, e oferecia
 * o caminho manual (baixar o `.txt` e arrastar). O caminho manual continua
 * aqui embaixo, porque continua funcionando e é o que vale quando o servidor
 * está fora, quando a pessoa não quer sincronizar nada, ou quando ela só quer
 * mandar UMA reunião.
 *
 * ── As três regras de atrito que o arquivo obedece ───────────────────────
 *
 * **1. Nenhum diálogo do Google sem clique.** Ao abrir, a página só consulta
 * `estadoDaSincronizacao()`, que é silencioso por construção. A janela do
 * Google aparece apenas em `ligarSincronizacao()`, no `onClick`. Um diálogo
 * que aparece sozinho não é conveniência, é susto — e susto no primeiro
 * contato é onde alguém desiste.
 *
 * **2. Nada sobe sem um sim.** O Chrome pode devolver token silenciosamente
 * porque a pessoa autorizou a extensão em algum momento; isso não é ela
 * dizendo que quer as transcrições num servidor. O "sim" é explícito, dado
 * uma vez, neste botão.
 *
 * **3. Desligado é um estado completo.** Quem nunca ligar nada tem o produto
 * inteiro — a captura, os documentos, as notas. Sincronizar é aditivo, e é
 * por isso que não existe momento em que a pessoa seja obrigada a decidir.
 *
 * ── O endereço aparece uma vez ────────────────────────────────────────────
 *
 * O servidor guarda o hash do token, nunca o token. Então a resposta da
 * criação é a única vez em que ele existe fora daqui, e a tela precisa dizer
 * isso ANTES de a pessoa sair da página — não depois, quando já não há o que
 * fazer. Perdeu, gera outro e revoga o anterior; é barato.
 */
import { useCallback, useEffect, useState } from 'react';
import type { MeetingRecord } from '@/shared/types/domain';
import { downloadTranscript } from '@/features/history/export';
import { Icon } from '@/shared/ui/Icon';
import { formatDate } from '@/shared/ui/format';
import {
  type EstadoDaSincronizacao,
  desligarSincronizacao,
  estadoDaSincronizacao,
  ligarSincronizacao,
} from '@/shared/services/identidade';
import {
  ConectorIndisponivel,
  type TokenDoConector,
  type TokenRecemCriado,
  criarTokenDoConector,
  listarTokensDoConector,
  revogarTokenDoConector,
} from '@/shared/services/conector';

import type { DisponibilidadeDoTaq } from '@/features/taq/interface';
import { FluxoContaDoCiti, LinhaContaDoCiti, useContaDoCiti } from './ContaDoCiti';

function Cabecalho({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <header className="tq-pagina-topo">
      <h1>{titulo}</h1>
      <p>{sub}</p>
    </header>
  );
}

/** Só reuniões com transcrição servem de contexto para qualquer coisa. */
function temConteudo(r: MeetingRecord): boolean {
  return r.segments.length > 0;
}

function dataCurta(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatDate(ms) : '—';
}

// ------------------------------------------------------------- o endereço

/**
 * Copiar sem depender só do `navigator.clipboard`.
 *
 * A API moderna exige contexto seguro e pode ser negada por permissão; numa
 * página de extensão isso normalmente está tudo certo, mas "normalmente" não
 * é bom o bastante para a única ação que faz a integração funcionar. Se ela
 * falhar, o texto continua selecionável na tela — por isso o campo é um
 * `input` de verdade e não um `<code>`.
 */
async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

function EnderecoNovo({ criado }: { criado: TokenRecemCriado }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <div className="tq-conector-novo">
      <p className="tq-aviso">
        <strong>Copie agora — este endereço não aparece de novo.</strong> O servidor
        guarda só um resumo dele, não o valor. Cole-o na Claude ou no ChatGPT seguindo o
        passo a passo abaixo. Se perder, gere outro e revogue este.
      </p>
      <div className="tq-conector-endereco">
        <input readOnly value={criado.url} onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="tq-acao"
          onClick={async () => setCopiado(await copiar(criado.url))}
        >
          <Icon name={copiado ? 'check' : 'link'} size={15} />
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- o passo a passo

/**
 * As instruções por assistente.
 *
 * ── Duas regras que este guia obedece ────────────────────────────────────
 *
 * **1. Diz o LUGAR, não só o rótulo.** Os nomes de menu da Claude e do
 * ChatGPT mudam sem aviso. "Clique exatamente em X" e a pessoa não achar X é
 * pior do que descrever onde procurar e o que o botão faz.
 *
 * **2. Antecipa o que vai dar errado.** O aviso "não foi possível verificar
 * o servidor" da Claude apareceu em uso real, e quem não foi avisado
 * interpreta como "quebrou" e desiste — quando a resposta certa é seguir. Um
 * guia que só descreve o caminho feliz falha exatamente na hora em que
 * alguém precisa dele.
 */
function ComoConectar({ so }: { so: 'Claude' | 'ChatGPT' }) {
  return (
    <div className="tq-guia">
      {so === 'Claude' && (
      <details open>
        <summary>Conectar na Claude</summary>
        <ol className="tq-passos">
          <li>
            Copie o endereço acima (é o botão <strong>Copiar</strong>).
          </li>
          <li>
            Em <code>claude.ai</code>, abra <strong>Configurações</strong> e procure a
            seção <strong>Conectores</strong>.
          </li>
          <li>
            Clique em <strong>Adicionar conector personalizado</strong> e cole o endereço
            no campo de URL. Não há usuário nem senha para preencher: o endereço já é a
            credencial.
          </li>
          <li>
            <strong>Se aparecer um aviso</strong> dizendo que não foi possível verificar o
            servidor ou determinar como ele faz login, escolha{' '}
            <strong>continuar mesmo assim</strong>. Isso é esperado e está explicado logo
            abaixo — o conector funciona normalmente.
          </li>
          <li>
            Pronto. Pergunte algo como <em>“o que ficou decidido na última reunião?”</em>{' '}
            e autorize o uso da ferramenta quando ela pedir.
          </li>
        </ol>
      </details>
      )}

      {so === 'ChatGPT' && (
      <details open>
        <summary>Conectar no ChatGPT</summary>
        <ol className="tq-passos">
          <li>Copie o mesmo endereço — ele serve para os dois.</li>
          <li>
            Em <code>chatgpt.com</code>, abra <strong>Configurações</strong> e procure{' '}
            <strong>Conectores</strong> (em algumas contas aparece dentro de{' '}
            <strong>Aplicativos e conectores</strong>).
          </li>
          <li>
            Escolha criar um conector e cole o endereço. Quando pedir o tipo de
            autenticação, escolha <strong>nenhuma</strong> — a credencial já está no
            endereço.
          </li>
          <li>
            Numa conversa, ative o conector do TaqCiti nas ferramentas antes de perguntar.
            O ChatGPT não o usa sozinho como a Claude faz.
          </li>
        </ol>
        <p className="tq-meta">
          Aqui é honesto dizer o que não sabemos: o servidor anuncia as ferramentas{' '}
          <code>search</code> e <code>fetch</code> que o ChatGPT espera, mas a tela de
          conectores dele muda com frequência e costuma exigir plano pago. Se travar, o
          caminho manual lá embaixo funciona sempre.
        </p>
      </details>
      )}

      {so === 'Claude' && (
      <details>
        <summary>Por que a Claude avisa que “não verificou” o servidor</summary>
        <p>
          Porque ela procura um sistema de login completo (um servidor OAuth, como o do
          Notion ou do Google) e não encontra — este servidor não tem um, de propósito.
          Quem prova quem você é é o próprio endereço que você colou, e ele já vai
          autenticado.
        </p>
        <p>
          O aviso é sobre a AUSÊNCIA de uma tela de login, não sobre o servidor estar com
          problema. Seguir em frente é o caminho certo aqui.
        </p>
      </details>
      )}

      <details>
        <summary>As duas contas — e por que não precisam ser a mesma</summary>
        <p>
          <strong>Aqui, no TaqCiti:</strong> sua conta do Google. É ela que diz de quem é
          o acervo, e é por isso que só as SUAS reuniões aparecem.
        </p>
        <p>
          <strong>Na Claude ou no ChatGPT:</strong> qualquer conta, inclusive pessoal.
          Elas não precisam ser a mesma e nem precisam ser do CITi. O endereço que você
          colou é o que liga uma ponta à outra — quem paga a assinatura do assistente não
          tem nenhuma relação com de quem é o acervo.
        </p>
      </details>

      <details>
        <summary>O que o assistente passa a conseguir fazer</summary>
        <p>
          Procurar em <strong>todas</strong> as suas reuniões, documentos, conversas e
          notas já sincronizadas — e ler só o pedaço de que precisa. Ele não recebe o
          acervo inteiro de uma vez: busca, acha a posição exata e puxa aquele trecho.
        </p>
        <p>
          É isso que faz perguntas como <em>“quem ficou de fazer o deploy?”</em> custarem
          uma busca e algumas falas, em vez da transcrição toda — e é o que permite ter
          meses de reunião ao alcance sem estourar a conversa.
        </p>
        <p className="tq-meta">
          Ele só enxerga o que já subiu. Reunião capturada com a sincronização desligada
          não está lá.
        </p>
      </details>
    </div>
  );
}

// ----------------------------------------------------------------- a página

/**
 * Conexões é um HUB curto: em cima o que falta conectar, embaixo o que já
 * está. Cada "Conectar" abre o caminho certo ali mesmo, no próprio tile — o
 * login do Google, o endereço do conector para a Claude ou o ChatGPT. O que
 * ainda não existe nesta versão (Gmail, Agenda, WhatsApp) aparece com "Em
 * breve", sem botão: um botão que não inicia fluxo real seria decorativo.
 */
export function PaginaConexoes({
  registros,
}: {
  registros: MeetingRecord[];
  /** Mantido por compatibilidade: a lista de capacidades saiu desta página. */
  taq?: DisponibilidadeDoTaq;
}) {
  const [aberto, setAberto] = useState<string | null>(null);
  /** Para quem foi o endereço recém-criado: é no tile dele que ele aparece. */
  const [criadoPara, setCriadoPara] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoDaSincronizacao | null>(null);
  const [tokens, setTokens] = useState<TokenDoConector[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [criado, setCriado] = useState<TokenRecemCriado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [rotuloNovo, setRotuloNovo] = useState('');
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [confirmandoLimpeza, setConfirmandoLimpeza] = useState(false);
  /** A conta do CITi: diretório, e-mail e agenda (`features/integracoes`). */
  const conta = useContaDoCiti();

  const carregarTokens = useCallback(async () => {
    try {
      const doServidor = await listarTokensDoConector();
      setTokens(doServidor.tokens);
      setEmail(doServidor.email);
      setErro(null);
    } catch (e) {
      // Servidor fora não pode apagar a página: a parte local (ligar,
      // desligar, exportar manualmente) continua inteira.
      setErro(
        e instanceof ConectorIndisponivel ? e.message : 'Falha ao falar com o servidor.',
      );
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const atual = await estadoDaSincronizacao();
      setEstado(atual);
      if (atual.situacao === 'ligada') await carregarTokens();
    })();
  }, [carregarTokens]);

  async function aoLigar() {
    setOcupado(true);
    setErro(null);
    try {
      const novo = await ligarSincronizacao();
      setEstado(novo);
      if (novo.situacao === 'ligada') await carregarTokens();
    } finally {
      setOcupado(false);
    }
  }

  async function aoDesligar() {
    setOcupado(true);
    try {
      await desligarSincronizacao();
      setEstado({ situacao: 'desligada' });
      setTokens([]);
      setCriado(null);
      setEmail(null);
      setConfirmandoId(null);
      setConfirmandoLimpeza(false);
    } finally {
      setOcupado(false);
    }
  }

  async function aoGerar() {
    setOcupado(true);
    setErro(null);
    try {
      const novo = await criarTokenDoConector(rotuloNovo.trim() || undefined);
      setCriado(novo);
      setCriadoPara(null);
      setRotuloNovo('');
      await carregarTokens();
    } catch (e) {
      setErro(e instanceof ConectorIndisponivel ? e.message : 'Não foi possível gerar.');
    } finally {
      setOcupado(false);
    }
  }

  async function aoRevogar(id: string) {
    setConfirmandoId(null);
    setOcupado(true);
    try {
      await revogarTokenDoConector(id);
      if (criado?.id === id) setCriado(null);
      await carregarTokens();
    } catch (e) {
      setErro(
        e instanceof ConectorIndisponivel ? e.message : 'Não foi possível revogar.',
      );
    } finally {
      setOcupado(false);
    }
  }

  /**
   * Revoga de uma vez só os que NUNCA foram usados.
   *
   * É a única forma de limpeza em massa que não arrisca derrubar uma conexão
   * viva: `usadoEm` nulo significa que nenhum cliente de MCP apresentou este
   * endereço nem uma vez, então não há Claude nem ChatGPT do outro lado para
   * quebrar. Um "revogar todos" pareceria mais completo e seria a forma
   * errada de resolver acúmulo — apagaria também o endereço que alguém está
   * usando agora.
   */
  async function aoRevogarNaoUsados() {
    setConfirmandoLimpeza(false);
    const alvos = ativos.filter((t) => !t.usadoEm);
    if (alvos.length === 0) return;
    setOcupado(true);
    setErro(null);
    try {
      for (const t of alvos) await revogarTokenDoConector(t.id);
      await carregarTokens();
    } catch (e) {
      setErro(
        e instanceof ConectorIndisponivel ? e.message : 'Não foi possível revogar.',
      );
    } finally {
      setOcupado(false);
    }
  }

  const comConteudo = registros.filter(temConteudo);
  const ativos = tokens.filter((t) => !t.revogadoEm);
  const naoUsados = ativos.filter((t) => !t.usadoEm);
  const ligada = estado?.situacao === 'ligada';

  /** O assistente já tem endereço: o rótulo é o que o tile deu ao gerá-lo. */
  const temEndereco = (nome: string) =>
    ativos.some((t) => (t.rotulo ?? '').toLowerCase().includes(nome.toLowerCase()));

  const gerarPara = async (nome: string) => {
    setRotuloNovo(nome);
    setOcupado(true);
    setErro(null);
    try {
      const novo = await criarTokenDoConector(nome);
      setCriado(novo);
      setCriadoPara(nome);
      await carregarTokens();
    } catch (e) {
      setErro(e instanceof ConectorIndisponivel ? e.message : 'Não foi possível gerar.');
    } finally {
      setOcupado(false);
      setRotuloNovo('');
    }
  };

  /** O caminho de um assistente (Claude ou ChatGPT): sincronizar, gerar, colar. */
  const fluxoDoAssistente = (nome: 'Claude' | 'ChatGPT') => {
    if (!ligada)
      return (
        <div className="tq-hub-fluxo">
          <p className="tq-hub-nota">
            O {nome} consulta as reuniões pelo servidor do TaqCiti. Primeiro ligue a
            sincronização com a sua conta Google — a janela do Google abre só com o seu clique.
          </p>
          <div className="tq-acoes">
            <button
              type="button"
              className="tq-acao tq-acao-principal"
              disabled={ocupado || estado?.situacao === 'sem-oauth'}
              onClick={aoLigar}
            >
              Ligar sincronização
            </button>
            <button type="button" className="tq-acao" onClick={() => setAberto(null)}>
              Cancelar
            </button>
          </div>
        </div>
      );
    return (
      <div className="tq-hub-fluxo">
        {criado && criadoPara === nome ? (
          <>
            <EnderecoNovo criado={criado} />
            <ComoConectar so={nome} />
          </>
        ) : (
          <>
            <p className="tq-hub-nota">
              Gera um endereço só para o {nome}. Ele vale como senha: quem tiver o link
              alcança o seu acervo, e ele aparece uma vez só.
            </p>
            <div className="tq-acoes">
              <button
                type="button"
                className="tq-acao tq-acao-principal"
                disabled={ocupado}
                onClick={() => void gerarPara(nome)}
              >
                Gerar endereço
              </button>
              <button type="button" className="tq-acao" onClick={() => setAberto(null)}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  const pendentes: Array<{
    id: string;
    nome: string;
    faz: string;
    icone: React.ReactNode;
    fluxo?: React.ReactNode;
    emBreve?: true;
  }> = [
    ...(!ligada
      ? [
          {
            id: 'google',
            nome: 'Conta Google',
            faz: 'Sincroniza o acervo para os assistentes consultarem.',
            icone: <span>G</span>,
            fluxo: fluxoDoGoogle(),
          },
        ]
      : []),
    ...(!temEndereco('Claude')
      ? [{ id: 'claude', nome: 'Claude', faz: 'Responde sobre as suas reuniões dentro da Claude.', icone: <span>C</span>, fluxo: fluxoDoAssistente('Claude') }]
      : []),
    ...(!temEndereco('ChatGPT')
      ? [{ id: 'chatgpt', nome: 'ChatGPT', faz: 'Busca e abre as suas reuniões no ChatGPT.', icone: <span>G</span>, fluxo: fluxoDoAssistente('ChatGPT') }]
      : []),
    ...(!conta.conexao
      ? [
          {
            id: 'conta-citi',
            nome: 'Conta do CITi',
            faz: 'Acha colegas, envia e-mails e atas e marca reuniões, com a sua confirmação.',
            icone: <span>@</span>,
            fluxo: <FluxoContaDoCiti conta={conta} onCancelar={() => setAberto(null)} />,
          },
        ]
      : []),
    { id: 'whatsapp', nome: 'WhatsApp', faz: 'Envia atas e recados por mensagem.', icone: <Icon name="chats" size={18} />, emBreve: true },
  ];

  function fluxoDoGoogle() {
    if (estado?.situacao === 'sem-oauth')
      return (
        <p className="tq-hub-nota">
          Falta registrar o cliente OAuth desta extensão — sem ele o Chrome não identifica a sua
          conta. O roteiro está em <code>docs/google-oauth-setup.md</code>.
        </p>
      );
    return (
      <div className="tq-hub-fluxo">
        {estado?.situacao === 'precisa-permissao' ? (
          <p className="tq-hub-nota">
            A sessão do Google expirou. Reconectar resolve — nada foi perdido.
          </p>
        ) : (
          <>
            {estado?.situacao === 'desligada' && estado.motivo && (
              <p className="tq-hub-nota tq-hub-falha">O Google recusou: {estado.motivo}</p>
            )}
            <p className="tq-hub-nota">
              Abre o login do Google — escolha a sua conta do CITi. Enquanto estiver desligado,
              nada sai deste computador e o resto do produto funciona igual.
            </p>
          </>
        )}
        <div className="tq-acoes">
          <button
            type="button"
            className="tq-acao tq-acao-principal"
            disabled={ocupado}
            onClick={aoLigar}
          >
            {estado?.situacao === 'precisa-permissao' ? 'Reconectar' : 'Ligar sincronização'}
          </button>
          <button type="button" className="tq-acao" onClick={() => setAberto(null)}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tq-pagina tq-conexoes">
      <Cabecalho
        titulo="Conexões"
        sub="As ferramentas que o TaqCiti usa para responder, enviar e agendar por você."
      />

      {estado === null ? (
        <p className="tq-vazio">Verificando…</p>
      ) : (
        <>
          {erro && <div className="tq-aviso">{erro}</div>}

          <section className="tq-hub-grupo" aria-labelledby="tq-hub-pendentes">
            <h2 id="tq-hub-pendentes">
              Para conectar <span className="tq-hub-conta">{pendentes.length}</span>
            </h2>
            <ul className="tq-hub">
              {pendentes.map((c) => (
                <li
                  key={c.id}
                  className={`tq-hub-tile${aberto === c.id ? ' aberta' : ''}${c.emBreve ? ' em-breve' : ''}`}
                >
                  <div className="tq-hub-tile-topo">
                    <span className="tq-hub-icone" aria-hidden="true">
                      {c.icone}
                    </span>
                    <div>
                      <b>{c.nome}</b>
                      <p>{c.faz}</p>
                    </div>
                    {c.emBreve ? (
                      <span className="tq-hub-breve">Em breve</span>
                    ) : (
                      aberto !== c.id && (
                        <button
                          type="button"
                          className="tq-acao tq-pilula"
                          onClick={() => setAberto(c.id)}
                        >
                          Conectar
                        </button>
                      )
                    )}
                  </div>
                  {aberto === c.id && c.fluxo}
                </li>
              ))}
            </ul>
          </section>

          <section className="tq-hub-grupo" aria-labelledby="tq-hub-conectadas">
            <h2 id="tq-hub-conectadas">
              Conectadas{' '}
              <span className="tq-hub-conta">{1 + (ligada ? 1 : 0) + (conta.conexao ? 1 : 0) + ativos.length}</span>
            </h2>
            <ul className="tq-hub-lista">
              <li>
                <span className="tq-hub-icone" aria-hidden="true">
                  <Icon name="chats" size={16} />
                </span>
                <div>
                  <b>Google Meet</b>
                  <small>ouve as legendas — funciona sozinho</small>
                </div>
                <span className="tq-hub-ok" aria-label="conectado">
                  <Icon name="check" size={16} />
                </span>
              </li>

              {ligada && (
                <li>
                  <span className="tq-hub-icone" aria-hidden="true">
                    <span>G</span>
                  </span>
                  <div>
                    <b>Conta Google</b>
                    <small>{email ?? estado.email ?? 'sincronização ligada'}</small>
                  </div>
                  {confirmandoId === 'google' ? (
                    <span className="tq-acoes">
                      <button
                        type="button"
                        className="tq-linkish tq-linkish-perigo"
                        disabled={ocupado}
                        onClick={() => {
                          setConfirmandoId(null);
                          void aoDesligar();
                        }}
                      >
                        Desligar
                      </button>
                      <button type="button" className="tq-linkish" onClick={() => setConfirmandoId(null)}>
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="tq-linkish"
                      disabled={ocupado}
                      title="Desligar para de enviar daqui para frente. O que já subiu continua lá."
                      onClick={() => setConfirmandoId('google')}
                    >
                      Desconectar
                    </button>
                  )}
                </li>
              )}

              <LinhaContaDoCiti conta={conta} />

              {ativos.map((t) => (
                <li key={t.id}>
                  <span className="tq-hub-icone" aria-hidden="true">
                    <Icon name="link" size={16} />
                  </span>
                  <div>
                    <b>{t.rotulo ?? 'Endereço do conector'}</b>
                    <small>
                      criado em {dataCurta(t.criadoEm)}
                      {t.usadoEm ? ` · último uso em ${dataCurta(t.usadoEm)}` : ' · nunca usado'}
                    </small>
                  </div>
                  {confirmandoId === t.id ? (
                    <span className="tq-acoes">
                      <button
                        type="button"
                        className="tq-linkish tq-linkish-perigo"
                        disabled={ocupado}
                        onClick={() => aoRevogar(t.id)}
                      >
                        Revogar
                      </button>
                      <button type="button" className="tq-linkish" onClick={() => setConfirmandoId(null)}>
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="tq-linkish"
                      disabled={ocupado}
                      onClick={() => setConfirmandoId(t.id)}
                    >
                      Revogar
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {ativos.length > 2 && naoUsados.length > 0 && (
              <p className="tq-hub-nota tq-hub-muitos">
                {ativos.length} endereços ativos — cada um vale como senha.{' '}
                {confirmandoLimpeza ? (
                  <>
                    <button
                      type="button"
                      className="tq-linkish tq-linkish-perigo"
                      disabled={ocupado}
                      onClick={aoRevogarNaoUsados}
                    >
                      Confirmar
                    </button>
                    <button type="button" className="tq-linkish" onClick={() => setConfirmandoLimpeza(false)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button type="button" className="tq-linkish" onClick={() => setConfirmandoLimpeza(true)}>
                    Revogar os {naoUsados.length} que nunca foram usados
                  </button>
                )}
              </p>
            )}

            {/* Gerar outro endereço, com nome livre, para quem já conectou os dois. */}
            {ligada && temEndereco('Claude') && temEndereco('ChatGPT') && (
              <div className="tq-acoes tq-hub-outro">
                <input
                  type="text"
                  className="tq-rotulo-input"
                  placeholder="Nome de outro endereço (opcional)"
                  value={rotuloNovo}
                  onChange={(e) => setRotuloNovo(e.target.value)}
                  disabled={ocupado}
                  maxLength={60}
                />
                <button type="button" className="tq-acao" disabled={ocupado} onClick={aoGerar}>
                  <Icon name="plus" size={15} />
                  Gerar endereço
                </button>
              </div>
            )}
            {criado && criadoPara === null && <EnderecoNovo criado={criado} />}
          </section>
        </>
      )}

      <p className="tq-hub-pe">
        Envio e agendamento sempre vão pedir a sua confirmação. Sem conexões, tudo continua
        funcionando neste computador.
      </p>

      <div className="tq-guia">
        <details>
          <summary>Sem conectar: o caminho manual</summary>
          <p>
            Baixe a transcrição em <code>.txt</code> e anexe na Claude ou no ChatGPT — funciona
            sempre, inclusive com a sincronização desligada.
          </p>
          {comConteudo.length === 0 ? (
            <p className="tq-vazio">Nenhuma reunião com transcrição para exportar ainda.</p>
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
      </div>
    </div>
  );
}

