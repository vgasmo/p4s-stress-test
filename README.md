# P4S · Stress Test de Qualificação de Fornecedores

Diagnóstico de 5 minutos e configurador de proposta para PME industriais (moldes, plásticos, automóvel, metalomecânica, agroalimentar). Estima a faturação comercial em risco e o sobrecusto bancário anual por falta de EcoVadis, pegada de carbono, rácios ESG para a banca e segurança da informação, e gera um plano de ação faseado com preço e prazo fechados.

## Estrutura

```text
p4s-stress-test/
├── backend/                 API Express + TypeScript + PostgreSQL (MVC + serviços)
│   ├── src/config           env (validado com zod), base de dados, JWT
│   ├── src/controllers      auth, assessment, task, company, user, catalog
│   ├── src/models           acesso a dados, tipos de domínio, contratos de entrada e saída
│   ├── src/services         motor de cálculo, catálogo, gerador de tarefas, regras de negócio
│   ├── src/middlewares      JWT, papéis, validação, erros, limites de pedidos
│   ├── src/routes           /api/v1
│   ├── src/utils            moeda, datas, NIF e CAE
│   ├── db/migrations        001 a 004 (.sql)
│   ├── db/seeds             administrador e fábrica de moldes de demonstração
│   └── tests                unitários e de integração (PostgreSQL real)
├── frontend/                React + Vite + Tailwind + primitivas shadcn/Radix
│   └── src/{components,hooks,lib,pages}
├── e2e/                     percurso completo no browser (Playwright)
└── .devcontainer/           ambiente de teste para GitHub Codespaces
```

O motor de cálculo existe uma só vez, em `backend/src/services`, e o frontend importa-o diretamente (alias `@engine`). O número que aparece no ecrã é o mesmo que a API grava.

O catálogo está partido em dois. `requirements.ts` diz que requisitos existem e quem os exige, e vai no código público. `catalog.private.ts` tem os pesos, os pisos, o agravamento de spread, os preços e os prazos, e fica só no servidor: chega ao browser por `GET /api/v1/catalog`, a quem tem sessão. O build do frontend falha (`npm run check:bundle`) se algum desses valores aparecer no código público.

## Testar sem instalar nada (GitHub Codespaces)

Com o projeto num repositório do GitHub:

1. Na página do repositório, **Code**, separador **Codespaces**, **Create codespace on main**.
2. Esperar que a preparação termine (alguns minutos na primeira vez). O terminal mostra as contas de teste, que ficam também em `CONTAS-DE-TESTE.txt`.
3. No separador **Ports**, abrir o endereço da porta 3000.

Para mostrar a aplicação a outra pessoa, botão direito na porta 3000, **Port Visibility**, **Public**, e partilhar o endereço. Funciona enquanto o codespace estiver ligado. É um ambiente de teste, com dados de demonstração e palavras-passe geradas na hora: não é sítio para dados de clientes.

Se a aplicação não arrancar sozinha, no terminal do codespace:

```bash
bash .devcontainer/start.sh
```

## Arranque local

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
| `TRUST_PROXY` | Número de proxies à frente da API. Sem isto atrás de um proxy, os limites de pedidos tratam todos os clientes como um só |
| `STATIC_DIR` | Pasta do frontend compilado, para a API o servir |
| `SEED_*` | Administrador inicial e dados de demonstração |

## Testes

