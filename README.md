# P4S · Stress Test de Qualificação de Fornecedores

Diagnóstico de 5 minutos e configurador de proposta para PME industriais (moldes, plásticos, automóvel, metalomecânica, agroalimentar). Calcula a faturação comercial em risco e o sobrecusto bancário anual por falta de EcoVadis, pegada de carbono, rácios ESG para a banca e segurança da informação, e gera um plano de ação faseado com preço e prazo fechados.

## Estrutura

```text
p4s-stress-test/
├── backend/                 API Express + TypeScript + PostgreSQL (MVC + serviços)
│   ├── src/config           env (validado com zod), base de dados, JWT
│   ├── src/controllers      auth, assessment, task, company
│   ├── src/models           acesso a dados, tipos de domínio, contratos de entrada e saída
│   ├── src/services         motor de cálculo, gerador de tarefas, regras de negócio
│   ├── src/middlewares      JWT, papéis, validação, erros, limites de pedidos
│   ├── src/routes           /api/v1
│   ├── src/utils            moeda, datas, NIF e CAE
│   ├── db/migrations        001 a 003 (.sql)
│   ├── db/seeds             administrador e fábrica de moldes de demonstração
│   └── tests                unitários e de integração (PostgreSQL real)
├── frontend/                React + Vite + Tailwind + primitivas shadcn/Radix
│   └── src/{components,hooks,lib,pages}
└── e2e/                     percurso completo no browser (Playwright)
```

O motor de cálculo existe uma só vez, em `backend/src/services`. O frontend importa-o diretamente (alias `@engine`), por isso o número que aparece no preview é o mesmo que a API grava.

## Arranque

Requisitos: Node 20 ou superior e PostgreSQL 13 ou superior.

```bash
createdb p4s_dev
```

API:

```bash
cd backend
cp .env.example .env     # definir JWT_SECRET e SEED_ADMIN_PASSWORD
npm install
npm run db:migrate
npm run db:seed          # com SEED_DEMO=true cria também a fábrica de demonstração
npm run dev              # http://localhost:3000
```

Interface:

```bash
cd frontend
npm install
npm run dev              # http://localhost:5173, com proxy de /api para a porta 3000
```

Num só processo e num só porto (útil em reunião ou para publicar):

```bash
cd frontend && npm run build
cd ../backend && npm run build
STATIC_DIR=../frontend/dist npm start
```

### Variáveis de ambiente (backend)

| Variável | Para quê |
| --- | --- |
| `DATABASE_URL` | Ligação ao PostgreSQL |
| `JWT_SECRET` | Segredo HS256, mínimo 32 caracteres (`openssl rand -base64 48`) |
| `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS` | Validade dos tokens (15 minutos e 7 dias por omissão) |
| `TRUST_PROXY` | Número de proxies à frente da API. Sem isto atrás de um proxy, o limite de tentativas de login trata todos os clientes como um só |
| `STATIC_DIR` | Pasta do frontend compilado, para a API o servir |
| `SEED_*` | Administrador inicial e dados de demonstração |

## Testes

```bash
cd backend
npm run test:unit        # motor e utilitários, sem base de dados
npm test                 # tudo, incluindo integração
```

Os testes de integração recriam o schema do zero. Só correm numa base de dados cujo nome termine em `_test` (por omissão `postgres://p4s:p4s@localhost:5432/p4s_test`, ou `TEST_DATABASE_URL`) e recusam qualquer outra.

Percurso no browser, com a app a correr e o seed de demonstração aplicado:

```bash
cd e2e
npm install
npx playwright install chromium
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... E2E_COMPANY_PASSWORD=... npm test
```

As palavras-passe são as usadas no seed (`SEED_ADMIN_PASSWORD` e `SEED_DEMO_PASSWORD`). O percurso altera e repõe o plano da empresa de demonstração e cria uma empresa de teste, por isso não deve correr contra dados reais.

## Motor de cálculo

Três métricas independentes, que nunca se somam.

**1. Faturação comercial em risco (€)**

`F_top = faturação anual × concentração nos 3 maiores clientes`
`faturação em risco = round(F_top × min(1, W_comm))`, com `score = min(100, W_comm × 100)`

| Lacuna | Peso | Tarefa gerada | Fase | Prazo | Honorários | Executor |
| --- | --- | --- | --- | --- | --- | --- |
| Sem EcoVadis | +0,35 (+0,45 em moldes automóvel e embalagem agroalimentar) | Preparação e Submissão do Dossier EcoVadis | 1 | 60 dias | 3.500 € | P4S |
| Sem pegada, âmbitos 1 e 2 | +0,30 | Inventário de Emissões GEE (Âmbitos 1 e 2) | 1 | 45 dias | 2.400 € | P4S |
| Sem pegada, âmbito 3 | +0,20 (+0,30 em moldes automóvel) | Auditoria de Emissões da Cadeia de Fornecimento (Âmbito 3) | 2 | 90 dias | 3.800 € | P4S |
| Sem TISAX / NIS2 | +0,15 (+0,35 e prioridade crítica em moldes automóvel) | Auditoria de Segurança da Informação e Conformidade NIS2/TISAX | 2 (1 em moldes automóvel) | 75 dias | 4.500 € | Parceiro |

