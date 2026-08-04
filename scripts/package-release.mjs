/**
 * Builda o projeto e empacota o conteúdo de dist/ em release/taqciti-v<versão>.zip,
 * pronto para alguém sem contexto técnico instalar via "Carregar sem compactação".
 * Sem dependências externas: zip montado à mão (deflate via zlib + estrutura ZIP).
 */
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST_DIR = join(ROOT, 'dist');
const RELEASE_DIR = join(ROOT, 'release');

function fail(message) {
  console.error(`\n[package] ${message}`);
  process.exit(1);
}

function runBuild() {
  console.log('[package] Rodando build de produção (npm run build)...');
  // shell: true é necessário no Windows para resolver npm.cmd; comando é fixo
  // (sem input externo), então passar como string única evita o DEP0190.
  const result = spawnSync('npm run build', {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    fail('Build falhou. Corrija os erros acima antes de empacotar — nenhum zip foi gerado.');
  }
}

function readPackageVersion() {
  const pkgPath = join(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (!pkg.version) fail('package.json não tem campo "version".');
  return pkg.version;
}

function listFilesRecursive(rootDir) {
  const entries = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        entries.push(full);
      }
    }
  }
  walk(rootDir);
  return entries;
}

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

/** Monta um arquivo ZIP (store ou deflate) a partir de uma lista de {name, data}. */
function buildZip(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  const now = dosDateTime(new Date());

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(data);
    const compressed = deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(now.time, 10);
    localHeader.writeUInt16LE(now.dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
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
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirStart = offset;
  const centralDir = Buffer.concat(centralChunks);
  const centralDirSize = centralDir.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDir, eocd]);
}

function main() {
  runBuild();

  if (!existsSync(DIST_DIR)) {
    fail('Pasta dist/ não foi encontrada após o build.');
  }

  const version = readPackageVersion();

  const distFiles = listFilesRecursive(DIST_DIR);
  if (distFiles.length === 0) {
    fail('dist/ está vazia — nada para empacotar.');
  }

  const files = distFiles.map((absPath) => ({
    name: relative(DIST_DIR, absPath).split(sep).join('/'),
    data: readFileSync(absPath),
  }));

  const zipBuffer = buildZip(files);

  mkdirSync(RELEASE_DIR, { recursive: true });
  const zipPath = join(RELEASE_DIR, `taqciti-v${version}.zip`);
  writeFileSync(zipPath, zipBuffer);

  console.log(`[package] Zip gerado com ${files.length} arquivo(s).`);
  console.log(zipPath);
}

main();