```bash
cd backend
npm run test:unit        # motor, catálogo e utilitários, sem base de dados
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

As palavras-passe são as usadas no seed (`SEED_ADMIN_PASSWORD` e `SEED_DEMO_PASSWORD`). O percurso altera e repõe o plano da empresa de demonstração e cria uma empresa e um utilizador de teste, por isso não deve correr contra dados reais.

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
| Sem TISAX / NIS2 | +0,15 (+0,35 e prioridade crítica em moldes automóvel) | Auditoria de Segurança da Informação e Conformidade NIS2/TISAX | 2 a 75 dias (1 a 60 dias em moldes automóvel) | | 4.500 € | Parceiro |

Pisos de bloqueio setorial: em moldes automóvel, sem TISAX/NIS2 ou sem âmbitos 1 e 2, `W_comm` nunca fica abaixo de 0,75. Em embalagem agroalimentar, sem EcoVadis ou sem âmbitos 1 e 2, nunca fica abaixo de 0,65.

**2. Sobrecusto bancário anual (€/ano)**

Sem rácios ESG e com crédito a renovar nos próximos 18 meses, aplica-se um agravamento de 40 pontos base: `round(crédito a refinanciar × 0,0040)`. Gera a tarefa «Dossier de Sustentabilidade para Indexação de Spread Bancário» (Fase 1, 30 dias, 1.800 €, P4S).

**3. Orçamento**

`phase1Cost` e `phase2Cost` somam os honorários das tarefas incluídas na proposta e executadas pela P4S ou pelo parceiro (tarefas internas ou desligadas não contam). O custo compara-se só com a faturação comercial em risco (`phase1CostShareOfRisk`, `totalCostShareOfRisk`).

### Pressupostos e como são apresentados

Os pesos, os pisos e os 40 pontos base são pressupostos de trabalho da P4S, não medições. Por isso:

- a faturação em risco e o sobrecusto bancário aparecem como ordem de grandeza («≈ 2,8 M €»), com o valor calculado disponível ao passar o rato;
- o plano de ação tem a secção «De onde vêm os números e que pressupostos têm», com as contas todas, e o resumo impresso leva uma nota a dizer o mesmo;
- quando houver um caso real ou uma fonte para um peso, regista-se em `evidence` no catálogo privado e passa a aparecer junto do peso;
- os honorários são preços e aparecem sempre exatos.

### Fases

As janelas estão em `PHASE_WINDOWS` (`requirements.ts`): Fase 1 de 0 a 60 dias, Fase 2 de 60 a 120 dias. Um teste verifica que todas as tarefas-tipo, em todos os setores, têm prazo dentro da janela da sua fase. Quando alguém edita uma tarefa para fora da janela, o configurador e o painel de edição avisam.

### NIS2

A NIS2 só obriga as empresas abrangidas, o que depende do setor e da dimensão. A aplicação nunca a apresenta como obrigação certa: aparece como «NIS2 (se a empresa estiver abrangida)» e a descrição da tarefa diz que é a auditoria que o confirma.

## API

Base: `/api/v1`. Erros em `{ "error": { "code", "message", "details?" } }`.

| Rota | Acesso | Notas |
| --- | --- | --- |
| `POST /auth/login` | público | Devolve `accessToken` e `refreshToken` |
| `POST /auth/refresh` | público | Renova a sessão. A equipa P4S passa `companyId` para escolher a empresa |
| `GET /auth/me` | sessão | |
| `POST /auth/change-password` | sessão | Devolve uma sessão nova |
| `POST /auth/password-link/inspect` | público | Diz a quem pertence um link de palavra-passe válido |
| `POST /auth/set-password` | público | Define a palavra-passe com um link de uso único e abre a sessão |
| `GET /catalog` | sessão | Pesos, pisos, preços e prazos |
| `POST /assessments/simulate` | público | Nada é gravado. Com sessão devolve o cálculo completo. Sem sessão devolve só escalões |
| `POST /assessments` | sessão | Calcula, grava a avaliação e insere as tarefas numa transação. A equipa P4S pode enviar `company: { name, nif }` para criar a empresa na hora |
| `GET /assessments`, `GET /assessments/:id` | sessão com empresa | |
| `GET /tasks` | sessão com empresa | Filtros `status`, `domain`, `priority`, `executor_type`, `phase`, `assessment_id` |
| `POST /tasks`, `GET /tasks/:id`, `PUT /tasks/:id` | sessão com empresa | |
| `DELETE /tasks/:id` | equipa P4S | |
| `GET /companies`, `POST /companies` | equipa P4S | |
| `GET /companies/:id`, `GET /companies/current/users` | sessão | |
| `GET /users`, `POST /users`, `PUT /users/:id`, `POST /users/:id/password-link` | equipa P4S | Utilizadores da empresa selecionada |
| `GET /users/team` | administrador | Equipa P4S |

### Simulação sem sessão

Para a tabela de preços e o modelo não ficarem públicos, a resposta sem sessão não leva pesos, pisos, preços nem prazos, e os valores vêm em escalões fixos: a faturação em risco em escalões de 20 pontos da base exposta, o sobrecusto bancário em escalões de 25 pontos base. São escalões fixos e não uma margem à volta do valor exato porque, com uma margem, quem fizesse pedidos em série recuperava os pesos pelo ponto médio.

## Regras de acesso

- **Isolamento por empresa.** Todas as queries a `assessments` e `tasks` filtram por `company_id = $1`, e esse valor vem só do JWT. Há um teste que lê o SQL dos models e falha se aparecer uma query sem o filtro.
- **Papéis.** `admin` e `consultant` são a equipa P4S e escolhem a empresa em que estão a trabalhar. `company_user` fica sempre na sua empresa.
- **Utilizador da empresa.** Consulta o plano, atualiza estado, prazo e responsável, e cria tarefas internas. Não elimina tarefas e, em tarefas da P4S ou do parceiro, não altera honorários, executor, fase nem inclusão na proposta.
- **Gestão de utilizadores.** Administradores e consultores gerem os utilizadores da empresa que têm selecionada. Só o administrador gere a equipa P4S. Ninguém desativa a própria conta e fica sempre pelo menos um administrador que consegue entrar.

## Utilizadores e palavras-passe

Não há envio de email. A equipa P4S cria a conta sem palavra-passe e recebe um link de uso único, que entrega à pessoa pelo canal que já usa com ela. O mesmo mecanismo serve para convidar (link válido 7 dias) e para recuperar a palavra-passe (48 horas).

- Na base de dados fica só o SHA-256 do token. O link é mostrado uma vez e gerar um novo anula o anterior.
- O token vai no fragmento do endereço (`#token=…`), que o browser não envia a servidores nem fica em registos de acesso.
- Mudar a palavra-passe ou desativar a conta sobe `users.token_version`: as sessões abertas antes deixam de poder ser renovadas, o que as termina em 15 minutos no máximo.
- Palavras-passe com pelo menos 10 caracteres e no máximo 72 bytes (o bcrypt ignora o que passa disso).

