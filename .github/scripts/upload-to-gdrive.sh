#!/usr/bin/env bash
#
# Publica os instaladores gerados pelo CI numa pasta do Google Drive, como
# canal de distribuição adicional pro time (quem não tem acesso ao GitHub
# ainda consegue baixar por ali). A GitHub Release continua sendo o canal
# técnico/de auditoria — este script nunca mexe nela, só soma um destino.
#
# Espera as variáveis de ambiente:
#   GDRIVE_ACCESS_TOKEN — token OAuth2 de acesso de curta duração, já
#     resolvido pela Service Account via `google-github-actions/auth` no
#     workflow. Esse token nunca é impresso por este script (nem em erro):
#     só é usado dentro do header "Authorization: Bearer ...", que o curl
#     não ecoa. Também nunca ligamos `set -x` aqui, porque isso exibiria a
#     linha de comando completa (headers inclusos) no log do job.
#   GDRIVE_FOLDER_ID — ID da pasta de destino no Drive.
#
# Uso: upload-to-gdrive.sh <diretório com os arquivos a publicar>
set -euo pipefail

ASSETS_DIR="${1:?uso: upload-to-gdrive.sh <diretório>}"

: "${GDRIVE_ACCESS_TOKEN:?GDRIVE_ACCESS_TOKEN não definido — a etapa de autenticação falhou ou não rodou antes desta.}"
: "${GDRIVE_FOLDER_ID:?GDRIVE_FOLDER_ID não definido (secret GDRIVE_TAQCITI_FOLDER_ID ausente?).}"

DRIVE_API="https://www.googleapis.com/drive/v3"
DRIVE_UPLOAD_API="https://www.googleapis.com/upload/drive/v3"

fail() {
  echo "[gdrive] Erro: $1" >&2
  exit 1
}

auth_header=(-H "Authorization: Bearer ${GDRIVE_ACCESS_TOKEN}")

shopt -s nullglob
FILES=("$ASSETS_DIR"/*)
shopt -u nullglob

if [ ${#FILES[@]} -eq 0 ]; then
  fail "nenhum arquivo encontrado em '$ASSETS_DIR' — os artefatos foram baixados antes de rodar este script?"
fi

echo "[gdrive] ${#FILES[@]} arquivo(s) para publicar na pasta $GDRIVE_FOLDER_ID."

for filepath in "${FILES[@]}"; do
  [ -f "$filepath" ] || continue
  filename="$(basename "$filepath")"
  echo "[gdrive] Publicando $filename..."

  # --- 1. Procura um arquivo com esse nome já existente na pasta ---
  # curl -G --data-urlencode monta a query string com o encoding certo
  # sozinho — evita ter que escapar aspas/espaços/acentos na mão.
  search_response="$(curl -sS -f "${auth_header[@]}" -G \
    --data-urlencode "q=name='${filename}' and '${GDRIVE_FOLDER_ID}' in parents and trashed=false" \
    --data-urlencode "fields=files(id,name)" \
    "${DRIVE_API}/files")" \
    || fail "falha ao consultar o Drive por '$filename' (autenticação inválida ou pasta inacessível)."

  match_count="$(printf '%s' "$search_response" | jq '.files | length')"
  file_id="$(printf '%s' "$search_response" | jq -r '.files[0].id // empty')"

  if [ "$match_count" -gt 1 ]; then
    echo "[gdrive] Aviso: existem $match_count arquivos chamados '$filename' na pasta — sobrescrevendo só o primeiro encontrado (id=$file_id)."
  fi

  if [ -z "$file_id" ]; then
    # --- 2a. Não existe: cria o registro do arquivo (sem conteúdo ainda) ---
    echo "[gdrive] Ainda não existe — criando."
    create_response="$(curl -sS -f "${auth_header[@]}" \
      -X POST \
      -H "Content-Type: application/json; charset=UTF-8" \
      --data "$(jq -n --arg name "$filename" --arg parent "$GDRIVE_FOLDER_ID" \
        '{name: $name, parents: [$parent]}')" \
      "${DRIVE_API}/files?fields=id")" \
      || fail "falha ao criar o registro de '$filename' no Drive."

    file_id="$(printf '%s' "$create_response" | jq -r '.id // empty')"
    if [ -z "$file_id" ]; then
      fail "o Drive não retornou um id ao criar '$filename' — resposta: $create_response"
    fi
  else
    echo "[gdrive] Já existe (id=$file_id) — vai sobrescrever o conteúdo em vez de duplicar."
  fi

  # --- 2b. Sobe/atualiza o conteúdo binário — mesmo passo pros dois casos ---
  if ! curl -sS -f "${auth_header[@]}" \
    -X PATCH \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@${filepath}" \
    "${DRIVE_UPLOAD_API}/files/${file_id}?uploadType=media" >/dev/null; then
    fail "falha ao enviar o conteúdo de '$filename' (id=$file_id) para o Drive."
  fi

  echo "[gdrive] OK: $filename (id=$file_id)."
done

echo "[gdrive] Todos os arquivos foram publicados com sucesso."
