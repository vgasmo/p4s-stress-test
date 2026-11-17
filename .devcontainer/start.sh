#!/usr/bin/env bash
# Arranca a aplicação (API e interface compilada) num só endereço. Corre a cada arranque
# do ambiente. Pode ser corrido à mão: bash .devcontainer/start.sh
# Depois de atualizar o código: bash .devcontainer/setup.sh && bash .devcontainer/start.sh --reiniciar
set -euo pipefail
cd "$(dirname "$0")/../backend"

if [ ! -f .env ]; then
  echo "Ambiente por preparar. Corra primeiro: bash .devcontainer/setup.sh" >&2
  exit 1
fi
PORT="$(grep -E '^PORT=' .env | cut -d= -f2)"
PORT="${PORT:-3000}"
running() { curl -fsS "http://localhost:${PORT}/health" >/dev/null 2>&1; }

if [ "${1:-}" = "--reiniciar" ]; then
  pkill -f "node dist/src/server.js" 2>/dev/null || true
  sleep 1
fi

if running; then
  echo "A aplicação já está a correr na porta ${PORT}."
  exit 0
fi

[ -f dist/src/server.js ] || npm run build
# A API não arranca com migrações por aplicar: aplica as que faltarem (não faz nada se não houver).
npm run --silent db:migrate
nohup npm start > /tmp/p4s-stress-test.log 2>&1 &
disown

for attempt in $(seq 1 30); do
  if running; then
    echo "P4S Stress Test a correr na porta ${PORT}. Contas de teste em CONTAS-DE-TESTE.txt."
    exit 0
  fi
  sleep 1
done
echo "A aplicação não arrancou. Ver /tmp/p4s-stress-test.log" >&2
exit 1
