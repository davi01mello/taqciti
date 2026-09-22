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
        <strong>Copie agora — este endereço não aparece de novo.</strong> O servidor guarda
        só um resumo dele, não o valor. Cole-o na Claude ou no ChatGPT seguindo o passo a
        passo abaixo. Se perder, gere outro e revogue este.
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
function ComoConectar() {
  return (
    <div className="tq-guia">
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

      <details>
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

      <details>
        <summary>As duas contas — e por que não precisam ser a mesma</summary>
        <p>
          <strong>Aqui, no TaqCiti:</strong> sua conta do Google. É ela que diz de quem é o
          acervo, e é por isso que só as SUAS reuniões aparecem.
        </p>
        <p>
          <strong>Na Claude ou no ChatGPT:</strong> qualquer conta, inclusive pessoal. Elas
          não precisam ser a mesma e nem precisam ser do CITi. O endereço que você colou é
          o que liga uma ponta à outra — quem paga a assinatura do assistente não tem
          nenhuma relação com de quem é o acervo.
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

export function PaginaConexoes({ registros }: { registros: MeetingRecord[] }) {
  const [estado, setEstado] = useState<EstadoDaSincronizacao | null>(null);
  const [tokens, setTokens] = useState<TokenDoConector[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [criado, setCriado] = useState<TokenRecemCriado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [rotuloNovo, setRotuloNovo] = useState('');
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [confirmandoLimpeza, setConfirmandoLimpeza] = useState(false);

  const carregarTokens = useCallback(async () => {
    try {
      const doServidor = await listarTokensDoConector();
      setTokens(doServidor.tokens);
      setEmail(doServidor.email);
      setErro(null);
    } catch (e) {
      // Servidor fora não pode apagar a página: a parte local (ligar,
      // desligar, exportar manualmente) continua inteira.
      setErro(e instanceof ConectorIndisponivel ? e.message : 'Falha ao falar com o servidor.');
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
      setErro(e instanceof ConectorIndisponivel ? e.message : 'Não foi possível revogar.');
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
      setErro(e instanceof ConectorIndisponivel ? e.message : 'Não foi possível revogar.');
    } finally {
      setOcupado(false);
    }
  }

  const comConteudo = registros.filter(temConteudo);
  const ativos = tokens.filter((t) => !t.revogadoEm);
  const revogados = tokens.filter((t) => t.revogadoEm);
  const naoUsados = ativos.filter((t) => !t.usadoEm);

  return (
    <div className="tq-pagina">
      <Cabecalho
        titulo="Conexões"
        sub="Dê à Claude e ao ChatGPT acesso às suas reuniões — copiando e colando um link."
      />

      {estado === null ? (
        <p className="tq-vazio">Verificando…</p>
      ) : (
        <>
          {estado.situacao === 'sem-oauth' && (
            <div className="tq-aviso">
              <strong>Falta registrar o cliente OAuth desta extensão.</strong> Sem ele o
              Chrome não tem como identificar sua conta, e a sincronização não pode ser
              ligada. O mesmo vale para o envio ao Google Docs. O roteiro está em{' '}
              <code>docs/google-oauth-setup.md</code>.
            </div>
          )}

          {estado.situacao === 'desligada' && (
            <>
              {estado.motivo && (
                <div className="tq-aviso tq-aviso-falha">
                  <strong>O Google recusou ligar a sincronização.</strong> {estado.motivo}
                </div>
              )}
              <div className="tq-aviso">
                Sincronizar envia suas reuniões, documentos, conversas e notas para o
                servidor do TaqCiti, para que um assistente possa consultá-los. <strong>
                  Enquanto estiver desligado, nada sai desta máquina
                </strong>{' '}
                e o resto do produto funciona igual.
              </div>
              <p className="tq-meta">
                O clique abre a tela de login do Google — a mesma que qualquer site mostra
                — com a lista de contas para escolher. Selecione a sua conta do CITi ali;
                não importa qual conta o Chrome já estiver usando.
              </p>
              <div className="tq-acoes">
                <button
                  type="button"
                  className="tq-acao tq-acao-principal"
                  disabled={ocupado}
                  onClick={aoLigar}
                >
                  <Icon name="link" size={15} />
                  Ligar sincronização
                </button>
              </div>
              <p className="tq-meta">
                Não pedimos acesso ao seu Drive aqui — isso só é pedido se você usar
                “enviar para o Google Docs”.
              </p>
            </>
          )}

          {estado.situacao === 'precisa-permissao' && (
            <>
              <div className="tq-aviso">
                <strong>A sessão do Google expirou.</strong> Costuma ser revogação de acesso
                nas configurações da conta, ou tempo demais sem usar. Reconectar resolve —
                nada foi perdido.
              </div>
              <div className="tq-acoes">
                <button
                  type="button"
                  className="tq-acao tq-acao-principal"
                  disabled={ocupado}
                  onClick={aoLigar}
                >
                  <Icon name="link" size={15} />
                  Reconectar
                </button>
                <button
                  type="button"
                  className="tq-acao tq-acao-perigo"
                  disabled={ocupado}
                  onClick={aoDesligar}
                >
                  Desligar
                </button>
              </div>
            </>
          )}

          {estado.situacao === 'ligada' && (
            <>
              <div className="tq-acoes">
                <span className="tq-chip">
                  <Icon name="check" size={14} /> {email ?? estado.email ?? 'conectado'}
                </span>
                <button
                  type="button"
                  className="tq-acao tq-acao-perigo"
                  disabled={ocupado}
                  onClick={aoDesligar}
                >
                  Desligar
                </button>
              </div>
              <p className="tq-meta">
                Esta é a conta que diz de quem é o acervo — só as reuniões dela aparecem
                para o assistente. A conta que você usa na Claude ou no ChatGPT pode ser
                outra, inclusive pessoal; as duas não precisam combinar.
              </p>
              <p className="tq-meta">
                Desligar para de enviar daqui para frente. O que já subiu continua lá —
                revogar os endereços abaixo é o que tira o acesso dos assistentes.
              </p>

              {erro && <div className="tq-aviso">{erro}</div>}

              <h2 className="tq-secao-titulo">Endereços do conector</h2>
              <p className="tq-meta">
                Um endereço é um link que você cola na Claude ou no ChatGPT — e é só isso
                que a conexão exige, sem instalar nada e sem criar conta em lugar nenhum.
                Ele já vai autenticado, então <strong>vale como senha</strong>: quem tiver o
                link alcança seu acervo. Gere um por assistente, e revogue o que não usa.
              </p>

              {criado ? (
                <EnderecoNovo criado={criado} />
              ) : (
                tokens.length > 0 && (
                  <p className="tq-meta">
                    Um endereço já criado não aparece de novo — o servidor guarda só um
                    resumo dele. Perdeu o seu? Gere outro e revogue o antigo.
                  </p>
                )
              )}

              <div className="tq-acoes">
                <input
                  type="text"
                  className="tq-rotulo-input"
                  placeholder="Nome deste endereço (opcional) — ex.: Claude do trabalho"
                  value={rotuloNovo}
                  onChange={(e) => setRotuloNovo(e.target.value)}
                  disabled={ocupado}
                  maxLength={60}
                />
                {/* Verde só enquanto não houver nenhum: aí ele é a única coisa
                    a fazer. Com endereços já criados, gerar mais um é opção
                    entre outras, e um botão gritando seria convite a
                    acumular credencial sem motivo. */}
                <button
                  type="button"
                  className={`tq-acao${ativos.length === 0 ? ' tq-acao-principal' : ''}`}
                  disabled={ocupado}
                  onClick={aoGerar}
                >
                  <Icon name="plus" size={15} />
                  Gerar endereço
                </button>
              </div>

              {ativos.length > 2 && (
                <div className="tq-aviso">
                  Você tem <strong>{ativos.length} endereços ativos</strong>. Normalmente
                  bastam dois — um por assistente. Cada endereço vale como senha do seu
                  acervo inteiro, então sobrar credencial esquecida é risco, não conveniência.
                  {naoUsados.length > 0 && (
                    <div className="tq-acoes tq-aviso-acao">
                      {confirmandoLimpeza ? (
                        <>
                          <span className="tq-confirma-inline">
                            Revogar os {naoUsados.length} endereços nunca usados?
                          </span>
                          <button
                            type="button"
                            className="tq-linkish tq-linkish-perigo"
                            disabled={ocupado}
                            onClick={aoRevogarNaoUsados}
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            className="tq-linkish"
                            disabled={ocupado}
                            onClick={() => setConfirmandoLimpeza(false)}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="tq-linkish"
                          disabled={ocupado}
                          onClick={() => setConfirmandoLimpeza(true)}
                        >
                          Revogar os {naoUsados.length} que nunca foram usados
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {tokens.length === 0 ? (
                <p className="tq-vazio">
                  Nenhum endereço criado ainda — gere o primeiro acima para conectar a
                  Claude ou o ChatGPT.
                </p>
              ) : (
                <>
                  {ativos.length === 0 ? (
                    <p className="tq-vazio">
                      Nenhum endereço ativo — gere um acima para conectar a Claude ou o
                      ChatGPT.
                    </p>
                  ) : (
                    <div className="tq-lista tq-lista-densa">
                      {ativos.map((t) => (
                        <div key={t.id} className="tq-item">
                          <span>
                            <strong>{t.rotulo ?? 'Endereço do conector'}</strong>
                            <small>
                              criado em {dataCurta(t.criadoEm)}
                              {t.usadoEm
                                ? ` · último uso em ${dataCurta(t.usadoEm)}`
                                : ' · nunca usado'}
                            </small>
                          </span>
                          {confirmandoId === t.id ? (
                            <span className="tq-acoes">
                              <button
                                type="button"
                                className="tq-linkish tq-linkish-perigo"
                                disabled={ocupado}
                                onClick={() => aoRevogar(t.id)}
                              >
                                Confirmar
                              </button>
                              <button
                                type="button"
                                className="tq-linkish"
                                disabled={ocupado}
                                onClick={() => setConfirmandoId(null)}
                              >
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
                        </div>
                      ))}
                    </div>
                  )}

                  {revogados.length > 0 && (
                    <details className="tq-guia">
                      <summary>Endereços revogados ({revogados.length})</summary>
                      <div className="tq-lista tq-lista-densa">
                        {revogados.map((t) => (
                          <div key={t.id} className="tq-item">
                            <span>
                              <strong>{t.rotulo ?? 'Endereço do conector'}</strong>
                              <small>
                                criado em {dataCurta(t.criadoEm)} · revogado em{' '}
                                {dataCurta(t.revogadoEm ?? '')}
                              </small>
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}

              {ativos.length > 0 && <ComoConectar />}
            </>
          )}
        </>
      )}

      <h2 className="tq-secao-titulo">Sem conectar: o caminho manual</h2>
      <p className="tq-meta">
        Funciona sempre, inclusive com a sincronização desligada. Serve bem para mandar uma
        reunião só.
      </p>

      <div className="tq-guia">
        <details>
          <summary>Baixar a transcrição e arrastar para o assistente</summary>
          <p>
            O arquivo <code>.txt</code> sai com o título, a data e as falas na ordem — é
            exatamente o que a extensão capturou. Nos dois assistentes, prefira anexar o
            arquivo a colar o texto: o anexo não consome o limite da janela de mensagem do
            mesmo jeito.
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