## Decisões e limites conhecidos

- A gravação de diagnósticos exige sessão. A simulação é pública, mas criar empresas e avaliações sem autenticação abria a porta a lixo e a dados sem dono.
- A regra pedida para o utilizador da empresa era só sobre `estimated_cost`. Ficou alargada a executor, fase e inclusão na proposta, porque bastava mudar o executor para «Interno» para contornar o bloqueio do custo.
- `remediationSummary` não tem `protectionRatio`. Somava faturação (um valor), sobrecusto de spread (um custo anual) e dividia por honorários (um custo único), o que dava um múltiplo sem significado.
- A tarefa de TISAX/NIS2 em moldes automóvel tem prazo de 60 dias, e não os 75 dos outros setores, porque aí entra na Fase 1 (0 a 60 dias). É um compromisso do parceiro de segurança e convém confirmá-lo com ele.
- O catálogo é servido a qualquer utilizador com sessão, incluindo os das empresas clientes, que ficam a conhecer os pesos e os preços de todos os setores.
- Os access tokens não são revogáveis: desativar uma conta tem efeito no máximo 15 minutos depois.
- Sem serviço de email, não há recuperação de palavra-passe pelo próprio utilizador. Tem de pedir um link à equipa P4S.
- A sessão fica no `localStorage` do browser, para sobreviver a uma recarga durante a reunião.
- As palavras-passe usam `bcryptjs` (bcrypt em JavaScript puro), para não depender de compilação nativa na instalação.
- O resumo executivo é gerado no browser («Guardar como PDF» na janela de impressão). Não há geração de PDF no servidor.
- `npm audit` está limpo nas dependências de produção. Nas de desenvolvimento resta um aviso do `picomatch` (usado pelo Vite, pelo Vitest e pelo Tailwind), que à data não tem versão corrigida publicada.
- O `package-lock.json` do backend deve ser mantido. Gerá-lo do zero com npm 10.9 falha por um defeito do npm a resolver as dependências do Vitest 4. Com o ficheiro presente, ou com npm 11, instala sem problemas.
- O ambiente de Codespaces foi escrito a partir do modelo oficial e os scripts de preparação e de arranque foram testados fora do contentor. O contentor em si não foi corrido.
