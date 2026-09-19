/**
 * Monta o pacote único de distribuição do TaqCiti: um ZIP com o guia
 * "COMECE_AQUI.html" e os três instaladores nativos, na estrutura que a pessoa
 * encontra depois de extrair.
 *
 *     TaqCiti/
 *       COMECE_AQUI.html
 *       Instaladores/taqciti-instalador-windows-<versão>.exe
 *       Instaladores/taqciti-instalador-mac-<versão>.pkg
 *       Instaladores/taqciti-instalador-linux-<versão>.run
 *
 * Os três ficam SOLTOS em `Instaladores/`, sem subpasta por sistema: a
 * extensão do arquivo já diz de quem ele é, e o guia manda abrir o nome exato.
 * Uma pasta a mais era um clique a mais para chegar no mesmo lugar.
 *
 * POR QUE ESTE SCRIPT EXISTE. Antes, o job de distribuição publicava os três
 * instaladores soltos na pasta do Drive. Como o nome carrega a versão, cada
 * release SOMAVA três arquivos em vez de substituir os anteriores — e quem
 * abria a pasta via seis, oito, doze arquivos e tinha que adivinhar qual era o
 * seu sistema e qual era a versão nova. Um pacote só, com um guia dentro,
 * troca essa adivinhação por dois cliques.
 *
 * A REGRA QUE MANDA NO RESTO DO ARQUIVO: nunca publicar pacote incompleto.
 * Como o ZIP tem nome fixo e sobrescreve o anterior no Drive, um pacote
 * faltando o instalador do Mac não seria um erro visível — seria a entrega
 * boa de ontem trocada por uma pela metade, e o time só descobriria na hora de
 * instalar. Por isso tudo aqui é conferido ANTES de gravar, e o que for
 * gravado é reaberto e conferido de novo; qualquer falha sai com código
 * diferente de zero sem deixar arquivo para trás.
 *
 * Uso:
 *   node scripts/package-distribution.mjs [opções]
 *
 *   --origem <dir>     onde procurar os instaladores (padrão: release/)
 *   --saida <dir>      onde montar o pacote (padrão: release/pacote/)
 *   --versao <x.y.z>   confere que os instaladores são dessa versão
 *   --somente-guia     gera só o guia, para revisar o visual sem ter os
 *                      três instaladores em mãos (não gera ZIP)
 *   --conferir <zip>   não monta nada: abre um ZIP já pronto e confere se a
 *                      estrutura esperada está lá. É a trava que o job roda
 *                      logo antes de publicar, sobre o artefato que ele
 *                      baixou — um pacote montado num job e publicado em
 *                      outro passa por duas mãos, e esta é a segunda.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { crcDe, lerZip, montarZip } from './lib/zip.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/*
 * A ORIGEM DO GUIA NO PROJETO é `assetsingestion/`, e é de lá que ele entra no
 * pacote. O HTML é autossuficiente — CSS, arte de fundo e script já vivem
 * dentro dele — então "incorporar" aqui é copiar o arquivo para a raiz de
 * TaqCiti/ preenchendo os dois marcadores de nome de instalador, e nada mais.
 *
 * O arquivo é procurado por padrão (`COMECE_AQUI*.html`) em vez de por nome
 * exato porque é assim que ele chega: baixado do navegador, às vezes com o
 * sufixo "(1)". Mais de um arquivo casando é erro, não escolha automática —
 * publicar a versão errada do guia por ordem alfabética seria pior do que
 * falhar.
 */
const PASTA_GUIA = join(ROOT, 'assetsingestion');
const PADRAO_GUIA = /^COMECE_AQUI.*\.html$/i;

/** Nome da pasta raiz dentro do ZIP, e base do nome do próprio ZIP. */
const PASTA_RAIZ = 'TaqCiti';
const NOME_GUIA = 'COMECE_AQUI.html';

/*
 * O ZIP tem nome FIXO, sem versão — de propósito.
 *
 * `upload-to-gdrive.sh` procura por nome e sobrescreve o que achar, então um
 * nome fixo faz cada release substituir a anterior no mesmo arquivo do Drive:
 * o link compartilhado com o time nunca muda, e nunca há duas versões lado a
 * lado esperando alguém baixar a errada. A versão vive DENTRO do pacote — no
 * guia e no nome dos três instaladores.
 */
const NOME_ZIP = `${PASTA_RAIZ}.zip`;