Pisos de bloqueio setorial: em moldes automóvel, sem TISAX/NIS2 ou sem âmbitos 1 e 2, `W_comm` nunca fica abaixo de 0,75. Em embalagem agroalimentar, sem EcoVadis ou sem âmbitos 1 e 2, nunca fica abaixo de 0,65.

**2. Sobrecusto bancário anual (€/ano)**

Sem rácios ESG e com crédito a renovar nos próximos 18 meses, aplica-se um agravamento de 40 bps: `round(crédito a refinanciar × 0,0040)`. Gera a tarefa «Dossier de Sustentabilidade para Indexação de Spread Bancário» (Fase 1, 30 dias, 1.800 €, P4S).

**3. Orçamento e rácio de proteção**

`phase1Cost` e `phase2Cost` somam os honorários das tarefas incluídas na proposta e executadas pela P4S ou pelo parceiro (tarefas internas ou desligadas não contam). `protectionRatio = (faturação em risco + sobrecusto bancário) / max(1, investimento total)`.

Pesos, preços e prazos estão em `backend/src/services/requirements.catalog.ts`. Os pesos são inteiros e o dinheiro é calculado em cêntimos, para o mesmo input dar sempre o mesmo número.

## API

Base: `/api/v1`. Erros em `{ "error": { "code", "message", "details?" } }`.

| Rota | Acesso | Notas |
| --- | --- | --- |
| `POST /auth/login` | público | Devolve `accessToken` e `refreshToken` |
| `POST /auth/refresh` | público | Renova a sessão. A equipa P4S passa `companyId` para escolher a empresa |
| `GET /auth/me` | sessão | |
| `POST /assessments/simulate` | público | Cálculo em memória, nada é gravado |
| `POST /assessments` | sessão | Calcula, grava a avaliação e insere as tarefas numa transação. A equipa P4S pode enviar `company: { name, nif }` para criar a empresa na hora |
| `GET /assessments`, `GET /assessments/:id` | sessão com empresa | |
| `GET /tasks` | sessão com empresa | Filtros `status`, `domain`, `priority`, `executor_type`, `phase`, `assessment_id` |
| `POST /tasks`, `GET /tasks/:id`, `PUT /tasks/:id` | sessão com empresa | |
| `DELETE /tasks/:id` | equipa P4S | |
| `GET /companies`, `POST /companies` | equipa P4S | |
| `GET /companies/:id`, `GET /companies/current/users` | sessão | |

## Regras de acesso

- **Isolamento por empresa.** Todas as queries a `assessments` e `tasks` filtram por `company_id = $1`, e esse valor vem só do JWT. Há um teste que lê o SQL dos models e falha se aparecer uma query sem o filtro.
- **Papéis.** `admin` e `consultant` são a equipa P4S e escolhem a empresa em que estão a trabalhar. `company_user` fica sempre na sua empresa.
- **Utilizador da empresa.** Consulta o plano, atualiza estado, prazo e responsável, e cria tarefas internas. Não elimina tarefas e, em tarefas da P4S ou do parceiro, não altera honorários, executor, fase nem inclusão na proposta.

## Decisões e limites conhecidos

- A gravação de diagnósticos exige sessão. A simulação é pública, mas criar empresas e avaliações sem autenticação abria a porta a lixo e a dados sem dono.
- A regra pedida para o utilizador da empresa era só sobre `estimated_cost`. Ficou alargada a executor, fase e inclusão na proposta, porque bastava mudar o executor para «Interno» para contornar o bloqueio do custo.
- Não há gestão de utilizadores nem recuperação de palavra-passe. Os utilizadores criam-se pelo seed ou em SQL.
- Os refresh tokens não têm lista de revogação. Desativar um utilizador tem efeito na renovação seguinte, no máximo 15 minutos depois.
- A sessão fica no `localStorage` do browser, para sobreviver a uma recarga durante a reunião.
- As palavras-passe usam `bcryptjs` (bcrypt em JavaScript puro), para não depender de compilação nativa na instalação.
- O resumo executivo é gerado no browser («Guardar como PDF» na janela de impressão). Não há geração de PDF no servidor.
- O catálogo de requisitos, com pesos e preços, vai no código do frontend e na rota pública de simulação. Quem abrir a página consegue lê-lo.
- `npm audit` está limpo nas dependências de produção. Nas de desenvolvimento resta um aviso do `picomatch` (usado pelo Vite, pelo Vitest e pelo Tailwind), que à data não tem versão corrigida publicada.
- O `package-lock.json` do backend deve ser mantido. Gerá-lo do zero com npm 10.9 falha por um defeito do npm a resolver as dependências do Vitest 4. Com o ficheiro presente, ou com npm 11, instala sem problemas.
