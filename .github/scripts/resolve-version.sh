#!/usr/bin/env bash
#
# Decide a versão que vai no NOME dos três instaladores, e imprime no formato
# que o GitHub Actions lê como saída de step.
#
# Existe porque o jeito anterior (`${GITHUB_REF_NAME#v}` inline, repetido em
# cada job) só funciona quando a run vem de uma tag. Numa run disparada à mão
# a partir de um branch, `GITHUB_REF_NAME` é o nome do branch — e os artefatos
# saíam como "taqciti-instalador-mac-TaqCiti-Remake.pkg". Isso nunca deu erro
# visível, mas agora dá: o empacotador exige que os três instaladores tenham a
# MESMA versão no nome, e os nomes são a única fonte dessa informação.
#
# Ordem de decisão, do mais explícito para o mais implícito:
#   1. o que a pessoa digitou no campo "versao" ao disparar a run;
#   2. a tag, quando a run veio de uma (`vX.Y.Z` -> `X.Y.Z`);
#   3. a versão do package.json.
#
# Uso: resolve-version.sh "<versao informada ou vazio>" >> "$GITHUB_OUTPUT"
set -euo pipefail

informada="${1:-}"

if [ -n "$informada" ]; then
  versao="${informada#v}"
  origem="campo da run"
elif [ "${GITHUB_REF_TYPE:-}" = "tag" ]; then
  versao="${GITHUB_REF_NAME#v}"
  origem="tag ${GITHUB_REF_NAME}"
else
  versao="$(node -p "require('./package.json').version")"
  origem="package.json"
fi

if [ -z "$versao" ]; then
  echo "Não consegui resolver a versão da release." >&2
  exit 1
fi

# stderr para aparecer no log sem sujar a saída do step.
echo "Versão dos instaladores: ${versao} (origem: ${origem})" >&2
echo "version=${versao}"