/*
 * Cada instalador é reconhecido por DOIS critérios: o nome do arquivo e a cara
 * do conteúdo. Os padrões de nome saem direto de quem gera os arquivos:
 * `installer/windows/taqciti.iss` (OutputBaseFilename),
 * `installer/macos/build-installer.sh` e `installer/linux/build-installer.sh`.
 *
 * O nome sozinho não basta. Durante o desenvolvimento deste pacote, os testes
 * usaram arquivos substitutos — um zip qualquer renomeado para
 * "taqciti-instalador-windows-2.1.2.exe" — e eles passavam por todas as
 * conferências, porque nada olhava para dentro. Um substituto publicado no
 * Drive seria pior do que uma release falhando: o time baixaria, daria dois
 * cliques e nada aconteceria.
 *
 * `assinatura` é o que o formato de verdade tem nos primeiros bytes. Não é
 * criptografia e não prova procedência — prova que o arquivo é do formato que
 * diz ser, que é exatamente o que separa um artefato real de um substituto de
 * teste.
 */
const INSTALADORES = [
  {
    chave: 'windows',
    rotulo: 'Windows',
    padrao: /^taqciti-instalador-windows-(.+)\.exe$/i,
    origem: 'installer/windows/taqciti.iss (compilado pelo Inno Setup)',
    modo: 0o644,
    // Todo executável do Windows começa com o cabeçalho DOS "MZ".
    assinatura: { bytes: [0x4d, 0x5a], formato: 'executável do Windows (cabeçalho MZ)' },
    // Marca que o Inno grava junto do bloco de dados do setup. Ela fica bem
    // fundo no arquivo (centenas de KB) e a posição depende do tamanho do
    // payload — por isso a busca varre o arquivo inteiro, sem janela fixa.
    contem: { texto: 'Inno Setup Setup Data', onde: 'marca do compilador Inno Setup' },
  },
  {
    chave: 'macos',
    rotulo: 'macOS',
    padrao: /^taqciti-instalador-mac-(.+)\.pkg$/i,
    origem: 'installer/macos/build-installer.sh',
    modo: 0o644,
    // .pkg de instalador é um arquivo xar; "xar!" é a assinatura do formato.
    assinatura: { bytes: [0x78, 0x61, 0x72, 0x21], formato: 'pacote xar do macOS (.pkg)' },
  },
  {
    chave: 'linux',
    rotulo: 'Linux',
    padrao: /^taqciti-instalador-linux-(.+)\.run$/i,
    origem: 'installer/linux/build-installer.sh',
    // O .run é autoextraível: sem bit de execução ele não roda. Vários
    // extratores de Windows descartam essa informação assim mesmo, então o
    // guia continua ensinando o `chmod +x` — isto aqui é o caminho feliz, não
    // uma garantia.
    modo: 0o755,
    // O .run do makeself é um shell script com o payload colado no fim. A
    // segunda linha do cabeçalho é "# This script was generated using
    // Makeself <versão>".
    assinatura: { bytes: [0x23, 0x21], formato: 'script de shell (shebang "#!")' },
    contem: { texto: 'Makeself', onde: 'marca do gerador Makeself' },
  },
];

const problemas = [];

function anotar(mensagem) {
  problemas.push(mensagem);
}

function abortar(titulo = 'Pacote NÃO gerado') {
  console.error(`\n[pacote] ${titulo}. Nada foi publicado nem sobrescrito.\n`);
  for (const problema of problemas) console.error(`  ✗ ${problema}`);
  console.error('');
  process.exit(1);
}

