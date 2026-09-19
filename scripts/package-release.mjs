/**
 * Builda o projeto e empacota o conteúdo de dist/ em release/taqciti-v<versão>.zip,
 * pronto para alguém sem contexto técnico instalar via "Carregar sem compactação".
 * Sem dependências externas: zip montado à mão (deflate via zlib + estrutura ZIP).
 *
 * Este é o zip da EXTENSÃO crua — não confundir com o pacote de distribuição
 * (`scripts/package-distribution.mjs`), que junta guia + os três instaladores
 * nativos. Os dois compartilham o motor de ZIP em `scripts/lib/zip.mjs`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { montarZip } from './lib/zip.mjs';

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

  const zipBuffer = montarZip(files);

  mkdirSync(RELEASE_DIR, { recursive: true });
  const zipPath = join(RELEASE_DIR, `taqciti-v${version}.zip`);
  writeFileSync(zipPath, zipBuffer);

  console.log(`[package] Zip gerado com ${files.length} arquivo(s).`);
  console.log(zipPath);
}

main();
