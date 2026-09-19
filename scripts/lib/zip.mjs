/**
 * Montagem e leitura de arquivos ZIP, sem dependência externa.
 *
 * Nasceu dentro de `scripts/package-release.mjs` (o zip da extensão, para
 * "Carregar sem compactação") e foi extraído para cá quando
 * `scripts/package-distribution.mjs` passou a precisar do mesmo motor para
 * montar o pacote de distribuição — e, além de montar, para **reabrir e
 * conferir** o que acabou de gravar antes de qualquer publicação.
 *
 * Duas coisas que a versão original não fazia e que o pacote de distribuição
 * exige:
 *
 *   1. **Permissão de execução por arquivo.** O instalador Linux é um `.run`
 *      autoextraível: sem o bit de execução ele não roda. Um ZIP só carrega
 *      permissão Unix quando o campo "version made by" declara host Unix (3) e
 *      os atributos externos trazem o `st_mode` — era exatamente isso que
 *      faltava, então todo arquivo saía sem permissão nenhuma e o `.run`
 *      dependia 100% de um `chmod +x` manual. (O guia continua ensinando o
 *      `chmod` de qualquer forma: vários extratores de Windows descartam essa
 *      informação, e não dá para contar com ela.)
 *   2. **Releitura do diretório central.** Gravar o zip e confiar no buffer que
 *      acabou de sair da própria função não prova nada. `lerZip` faz o caminho
 *      de volta — a partir dos bytes no disco — para o empacotador conferir
 *      nomes, tamanhos e CRC do que realmente ficou gravado.
 */
import { deflateRawSync } from 'node:zlib';

/** `st_mode` de arquivo comum (S_IFREG) — o alto do campo de modo Unix. */
const S_IFREG = 0o100000;

/**
 * "version made by": host Unix (3) na parte alta, versão 2.0 do spec na baixa.
 * O host é o que faz um extrator olhar os atributos externos como `st_mode` em
 * vez de como atributos do DOS.
 */
const VERSION_MADE_BY_UNIX = (3 << 8) | 20;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosDateTime(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, dosDate };
}

/**
 * Monta um arquivo ZIP (store ou deflate) a partir de uma lista de
 * `{ name, data, mode? }`. `mode` são os bits de permissão Unix (ex.: 0o755);
 * o padrão é 0o644.
 */
export function montarZip(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  const now = dosDateTime(new Date());

  for (const { name, data, mode } of files) {
    const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(data);
    const compressed = deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(SIG_LOCAL, 0);
    localHeader.writeUInt16LE(20, 4);
    // Bit 11 (EFS): declara que o nome do arquivo está em UTF-8. Sem ele, um
    // extrator antigo é livre para ler "Instaladores/macOS" na code page local
    // e estropiar o acento — e o nome do guia ("COMECE AQUI.html") e a pasta
    // raiz dependem de sair intactos.
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(now.time, 10);
    localHeader.writeUInt16LE(now.dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, payload);

    const externalAttributes = ((S_IFREG | (mode ?? 0o644)) << 16) >>> 0;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(SIG_CENTRAL, 0);
    centralHeader.writeUInt16LE(VERSION_MADE_BY_UNIX, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(now.time, 12);
    centralHeader.writeUInt16LE(now.dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(externalAttributes, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirStart = offset;
  const centralDir = Buffer.concat(centralChunks);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDir, eocd]);
}

/**
 * Lê o diretório central de um ZIP e devolve a lista de entradas — o caminho de
 * volta de `montarZip`, usado para conferir o pacote depois de gravado.
 *
 * Lê o diretório central (e não os cabeçalhos locais) de propósito: é ele que
 * um extrator consulta para saber o que existe no arquivo, então é ele que
 * precisa estar certo. Devolve também o CRC e o modo, para a conferência poder
 * comparar com os bytes de origem e com a permissão esperada.
 */
export function lerZip(buffer) {
  const eocdOffset = acharEocd(buffer);
  if (eocdOffset < 0) {
    throw new Error('não parece um ZIP: assinatura de fim de diretório (EOCD) não encontrada');
  }

  const total = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];

  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(cursor) !== SIG_CENTRAL) {
      throw new Error(`diretório central corrompido na entrada ${i + 1} de ${total}`);
    }
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);

    entries.push({
      name: buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength),
      crc: buffer.readUInt32LE(cursor + 16),
      compressedSize: buffer.readUInt32LE(cursor + 20),
      size: buffer.readUInt32LE(cursor + 24),
      mode: (buffer.readUInt32LE(cursor + 38) >>> 16) & 0o7777,
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** CRC-32 dos bytes — exposto para a conferência comparar origem e pacote. */
export function crcDe(buffer) {
  return crc32(buffer);
}

/**
 * Procura o EOCD do fim para o começo. O registro tem tamanho variável (o
 * comentário do arquivo vem depois dele), então não dá para ler de um offset
 * fixo — varre os últimos 64 KiB, que é o máximo que esse comentário pode ter.
 */
function acharEocd(buffer) {
  const limite = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= limite; i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}