function lerArgumentos(argv) {
  const opcoes = {
    origem: join(ROOT, 'release'),
    saida: join(ROOT, 'release', 'pacote'),
    versao: null,
    somenteGuia: false,
    conferir: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--somente-guia') {
      opcoes.somenteGuia = true;
    } else if (arg === '--conferir') {
      const valor = argv[++i];
      if (!valor) {
        console.error('[pacote] --conferir precisa do caminho de um ZIP.');
        process.exit(1);
      }
      opcoes.conferir = resolve(ROOT, valor);
    } else if (arg === '--origem' || arg === '--saida' || arg === '--versao') {
      const valor = argv[++i];
      if (!valor) {
        console.error(`[pacote] ${arg} precisa de um valor.`);
        process.exit(1);
      }
      // `resolve` e não `join`: assim um caminho relativo conta a partir da
      // raiz do repo (o que o job passa) e um caminho absoluto continua
      // valendo como absoluto (o que é prático ao testar à mão).
      if (arg === '--origem') opcoes.origem = resolve(ROOT, valor);
      else if (arg === '--saida') opcoes.saida = resolve(ROOT, valor);
      // Aceita tanto "2.1.2" quanto "v2.1.2" (o formato da tag). O `v` só cai
      // quando vem antes de um dígito — um ref chamado "v2-experimento" não é
      // uma tag de versão, e mutilar o nome dele só produziria uma comparação
      // errada mais adiante.
      else opcoes.versao = valor.replace(/^v(?=\d)/, '');
    } else {
      console.error(`[pacote] Opção desconhecida: ${arg}`);
      process.exit(1);
    }
  }

  return opcoes;
}

/**
 * Localiza os três instaladores e extrai a versão do nome de cada um.
 *
 * A versão sai dos NOMES, e não de `package.json` nem de um parâmetro: o que
 * vai ser distribuído são estes arquivos, então é o nome deles que define o
 * que o pacote é. Exigir que os três concordem é o que impede um artefato
 * velho, sobrado de uma rodada anterior, entrar caladamente no pacote junto
 * com dois novos.
 */
function acharInstaladores(origemDir) {
  if (!existsSync(origemDir)) {
    anotar(`a pasta de origem não existe: ${origemDir}`);
    return null;
  }

  const arquivos = readdirSync(origemDir).filter((nome) =>
    statSync(join(origemDir, nome)).isFile(),
  );

  const achados = [];

  for (const instalador of INSTALADORES) {
    const casaram = arquivos.filter((nome) => instalador.padrao.test(nome));

    if (casaram.length === 0) {
      anotar(
        `instalador de ${instalador.rotulo} não encontrado em ${origemDir} — ` +
          `esperado algo como "${exemploDeNome(instalador)}", gerado por ${instalador.origem}`,
      );
      continue;
    }

    if (casaram.length > 1) {
      anotar(
        `há ${casaram.length} instaladores de ${instalador.rotulo} em ${origemDir} ` +
          `(${casaram.join(', ')}) — não dá para adivinhar qual publicar; deixe só um`,
      );
      continue;
    }

    const nome = casaram[0];
    const caminho = join(origemDir, nome);
    const tamanho = statSync(caminho).size;

    if (tamanho === 0) {
      anotar(`o instalador de ${instalador.rotulo} está vazio (0 byte): ${nome}`);
      continue;
    }

    if (!pareceAutentico(instalador, caminho, nome)) continue;

    achados.push({
      ...instalador,
      nome,
      caminho,
      tamanho,
      versao: nome.match(instalador.padrao)[1],
    });
  }

  return achados.length === INSTALADORES.length ? achados : null;
}

/**
 * Confere que o arquivo é do formato que o nome promete.
 *
 * Existe para que um arquivo substituto de teste não consiga se passar por
 * instalador de produção só por ter o nome certo. Lê apenas o começo do
 * arquivo: a assinatura mora nos primeiros bytes, e as marcas do Inno e do
 * makeself vivem no cabeçalho, antes do payload.
 */
function pareceAutentico(instalador, caminho, nome) {
  // Lê o arquivo inteiro: a marca do Inno mora a centenas de KB do início, e a
  // posição depende do tamanho do payload, então não existe janela fixa que
  // sirva. O custo é irrelevante — o empacotador já lê o arquivo todo adiante
  // para colocá-lo no ZIP.
  const conteudo = readFileSync(caminho);

  const { bytes, formato } = instalador.assinatura;
  if (!bytes.every((b, i) => conteudo[i] === b)) {
    anotar(
      `"${nome}" não é um ${formato} — os primeiros bytes são ` +
        `${[...conteudo.subarray(0, bytes.length)].map((b) => '0x' + b.toString(16).padStart(2, '0')).join(' ')}. ` +
        'Isso costuma ser um arquivo de teste renomeado; o pacote só aceita o ' +
        `artefato real gerado por ${instalador.origem}`,
    );
    return false;
  }

  if (instalador.contem) {
    // latin1 para varrer bytes como caracteres sem risco de erro de
    // decodificação num arquivo binário.
    if (!conteudo.toString('latin1').includes(instalador.contem.texto)) {
      anotar(
        `"${nome}" tem a assinatura de ${formato}, mas não traz a ${instalador.contem.onde} — ` +
          `não parece o instalador gerado por ${instalador.origem}`,
      );
      return false;
    }
  }

  return true;
}

