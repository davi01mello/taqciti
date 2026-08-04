#!/usr/bin/env bash
#
# Builda o projeto e empacota dist/ + o guia visual + postinstall num
# instalador .pkg (via pkgbuild) para macOS. Rode com
# `bash installer/macos/build-installer.sh` a partir de qualquer diretório.
#
# macos-latest do GitHub Actions já vem com pkgbuild/productbuild
# instalados (fazem parte das Command Line Tools) — ao contrário do
# Windows (Chocolatey) e Linux (apt), não precisa instalar nada extra.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release"
STAGING_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

if ! command -v pkgbuild >/dev/null 2>&1; then
  echo "[build-installer] Erro: pkgbuild não encontrado." >&2
  echo "Instale as Command Line Tools com 'xcode-select --install'." >&2
  exit 1
fi

echo "[build-installer] Rodando build de produção (npm run build)..."
( cd "$ROOT_DIR" && npm run build )

if [ ! -d "$ROOT_DIR/dist" ]; then
  echo "[build-installer] Erro: pasta dist/ não foi encontrada após o build." >&2
  exit 1
fi

VERSION="${APP_VERSION:-$(node -p "require('$ROOT_DIR/package.json').version")}"

echo "[build-installer] Preparando payload..."
PAYLOAD_DIR="$STAGING_DIR/payload"
SCRIPTS_DIR="$STAGING_DIR/scripts"
mkdir -p "$PAYLOAD_DIR/dist" "$PAYLOAD_DIR/guide" "$SCRIPTS_DIR"
cp -R "$ROOT_DIR/dist"/. "$PAYLOAD_DIR/dist"/
cp "$ROOT_DIR/installer/guide/index.html" "$PAYLOAD_DIR/guide/index.html"
cp "$SCRIPT_DIR/postinstall" "$SCRIPTS_DIR/postinstall"
chmod +x "$SCRIPTS_DIR/postinstall"

mkdir -p "$RELEASE_DIR"
OUTPUT_FILE="$RELEASE_DIR/taqciti-instalador-mac-${VERSION}.pkg"
rm -f "$OUTPUT_FILE"

# --install-location é só um ponto de staging temporário (/private/tmp),
# NÃO o destino final visto pelo usuário: o postinstall (que roda como
# root — ver comentário no topo de installer/macos/postinstall) lê os
# arquivos daqui, copia de verdade para a Área de Trabalho do usuário
# logado, ajusta o dono, e depois apaga esta pasta de staging. O pkgbuild
# sozinho não tem como saber qual é o "usuário de verdade" por trás da
# instalação — só o postinstall, rodando em runtime, consegue perguntar
# isso ao sistema.
pkgbuild \
  --root "$PAYLOAD_DIR" \
  --scripts "$SCRIPTS_DIR" \
  --identifier com.taqciti.desktopinstaller \
  --version "$VERSION" \
  --install-location /private/tmp/taqciti-installer-payload \
  "$OUTPUT_FILE"

echo "[build-installer] Instalador gerado em:"
echo "  $OUTPUT_FILE"
