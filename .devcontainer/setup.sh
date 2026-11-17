#!/usr/bin/env bash
# Prepara o ambiente de teste (GitHub Codespaces ou Dev Containers): dependências, base
# de dados, dados de demonstração e contas de teste. Corre uma vez, quando o ambiente é criado.
set -euo pipefail
cd "$(dirname "$0")/.."

random() { node -e "console.log(require('crypto').randomBytes($1).toString('base64url'))"; }

if [ ! -f backend/.env ]; then
  ADMIN_PASSWORD="$(random 9)"
  DEMO_PASSWORD="$(random 9)"
  cat > backend/.env <<ENV
NODE_ENV=production
PORT=${PORT:-3000}
DATABASE_URL=${DATABASE_URL:-postgres://p4s:p4s@localhost:5432/p4s_dev}
JWT_SECRET=$(random 48)
# A aplicação fica atrás do encaminhamento de portas do Codespaces.
TRUST_PROXY=1
# A API serve a interface compilada: um só endereço para testar.
STATIC_DIR=../frontend/dist
SEED_ADMIN_EMAIL=admin@p4s.test
SEED_ADMIN_PASSWORD=${ADMIN_PASSWORD}
SEED_ADMIN_NAME=Administrador P4S
SEED_DEMO=true
SEED_DEMO_PASSWORD=${DEMO_PASSWORD}
# Contacto e condições da proposta (opcional, ver backend/.env.example)
P4S_CONTACT_EMAIL=
P4S_LEGAL_IDENTITY=
P4S_PROPOSAL_TERMS=
ENV
  cat > CONTAS-DE-TESTE.txt <<ACCOUNTS
Contas deste ambiente de teste (geradas agora, só valem aqui)

  Equipa P4S (administrador)   admin@p4s.test               ${ADMIN_PASSWORD}
  Fábrica de demonstração      gestao@moldes-exemplo.test   ${DEMO_PASSWORD}

A aplicação fica na porta ${PORT:-3000}. No Codespaces: separador «Portas», abrir o endereço da porta.
Para a mostrar a outra pessoa: botão direito na porta, «Visibilidade da porta», «Público».
ACCOUNTS
fi

echo "A instalar dependências e a compilar (alguns minutos na primeira vez)…"
(cd backend && npm ci --no-audit --no-fund)
(cd frontend && npm ci --no-audit --no-fund && npm run build)
(cd backend && npm run build)

# A base de dados pode demorar uns segundos a aceitar ligações.
for attempt in $(seq 1 30); do
  if (cd backend && npm run --silent db:migrate); then break; fi
  if [ "$attempt" = 30 ]; then
    echo "A base de dados não respondeu. Corra de novo: bash .devcontainer/setup.sh" >&2
    exit 1
  fi
  sleep 2
done
(cd backend && npm run --silent db:seed)

echo
cat CONTAS-DE-TESTE.txt