function exemploDeNome(instalador) {
  return instalador.padrao.source
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace('(.+)', '2.1.2')
    .replace(/\\\./g, '.');
}

/** Exige que os três instaladores tenham a mesma versão no nome. */
function versaoUnica(achados, versaoExigida) {
  const versoes = [...new Set(achados.map((a) => a.versao))];

  if (versoes.length > 1) {
    anotar(
      'os instaladores não são da mesma versão: ' +
        achados.map((a) => `${a.rotulo}=${a.versao}`).join(', ') +
        ' — provavelmente sobrou artefato de uma rodada anterior na pasta de origem',
    );
    return null;
  }

  const versao = versoes[0];

  if (versaoExigida && versao !== versaoExigida) {
    anotar(
      `os instaladores são da versão ${versao}, mas --versao pediu ${versaoExigida} — ` +
        'a pasta de origem tem artefatos de outra rodada',
    );
    return null;
  }

  return versao;
}

/** Escapa um valor para caber dentro de uma string JS entre aspas simples. */
function paraJs(texto) {
  return texto.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');
}

/** Localiza o guia em assetsingestion/. Zero ou mais de um é erro. */
function acharGuia() {
  if (!existsSync(PASTA_GUIA)) {
    anotar(`a pasta de origem do guia não existe: ${PASTA_GUIA}`);
    return null;
  }

  const casaram = readdirSync(PASTA_GUIA).filter((nome) => PADRAO_GUIA.test(nome));

  if (casaram.length === 0) {
    anotar(`nenhum guia encontrado em ${PASTA_GUIA} (esperado um "COMECE_AQUI*.html")`);
    return null;
  }
  if (casaram.length > 1) {
    anotar(
      `há ${casaram.length} guias em ${PASTA_GUIA} (${casaram.join(', ')}) — ` +
        'não dá para adivinhar qual publicar; deixe só um',
    );
    return null;
  }

  return join(PASTA_GUIA, casaram[0]);
}

/**
 * Prepara o guia para entrar no pacote.
 *
 * A única coisa que muda no HTML é o nome dos dois instaladores — o que é
 * seguro de fixar aqui, porque são os arquivos que estão entrando neste mesmo
 * ZIP. **Nenhum caminho da máquina de build entra**: a pasta da extensão só
 * existe depois que o instalador roda, e quem preenche aquilo é o
 * install-path.js que o instalador grava na máquina de quem instala.
 */
function gerarGuia({ versao, achados }) {
  const origem = acharGuia();
  if (!origem) return null;

  const porChave = Object.fromEntries(achados.map((a) => [a.chave, a.nome]));

  const substituicoes = {
    __ARQUIVO_WINDOWS__: porChave.windows ?? '',
    __ARQUIVO_MACOS__: porChave.macos ?? '',
    __ARQUIVO_LINUX__: porChave.linux ?? '',
  };

  let html = readFileSync(origem, 'utf8');
  for (const [marcador, valor] of Object.entries(substituicoes)) {
    html = html.split(marcador).join(paraJs(valor));
  }

  // O guia tem um mecanismo de reserva para marcador não substituído, para o
  // arquivo cru continuar abrindo durante o desenvolvimento. Num pacote de
  // verdade isso seria um defeito silencioso: a página abriria "funcionando",
  // só que sem saber o nome do instalador que ela manda abrir.
  const sobraram = html.match(/__[A-Z][A-Z0-9_]*__/g);
  if (sobraram) {
    anotar(`o guia ficou com marcador não substituído: ${[...new Set(sobraram)].join(', ')}`);
    return null;
  }

  // A versão não aparece em prosa no guia; ela chega pelo nome dos
  // instaladores que acabaram de ser injetados. Se não estiver ali, a
  // substituição não pegou.
  if (!html.includes(versao)) {
    anotar('o guia gerado não menciona a versão do pacote em nenhum nome de instalador');
    return null;
  }

  console.log(`[pacote] Guia: ${origem}`);
  return Buffer.from(html, 'utf8');
}

