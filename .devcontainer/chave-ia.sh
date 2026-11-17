#!/usr/bin/env bash
# Liga a análise de documentos com IA neste ambiente de teste. Pede a chave da API da Anthropic
# sem a mostrar no ecrã, guarda-a em backend/.env (que não vai para o repositório) e reinicia
# a aplicação. Uso: bash .devcontainer/chave-ia.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f backend/.env ]; then
  echo "Ambiente por preparar. Corra primeiro: bash .devcontainer/setup.sh" >&2
  exit 1
fi

read -r -s -p "Chave da API da Anthropic (cole e carregue em Enter; não aparece no ecrã): " KEY
echo
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
if [ -z "$KEY" ]; then
  echo "Sem chave: nada foi alterado." >&2
  exit 1
fi

# Substitui a chave anterior, se existir. O ficheiro só é lido por este utilizador.
{ grep -v '^ANTHROPIC_API_KEY=' backend/.env || true; printf 'ANTHROPIC_API_KEY=%s\n' "$KEY"; } > backend/.env.tmp
mv backend/.env.tmp backend/.env
chmod 600 backend/.env
unset KEY

bash .devcontainer/start.sh --reiniciar
echo "Análise com IA ligada. No ecrã «Documentos» pode carregar exemplos/questionario-fornecedor-exemplo.pdf."
