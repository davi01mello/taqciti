#!/usr/bin/env bash
#
# Recusa uma release cuja extensao apontaria para o servidor errado.
#
# O endereco do servidor e o segredo compartilhado sao fixados NO BUNDLE, na
# hora da build. Sem eles a extensao cai no padrao de desenvolvimento
# (http://localhost:3000) — e o instalador publicado so funciona para quem
# estiver rodando o servidor na propria maquina. Aconteceu na v2.0.0.
#
# Falhar aqui custa uma release; publicar errado custa a confianca de quem
# instalou e nao entende por que "nao gera nada".
#
# Ver server/docs/deploy-vercel.md.
set -euo pipefail

erros=0

exigir() {
  local nome="$1" valor="$2" onde="$3"
  if [ -z "${valor}" ]; then
    echo "FALTA  ${nome}  — configure em ${onde}"
    erros=$((erros + 1))
  else
    echo "ok     ${nome}"
  fi
}

echo "Conferindo a configuracao da build de release..."
exigir "VITE_DOCCITI_SERVER_URL" "${VITE_DOCCITI_SERVER_URL:-}" \
  "Settings -> Secrets and variables -> Actions -> Variables -> DOCCITI_SERVER_URL"
exigir "VITE_DOCCITI_SHARED_KEY" "${VITE_DOCCITI_SHARED_KEY:-}" \
  "Settings -> Secrets and variables -> Actions -> Secrets -> DOCCITI_SHARED_KEY"

url="${VITE_DOCCITI_SERVER_URL:-}"

# localhost num instalador distribuido nunca e o que se quis dizer.
case "${url}" in
  *localhost*|*127.0.0.1*)
    echo "ERRO   VITE_DOCCITI_SERVER_URL aponta para a maquina local: ${url}"
    erros=$((erros + 1))
    ;;
esac

# http:// simples nao serve: a extensao roda em pagina https (Google Meet), e o
# navegador bloqueia a requisicao como conteudo misto. O erro apareceria so no
# uso real, como "falha de rede" sem explicacao.
case "${url}" in
  ""|https://*) ;;
  *)
    echo "ERRO   VITE_DOCCITI_SERVER_URL precisa comecar com https:// — recebido: ${url}"
    erros=$((erros + 1))
    ;;
esac

# Barra no fim duplicaria em "${url}/api/generate".
case "${url}" in
  */)
    echo "ERRO   VITE_DOCCITI_SERVER_URL nao pode terminar com '/': ${url}"
    erros=$((erros + 1))
    ;;
esac

if [ "${erros}" -ne 0 ]; then
  echo
  echo "Release abortada: ${erros} problema(s) na configuracao."
  echo "Nada foi publicado. Ver server/docs/deploy-vercel.md."
  exit 1
fi

echo "Configuracao de release ok — extensao vai apontar para ${url}"
