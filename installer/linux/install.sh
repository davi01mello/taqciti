#!/usr/bin/env bash
#
# Instala a extensão TaqCITi. Roda dentro do .run autoextraível gerado por
# build-installer.sh (via makeself) — não é pensado para ser executado
# solto fora desse contexto, já que espera dist/ e guide/ como pastas
# irmãs deste arquivo.
#
# Filosofia: nenhuma etapa "de conveniência" (clipboard, abrir navegador)
# pode derrubar a instalação. Só a cópia dos arquivos é obrigatória.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"
GUIDE_TEMPLATE="$SCRIPT_DIR/guide/index.html"
FOLDER_NAME="TaqCITi (não apagar)"

if [ ! -d "$DIST_DIR" ]; then
  echo "Erro: pasta dist/ não encontrada dentro do instalador. Pacote corrompido?" >&2
  exit 1
fi

if [ -d "$HOME/Desktop" ]; then
  INSTALL_DIR="$HOME/Desktop/$FOLDER_NAME"
else
  echo "Aviso: a pasta ~/Desktop não existe neste sistema (comum em algumas" >&2
  echo "instalações do Ubuntu sem Área de Trabalho configurada)." >&2
  echo "Instalando em ~/$FOLDER_NAME em vez disso." >&2
  INSTALL_DIR="$HOME/$FOLDER_NAME"
fi

if ! mkdir -p "$INSTALL_DIR"; then
  echo "Erro: não foi possível criar a pasta de instalação em $INSTALL_DIR" >&2
  exit 1
fi

if ! cp -R "$DIST_DIR"/. "$INSTALL_DIR"/; then
  echo "Erro: falha ao copiar os arquivos para $INSTALL_DIR" >&2
  exit 1
fi

echo ""
echo "TaqCITi instalado em:"
echo "  $INSTALL_DIR"
echo ""

# --- Área de transferência (melhor esforço; nunca falha a instalação) ---
COPIED=0
if command -v xclip >/dev/null 2>&1; then
  printf '%s' "$INSTALL_DIR" | xclip -selection clipboard >/dev/null 2>&1 && COPIED=1
elif command -v xsel >/dev/null 2>&1; then
  printf '%s' "$INSTALL_DIR" | xsel --clipboard --input >/dev/null 2>&1 && COPIED=1
fi

if [ "$COPIED" = "1" ]; then
  echo "(caminho copiado para a área de transferência)"
else
  echo "Não encontramos 'xclip' nem 'xsel' para copiar o caminho automaticamente."
  echo "Sem problema — copie o caminho acima manualmente no próximo passo."
fi
echo ""

# --- Gera a cópia do guia com o caminho já preenchido ---
GUIDE_DIR="$HOME/.local/share/taqciti/guide"
GUIDE_DEST="$GUIDE_DIR/index.html"

if [ -f "$GUIDE_TEMPLATE" ]; then
  mkdir -p "$GUIDE_DIR" 2>/dev/null

  # Escapa para caber numa string JS (aspas/barras invertidas), depois
  # escapa de novo para servir de texto de substituição do sed (& e \).
  JS_ESCAPED=$(printf '%s' "$INSTALL_DIR" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
  SED_SAFE=$(printf '%s' "$JS_ESCAPED" | sed -e 's/[\&|]/\\&/g')

  if sed "s|__INSTALL_PATH__|$SED_SAFE|g" "$GUIDE_TEMPLATE" > "$GUIDE_DEST" 2>/dev/null; then
    :
  else
    echo "Aviso: não consegui gerar o guia em $GUIDE_DEST." >&2
    GUIDE_DEST=""
  fi
else
  echo "Aviso: guia visual não encontrado no pacote; pulando essa etapa." >&2
  GUIDE_DEST=""
fi

# --- Abre o guia visual (melhor esforço) ---
#
# NÃO tentamos mais abrir chrome://extensions automaticamente. Em testes
# manuais reais (feitos no instalador Windows, mas o comportamento é do
# Chrome, não do SO), passar essa URL como argumento de linha de comando
# pro Chrome nunca funcionou — o navegador parece filtrar/ignorar URLs do
# esquema chrome:// recebidas de um processo externo, por segurança. Não
# é bug do xdg-open nem do Chrome-binário-direto que existia aqui antes;
# é o próprio Chrome recusando esse esquema por essa via, então não tem
# workaround confiável. O guia (aberto abaixo) orienta a pessoa a abrir
# uma aba nova e colar o endereço manualmente — já copiado automaticamente
# por um botão dedicado nele.
open_target() {
  local target="$1"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$target" >/dev/null 2>&1 &
    disown >/dev/null 2>&1 || true
  fi
}

if [ -n "$GUIDE_DEST" ] && [ -f "$GUIDE_DEST" ]; then
  open_target "$GUIDE_DEST"
fi

echo "Pronto. Siga as instruções na aba do guia que acabou de abrir."
exit 0