/** Grava a pasta do pacote em disco, para poder abrir o guia e revisar. */
function escrever(destino, conteudo) {
  mkdirSync(join(destino, '..'), { recursive: true });
  writeFileSync(destino, conteudo);
}

/**
 * Reabre o ZIP gravado e confere entrada por entrada.
 *
 * Conferir o buffer que acabou de sair de `montarZip` não provaria nada — é a
 * mesma memória que o gerou. O que vale é o caminho de volta: ler os bytes do
 * disco, percorrer o diretório central (que é o que um extrator consulta) e
 * comparar nome, tamanho e CRC com os arquivos de origem.
 */
function conferirZip(caminhoZip, esperadas) {
  const bytes = readFileSync(caminhoZip);
  let entradas;

  try {
    entradas = lerZip(bytes);
  } catch (erro) {
    anotar(`o ZIP gravado não pôde ser lido de volta: ${erro.message}`);
    return false;
  }

  let ok = true;

  if (entradas.length !== esperadas.length) {
    anotar(`o ZIP tem ${entradas.length} entrada(s); esperava ${esperadas.length}`);
    ok = false;
  }

  for (const esperada of esperadas) {
    const entrada = entradas.find((e) => e.name === esperada.name);

    if (!entrada) {
      anotar(`o ZIP não contém "${esperada.name}"`);
      ok = false;
      continue;
    }
    if (entrada.size !== esperada.data.length) {
      anotar(
        `"${esperada.name}" ficou com ${entrada.size} byte(s) no ZIP; ` +
          `a origem tem ${esperada.data.length}`,
      );
      ok = false;
    }
    if (entrada.crc !== crcDe(esperada.data)) {
      anotar(`"${esperada.name}" não bate com a origem (CRC diferente)`);
      ok = false;
    }
    if (entrada.mode !== (esperada.mode ?? 0o644)) {
      anotar(
        `"${esperada.name}" ficou com permissão ${entrada.mode.toString(8)}; ` +
          `esperava ${(esperada.mode ?? 0o644).toString(8)}`,
      );
      ok = false;
    }
  }

  return ok;
}

/**
 * Confere um ZIP já pronto: a pasta raiz, o guia e um instalador em cada uma
 * das três pastas de sistema, nenhum deles vazio, e nada de estranho a mais.
 *
 * Roda sobre o artefato que o job de publicação BAIXOU — não sobre o que o
 * job de montagem gravou. São dois jobs, dois downloads e um artefato no meio;
 * esta é a única checagem que acontece depois de tudo isso, já com o pacote na
 * mão de quem vai sobrescrever o arquivo do Drive.
 */
function conferirPacotePronto(caminhoZip) {
  if (!existsSync(caminhoZip)) {
    anotar(`o pacote não existe: ${caminhoZip}`);
    return false;
  }

  let entradas;
  try {
    entradas = lerZip(readFileSync(caminhoZip));
  } catch (erro) {
    anotar(`não consegui ler o pacote: ${erro.message}`);
    return false;
  }

  let ok = true;

  const guia = `${PASTA_RAIZ}/${NOME_GUIA}`;
  const temGuia = entradas.find((e) => e.name === guia);
  if (!temGuia) {
    anotar(`o pacote não contém "${guia}"`);
    ok = false;
  } else if (temGuia.size === 0) {
    anotar(`"${guia}" está vazio dentro do pacote`);
    ok = false;
  }

  // Os três convivem na MESMA pasta, então não dá para conferir "o que tem
  // dentro da pasta do Windows": confere-se quem casa com cada padrão de nome,
  // e depois que ninguém sobrou sem dono.
  const prefixo = `${PASTA_RAIZ}/Instaladores/`;
  const naPasta = entradas.filter((e) => e.name.startsWith(prefixo));
  const reconhecidos = new Set();

  for (const instalador of INSTALADORES) {
    const casaram = naPasta.filter((e) => instalador.padrao.test(e.name.slice(prefixo.length)));

    if (casaram.length !== 1) {
      anotar(
        `esperava exatamente 1 instalador de ${instalador.rotulo} em "${prefixo}", ` +
          `encontrei ${casaram.length}` +
          (casaram.length ? ` (${casaram.map((e) => e.name).join(', ')})` : ''),
      );
      ok = false;
      continue;
    }
    if (casaram[0].size === 0) {
      anotar(`"${casaram[0].name}" está vazio dentro do pacote`);
      ok = false;
    }
    reconhecidos.add(casaram[0].name);
  }

  // Sem subpasta por sistema, "arquivo a mais em Instaladores/" deixa de ser
  // impossível por construção e passa a precisar de checagem — inclusive
  // subpasta, que um `startsWith` sozinho deixaria passar.
  const intrusos = naPasta.filter((e) => !reconhecidos.has(e.name));
  if (intrusos.length) {
    anotar(
      `há arquivo não reconhecido em "${prefixo}": ${intrusos.map((e) => e.name).join(', ')}`,
    );
    ok = false;
  }

  const forasteiras = entradas.filter((e) => !e.name.startsWith(`${PASTA_RAIZ}/`));
  if (forasteiras.length) {
    anotar(
      `o pacote tem arquivo fora da pasta "${PASTA_RAIZ}/": ` +
        forasteiras.map((e) => e.name).join(', '),
    );
    ok = false;
  }

  if (ok) {
    console.log(`[pacote] Conferido: ${caminhoZip}`);
    for (const entrada of entradas) {
      console.log(`[pacote]   ${entrada.name}  (${formatarTamanho(entrada.size)})`);
    }
  }

  return ok;
}

