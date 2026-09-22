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
        <strong>Copie agora.</strong> Este endereço não aparece de novo — o servidor guarda
        só um resumo dele, não o valor. Se perder, gere outro e revogue este.
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
 * Os nomes de menu são os que os dois usam hoje, e é honesto dizer que eles
 * mudam: escrever "clique exatamente em X" e a pessoa não achar X é pior do
 * que descrever onde procurar. Por isso cada passo diz o LUGAR e o que
 * procurar, não só o rótulo.
 */
function ComoConectar() {
  return (
    <div className="tq-guia">
      <details open>
        <summary>No Claude</summary>
        <p>
          Abra <code>claude.ai</code> e vá em <strong>Configurações → Conectores</strong>.
          Escolha adicionar um conector personalizado (<em>custom connector</em>) e cole o
          endereço acima.
        </p>
        <p className="tq-meta">
          Conectores personalizados exigem um plano pago da Anthropic. Se a opção não
          aparecer, é isso — e não o endereço.
        </p>
      </details>

      <details>
        <summary>No ChatGPT</summary>
        <p>
          Em <code>chatgpt.com</code>, vá em <strong>Configurações → Conectores</strong> e
          adicione um conector por URL, colando o endereço acima.
        </p>
        <p className="tq-meta">
          No ChatGPT isto costuma estar atrás do modo de desenvolvedor e de um plano pago,
          e o suporte varia mais que no Claude. Se não funcionar de primeira, o caminho
          manual lá embaixo continua valendo.
        </p>
      </details>

      <details>
        <summary>O que o assistente passa a conseguir fazer</summary>
        <p>
          Procurar em todas as suas reuniões, documentos, conversas e notas — e ler só o
          pedaço de que precisa. Ele não recebe o acervo inteiro de uma vez: busca, acha a
          posição exata e puxa aquele trecho.
        </p>
        <p>
          É isso que faz perguntas como <em>“quem ficou de fazer o deploy?”</em> custarem
          uma busca e algumas falas, em vez da transcrição toda.
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
    } finally {
      setOcupado(false);
    }
  }

  async function aoGerar() {
    setOcupado(true);
    setErro(null);
    try {
      const novo = await criarTokenDoConector();
      setCriado(novo);
      await carregarTokens();
    } catch (e) {
      setErro(e instanceof ConectorIndisponivel ? e.message : 'Não foi possível gerar.');
    } finally {
      setOcupado(false);
    }
  }

  async function aoRevogar(id: string) {
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

  const comConteudo = registros.filter(temConteudo);
  const ativos = tokens.filter((t) => !t.revogadoEm);

  return (
    <div className="tq-pagina">
      <Cabecalho
        titulo="Conexões"
        sub="Dê ao Claude e ao ChatGPT acesso às suas reuniões — sem colar arquivo."
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
              {/*
                A distinção que este parágrafo existe para ensinar — antes do clique, não
                depois — é a que confunde todo mundo na primeira vez: a conta usada aqui é
                a do NAVEGADOR (o ícone de perfil), não a de uma aba aberta do Gmail. As
                duas parecem a mesma coisa e não são: dá pra estar logado no Gmail da
                empresa numa aba e o Chrome, como programa, continuar com o perfil pessoal
                — e é o perfil que decide, silenciosamente, sem perguntar.
              */}
              <p className="tq-meta">
                <strong>Antes de clicar:</strong> confira o ícone de perfil no canto
                superior direito do Chrome. É essa conta — a do navegador, não a de uma
                aba aberta do Gmail — que a sincronização vai usar. Se não for a sua conta
                do CITi, troque de perfil ali antes de continuar; senão a extensão liga
                com a conta errada, sem avisar.
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
                <strong>O Chrome não está mais liberando o acesso à sua conta.</strong>{' '}
                Costuma ser sair da conta, trocar de perfil ou revogar o acesso nas
                configurações do Google. Reconectar resolve — nada foi perdido.
              </div>
              <p className="tq-meta">
                Antes de reconectar, confira o ícone de perfil no canto superior direito
                do Chrome: é essa conta que vale, não a de uma aba aberta do Gmail.
              </p>
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
                Desligar para de enviar daqui para frente. O que já subiu continua lá —
                revogar os endereços abaixo é o que tira o acesso dos assistentes.
              </p>

              {erro && <div className="tq-aviso">{erro}</div>}

              <h2 className="tq-secao-titulo">Endereços do conector</h2>
              <p className="tq-meta">
                Um endereço por assistente. Quem tiver o endereço alcança seu acervo, então
                trate-o como senha — e revogue o que não usa. Um endereço já criado não pode
                ser mostrado de novo: se você não o guardou, gere outro e revogue o antigo.
              </p>

              {criado && <EnderecoNovo criado={criado} />}

              <div className="tq-acoes">
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

              {tokens.length === 0 ? (
                <p className="tq-vazio">Nenhum endereço criado ainda.</p>
              ) : (
                <div className="tq-lista tq-lista-densa">
                  {tokens.map((t) => (
                    <div key={t.id} className="tq-item">
                      <span>
                        <strong>{t.rotulo ?? 'Endereço do conector'}</strong>
                        <small>
                          criado em {dataCurta(t.criadoEm)}
                          {t.revogadoEm
                            ? ` · revogado em ${dataCurta(t.revogadoEm)}`
                            : t.usadoEm
                              ? ` · último uso em ${dataCurta(t.usadoEm)}`
                              : ' · nunca usado'}
                        </small>
                      </span>
                      {!t.revogadoEm && (
                        <button
                          type="button"
                          className="tq-linkish"
                          disabled={ocupado}
                          onClick={() => aoRevogar(t.id)}
                        >
                          Revogar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
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
