#!/usr/bin/env bash
#
# Builda o projeto e empacota dist/ + install.sh + o guia visual num único
# instalador autoextraível (taqciti-instalador-linux-<versão>.run) via
# makeself. Rode com `bash installer/linux/build-installer.sh` a partir de
# qualquer diretório.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release"
STAGING_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

MAKESELF_BIN=""
for candidate in makeself makeself.sh; do
  if command -v "$candidate" >/dev/null 2>&1; then
    MAKESELF_BIN="$candidate"
    break
  fi
done
if [ -z "$MAKESELF_BIN" ]; then
  echo "[build-installer] Erro: makeself não encontrado (procurei 'makeself' e 'makeself.sh')." >&2
  echo "Instale com 'sudo apt-get install -y makeself' ou veja https://github.com/megastep/makeself" >&2
  exit 1
fi

echo "[build-installer] Rodando build de produção (npm run build)..."
( cd "$ROOT_DIR" && npm run build )

if [ ! -d "$ROOT_DIR/dist" ]; then
  echo "[build-installer] Erro: pasta dist/ não foi encontrada após o build." >&2
  exit 1
fi

VERSION="${APP_VERSION:-$(node -p "require('$ROOT_DIR/package.json').version")}"

echo "[build-installer] Preparando pacote..."
mkdir -p "$STAGING_DIR/dist" "$STAGING_DIR/guide"
cp -R "$ROOT_DIR/dist"/. "$STAGING_DIR/dist"/
cp "$ROOT_DIR/installer/guide/index.html" "$STAGING_DIR/guide/index.html"
cp "$SCRIPT_DIR/install.sh" "$STAGING_DIR/install.sh"
chmod +x "$STAGING_DIR/install.sh"

mkdir -p "$RELEASE_DIR"
OUTPUT_FILE="$RELEASE_DIR/taqciti-instalador-linux-${VERSION}.run"
rm -f "$OUTPUT_FILE"

"$MAKESELF_BIN" --gzip "$STAGING_DIR" "$OUTPUT_FILE" "Instalador TaqCITi" ./install.sh

chmod +x "$OUTPUT_FILE"

echo "[build-installer] Instalador gerado em:"
echo "  $OUTPUT_FILE"