function formatarTamanho(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function main() {
  const opcoes = lerArgumentos(process.argv.slice(2));

  if (opcoes.conferir) {
    if (!conferirPacotePronto(opcoes.conferir)) abortar('Pacote reprovado na conferência');
    return;
  }

  if (opcoes.somenteGuia) {
    // Modo de revisão: monta o guia com nomes de exemplo, só para abrir no
    // navegador e olhar. Não gera ZIP e não serve para publicar — quem publica
    // é o caminho completo, que exige os três instaladores de verdade.
    const versao = opcoes.versao ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    const falsos = INSTALADORES.map((i) => ({
      ...i,
      nome: exemploDeNome(i).replace('2.1.2', versao),
    }));
    const guia = gerarGuia({ versao, achados: falsos });
    if (!guia) abortar();

    const destino = join(opcoes.saida, PASTA_RAIZ, NOME_GUIA);
    escrever(destino, guia);
    console.log('[pacote] Modo revisão: só o guia, com nomes de instalador de exemplo.');
    console.log(`[pacote] Abra no navegador: ${destino}`);
    return;
  }

  console.log(`[pacote] Procurando instaladores em ${opcoes.origem}`);

  const achados = acharInstaladores(opcoes.origem);
  if (!achados) abortar();

  const versao = versaoUnica(achados, opcoes.versao);
  if (!versao) abortar();

  console.log(`[pacote] Versão do pacote: ${versao}`);
  for (const achado of achados) {
    console.log(`[pacote]   ${achado.rotulo}: ${achado.nome} (${formatarTamanho(achado.tamanho)})`);
  }

  const guia = gerarGuia({ versao, achados });
  if (!guia) abortar();

  const entradas = [
    { name: `${PASTA_RAIZ}/${NOME_GUIA}`, data: guia, mode: 0o644 },
    ...achados.map((achado) => ({
      name: `${PASTA_RAIZ}/Instaladores/${achado.nome}`,
      data: readFileSync(achado.caminho),
      mode: achado.modo,
    })),
  ];

  // A pasta montada em disco existe para revisão: dá para abrir o guia com
  // dois cliques e navegar a estrutura exatamente como quem baixar vai ver.
  for (const entrada of entradas) {
    escrever(join(opcoes.saida, ...entrada.name.split('/')), entrada.data);
  }

  const caminhoZip = join(opcoes.saida, NOME_ZIP);
  writeFileSync(caminhoZip, montarZip(entradas));

  if (!conferirZip(caminhoZip, entradas)) {
    // Não deixa para trás um ZIP que não passou na conferência: se ele ficasse
    // no disco, o passo seguinte do job poderia publicá-lo sem saber.
    rmSync(caminhoZip, { force: true });
    abortar();
  }

  const tamanhoZip = statSync(caminhoZip).size;

  console.log('');
  console.log('[pacote] Estrutura conferida no ZIP gravado:');
  for (const entrada of entradas) {
    console.log(`[pacote]   ${entrada.name}  (${formatarTamanho(entrada.data.length)})`);
  }
  console.log('');
  console.log(`[pacote] Pacote pronto (${formatarTamanho(tamanhoZip)}):`);
  console.log(caminhoZip);
}

main();
