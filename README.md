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
│   ├── src/middlewares      sessão, papéis, validação, erros, limites de pedidos
│   ├── src/routes           /api/v1
│   ├── src/utils            moeda, datas, NIF e CAE
│   ├── db/migrations        001 a 006 (.sql)
│   ├── db/seeds             administrador e fábrica de moldes de demonstração
│   └── tests                unitários e de integração (PostgreSQL real)
├── frontend/                React + Vite + Tailwind + primitivas shadcn/Radix
│   └── src/{components,hooks,lib,pages}
├── e2e/                     percurso completo no browser (Playwright)
├── .devcontainer/           ambiente de teste para GitHub Codespaces
└── .github/workflows/       testes e percurso de browser em cada push
```

O motor de cálculo existe uma só vez, em `backend/src/services`, e o frontend importa-o diretamente (alias `@engine`). O número que aparece no ecrã é o mesmo que a API grava.

O catálogo está partido em dois. `requirements.ts` diz que requisitos existem e quem os exige, e vai no código público. `catalog.private.ts` tem os pesos, os pisos, o agravamento de spread, os preços e os prazos, e fica só no servidor: chega ao browser por `GET /api/v1/catalog`, e só à equipa P4S. O build do frontend falha (`npm run check:bundle`) se algum desses textos aparecer no código público.

## Testar sem instalar nada (GitHub Codespaces)

Com o projeto num repositório do GitHub:

1. Na página do repositório, **Code**, separador **Codespaces**, **Create codespace on main**.
2. Esperar que a preparação termine (alguns minutos na primeira vez). O terminal mostra as contas de teste, que ficam também em `CONTAS-DE-TESTE.txt`.
3. No separador **Ports**, abrir o endereço da porta 3000.

Para mostrar a aplicação a outra pessoa, botão direito na porta 3000, **Port Visibility**, **Public**, e partilhar o endereço. Funciona enquanto o codespace estiver ligado. É um ambiente de teste, com dados de demonstração e palavras-passe geradas na hora: não é sítio para dados de clientes.

Se a aplicação não arrancar sozinha, ou depois de atualizar o código, no terminal do codespace:

```bash
bash .devcontainer/setup.sh
```

```bash
bash .devcontainer/start.sh --reiniciar
```

## Arranque local

Requisitos: Node 20 ou superior e PostgreSQL 13 ou superior.

O `DATABASE_URL` de exemplo usa o utilizador `p4s` com a palavra-passe `p4s`. Numa máquina limpa é preciso criá-lo (ou pôr no `.env` um utilizador que já exista):

```bash
psql -U postgres -c "CREATE ROLE p4s LOGIN PASSWORD 'p4s' CREATEDB"
```

```bash
createdb -U p4s -h localhost p4s_dev
```

API (instalar primeiro, porque o frontend importa o motor de cálculo daqui):

```bash
cd backend
cp .env.example .env     # preencher JWT_SECRET (openssl rand -base64 48) e SEED_ADMIN_PASSWORD
npm install
npm run db:migrate
npm run db:seed          # com SEED_DEMO=true cria também a fábrica de demonstração
npm run dev              # http://localhost:3000
```

A API não arranca sem `JWT_SECRET` gerado nem com migrações por aplicar, e diz o que falta.

Interface:

```bash
cd frontend
npm install
npm run dev              # http://localhost:5173, com proxy de /api para a porta 3000
```

Se a API estiver noutra porta, `VITE_API_PROXY=http://localhost:3100 npm run dev`.

Num só processo e num só porto (como no Codespaces ou num servidor):

```bash
cd frontend && npm run build
cd ../backend && npm run build
STATIC_DIR=../frontend/dist npm start
```

Fora do próprio computador a aplicação só abre por HTTPS: sem ele, a palavra-passe e a sessão passavam em claro na rede. Atrás de um proxy com HTTPS (Codespaces, Render, Railway, nginx) não é preciso fazer nada, além de `TRUST_PROXY`. Para a usar por HTTP simples numa rede local de confiança existe `ALLOW_INSECURE_HTTP=true`.

Sem as dependências de desenvolvimento (`npm ci --omit=dev`), a migração e o seed correm sobre o código compilado, a partir da pasta `backend`: `npm run db:migrate:prod` e `npm run db:seed:prod`.

### Variáveis de ambiente (backend)

| Variável | Para quê |
| --- | --- |
| `DATABASE_URL` | Ligação ao PostgreSQL |
| `JWT_SECRET` | Segredo HS256, mínimo 32 caracteres, gerado (`openssl rand -base64 48`). Valores de exemplo são recusados |
| `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS` | Validade dos tokens (15 minutos e 7 dias por omissão) |
| `SESSION_MAX_TTL_SECONDS` | Duração máxima de uma sessão, por muito que seja renovada (30 dias) |
| `TRUST_PROXY` | Número de proxies à frente da API. 0 no próprio computador, 1 atrás de um proxy. Com 0 atrás de um proxy, os limites de pedidos tratam todos os clientes como um só |
| `ALLOW_INSECURE_HTTP` | `true` permite HTTP simples fora de localhost. Desligado por omissão |
| `STATIC_DIR` | Pasta do frontend compilado, para a API o servir |
| `P4S_CONTACT_EMAIL` | Contacto mostrado a quem faz a simulação sem ter conta |
| `P4S_LEGAL_IDENTITY` | Quem emite a proposta (denominação, NIF, morada), impresso no resumo |
| `P4S_PROPOSAL_TERMS` | Condições impressas no resumo (IVA, pagamento, quem é o parceiro), separadas por `\|` |
| `SEED_*` | Administrador inicial e dados de demonstração. `SEED_DEMO_PASSWORD` é a palavra-passe da conta da fábrica de demonstração |

As três variáveis `P4S_*` são texto da Plan4Sustain. Vazias, nada aparece: a aplicação não inventa condições comerciais.

## Testes

```bash
cd backend
npm run test:unit        # motor, catálogo, cobertura do plano e utilitários, sem base de dados
npm test                 # tudo, incluindo integração
```

Os testes de integração recriam o schema do zero. Só correm numa base de dados cujo nome termine em `_test` (por omissão `postgres://p4s:p4s@localhost:5432/p4s_test`, ou `TEST_DATABASE_URL`) e recusam qualquer outra.

```bash
cd frontend
npm test                 # regras do rascunho do wizard, permissões das tarefas, sessão e campos
```

Percurso no browser, com a app a correr e o seed de demonstração aplicado:

```bash
cd e2e
npm install
npx playwright install chromium
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... E2E_COMPANY_PASSWORD=... npm test
```

As palavras-passe são as usadas no seed (`SEED_ADMIN_PASSWORD` e `SEED_DEMO_PASSWORD`). `E2E_BASE_URL` indica o endereço da aplicação (por omissão `http://localhost:5173`). O percurso altera e repõe o plano da empresa de demonstração e cria uma empresa e um utilizador de teste, por isso não deve correr contra dados reais.

O workflow `.github/workflows/ci.yml` corre tudo isto em cada push: tipos, testes do backend com PostgreSQL, testes do frontend, compilação com a verificação do código público, e o percurso de browser contra a aplicação compilada.

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
| Sem TISAX / NIS2 | +0,15 (+0,35 e prioridade crítica em moldes automóvel) | Auditoria de Segurança da Informação e Conformidade NIS2/TISAX | 2, a 75 dias (1, a 60 dias, em moldes automóvel) | | 4.500 € | Parceiro |

Bloqueio setorial: em moldes automóvel, sem TISAX ou sem âmbitos 1 e 2, `W_comm` nunca fica abaixo de 0,75. Em embalagem agroalimentar, sem EcoVadis ou sem âmbitos 1 e 2, nunca fica abaixo de 0,65.

**2. Sobrecusto bancário anual (€/ano)**

Sem rácios ESG e com crédito a renovar nos próximos 18 meses, aplica-se um agravamento de 40 pontos base (0,40% ao ano): `round(crédito a refinanciar × 0,0040)`. Gera a tarefa «Dossier de Sustentabilidade para Indexação de Spread Bancário» (Fase 1, 30 dias, 1.800 €, P4S).

**3. Orçamento**

`phase1Cost` e `phase2Cost` somam os honorários das tarefas incluídas na proposta e executadas pela P4S ou pelo parceiro (tarefas internas ou desligadas não contam). O custo compara-se só com a faturação comercial em risco (`phase1CostShareOfRisk`, `totalCostShareOfRisk`).

### Pressupostos e como são apresentados

Os pesos, os pisos e os 40 pontos base são pressupostos de trabalho da P4S, não medições. Por isso:

- a faturação em risco e o sobrecusto bancário aparecem como ordem de grandeza («≈ 2,8 M €»), com o valor calculado disponível ao passar o rato;
- o plano e o resumo impresso dizem com que faturação, concentração de clientes e crédito o número foi calculado;
- o plano de ação tem a secção «De onde vêm os números e que pressupostos têm», com as contas todas, e o resumo impresso leva uma nota a dizer o mesmo;
- quando houver um caso real ou uma fonte para um peso, regista-se em `evidence` no catálogo privado e passa a aparecer junto do peso;
- os honorários são preços e aparecem sempre exatos.

### Fases e prazos

As janelas estão em `PHASE_WINDOWS` (`requirements.ts`): Fase 1 de 0 a 60 dias, Fase 2 de 60 a 120 dias, contados da data de emissão da proposta. Um teste verifica que todas as tarefas-tipo, em todos os setores, têm prazo dentro da janela da sua fase. Quando alguém edita uma tarefa para fora da janela, o configurador e o painel de edição avisam.

Um entregável da P4S ou do parceiro incluído na proposta tem de ter prazo.

### NIS2

A NIS2 só obriga as empresas abrangidas, o que depende do setor e da dimensão. A aplicação nunca a apresenta como obrigação certa: aparece como «NIS2 (se a empresa estiver abrangida)» e a descrição da tarefa diz que é a auditoria que o confirma.

## Lacunas e plano

Cada tarefa gerada pelo diagnóstico guarda o requisito a que responde (`requirement_code`) e há no máximo uma por lacuna. A matriz de conformidade, a tabela de lacunas do resumo impresso e os indicadores do topo leem daí o estado atual (`plan-coverage.ts`): o entregável está na proposta, a cargo da empresa, fora da proposta, concluído, ou foi eliminado. Uma lacuna crítica continua a contar enquanto não estiver resolvida, mesmo que o entregável seja eliminado, e a equipa P4S pode repô-lo com os termos do diagnóstico.

Os valores em risco são os do dia do diagnóstico. Não descem quando um entregável é concluído: o que mostra o andamento é a faixa «Andamento» e a matriz.

## Proposta

- A proposta tem data de emissão guardada no servidor (a do diagnóstico) e vale 30 dias. A validade é a mesma para toda a gente e não muda com o dia em que se imprime.
- Passado o prazo, o plano e o resumo dizem que a proposta expirou. A equipa P4S reemite-a com a data do dia, e os entregáveis que ainda não começaram deslizam o mesmo número de dias.
- O resumo impresso diz que os prazos são calculados para adjudicação na data de emissão e que deslizam se a adjudicação for posterior.
- Sem entregáveis da P4S ou do parceiro, o resumo regista o diagnóstico e não leva bloco de aceitação.

## API

Base: `/api/v1`. Erros em `{ "error": { "code", "message", "details?" } }`. Nenhuma resposta fica em cache (`Cache-Control: no-store`).

| Rota | Acesso | Notas |
| --- | --- | --- |
| `GET /public-info` | público | Contacto, identificação e condições da proposta configurados no `.env` |
| `POST /auth/login` | público | Devolve `accessToken` e `refreshToken` |
| `POST /auth/refresh` | público | Renova a sessão. A equipa P4S passa `companyId` para escolher a empresa |
| `POST /auth/logout` | sessão | Termina a sessão em todos os dispositivos |
| `GET /auth/me` | sessão | |
| `POST /auth/change-password` | sessão | Devolve uma sessão nova |
| `POST /auth/password-link/inspect` | público | Diz a quem pertence um link de palavra-passe válido |
| `POST /auth/set-password` | público | Define a palavra-passe com um link de uso único e abre a sessão |
| `GET /catalog` | equipa P4S | Pesos, pisos, preços e prazos |
| `POST /assessments/simulate` | público | Nada é gravado. A equipa P4S recebe o cálculo completo. Os outros recebem escalões |
| `POST /assessments` | equipa P4S | Calcula, grava a avaliação e insere as tarefas numa transação. Com `company: { name, nif }` cria a empresa na hora |
| `GET /assessments`, `GET /assessments/:id` | sessão com empresa | |
| `POST /assessments/:id/reissue-proposal` | equipa P4S | A proposta passa a contar como emitida hoje |
| `POST /assessments/:id/deliverables/:code/restore` | equipa P4S | Repõe o entregável-tipo de uma lacuna |
| `DELETE /assessments/:id` | equipa P4S | Elimina o diagnóstico e as tarefas |
| `GET /tasks` | sessão com empresa | Filtros `status`, `domain`, `priority`, `executor_type`, `phase`, `assessment_id` |
| `POST /tasks`, `GET /tasks/:id`, `PUT /tasks/:id` | sessão com empresa | |
| `DELETE /tasks/:id` | equipa P4S | |
| `GET /companies`, `POST /companies`, `PUT /companies/:id` | equipa P4S | |
| `GET /companies/:id` | sessão | A conta de uma empresa só vê a sua |
| `GET /companies/current/users` | sessão com empresa | Possíveis responsáveis: nome e equipa, sem emails |
| `GET /users`, `POST /users`, `PUT /users/:id`, `POST /users/:id/password-link` | equipa P4S | Utilizadores da empresa selecionada |
| `GET /users/team` | administrador | Equipa P4S |

### Simulação por escalões

Para a tabela de preços e o modelo não ficarem públicos, quem não é da equipa P4S recebe a simulação sem pesos, pisos, preços nem prazos, e com os valores em escalões fixos: a faturação em risco em escalões de 20 pontos da base exposta, o sobrecusto bancário em escalões de 25 pontos base. São escalões fixos e não uma margem à volta do valor exato porque, com uma margem, quem fizesse pedidos em série recuperava os pesos pelo ponto médio.

## Regras de acesso

- **Isolamento por empresa.** Todas as queries a `assessments` e `tasks` filtram por `company_id = $1`, e esse valor vem só da sessão. Há um teste que lê o SQL de todo o código da API e falha se aparecer uma query a essas tabelas sem o filtro.
- **Papéis.** `admin` e `consultant` são a equipa P4S e escolhem a empresa em que estão a trabalhar. `company_user` fica sempre na sua empresa.
- **Conta de uma empresa.** Acompanha o plano. Nas tarefas do diagnóstico e nas criadas pela P4S atualiza o estado e o responsável, e mais nada: âmbito, prazo, preço, executor, fase e inclusão na proposta são da P4S, seja qual for o executor do momento. Cria tarefas internas e altera as que criou. Não elimina tarefas, não grava diagnósticos e não recebe os pesos nem a tabela de preços (simula por escalões).
- **Gestão de utilizadores.** Administradores e consultores gerem os utilizadores da empresa que têm selecionada. Só o administrador gere a equipa P4S. Ninguém desativa a própria conta e fica sempre pelo menos um administrador que consegue entrar.

## Sessão, utilizadores e palavras-passe

Não há envio de email. A equipa P4S cria a conta sem palavra-passe e recebe um link de uso único, que entrega à pessoa pelo canal que já usa com ela. O mesmo mecanismo serve para convidar (link válido 7 dias) e para recuperar a palavra-passe (48 horas).

- Na base de dados fica só o SHA-256 do token. O link é mostrado uma vez e gerar um novo anula o anterior.
- O token vai no fragmento do endereço (`#token=…`), que o browser não envia a servidores nem fica em registos de acesso.
- Cada pedido confirma na base de dados que a conta existe, está ativa e tem a mesma versão de sessão do token. «Sair», mudar a palavra-passe e desativar a conta sobem essa versão: as sessões abertas terminam no pedido seguinte, em todos os dispositivos.
- Uma sessão renova-se durante 30 dias, no máximo. Depois é preciso entrar outra vez.
- O login aceita 10 tentativas falhadas por endereço e email em 15 minutos, para que as tentativas contra uma conta não bloqueiem as outras pessoas do mesmo escritório.
- Palavras-passe com pelo menos 10 caracteres e no máximo 72 bytes (o bcrypt ignora o que passa disso).

## Decisões e limites conhecidos

- **Só a equipa P4S grava diagnósticos.** Um diagnóstico gravado gera entregáveis com preço e é a base de uma proposta. A conta de uma empresa fica com a simulação por escalões.
- **A conta de uma empresa não mexe no prazo dos entregáveis.** «Prazo fechado» é um compromisso de quem executa.
- **Os prazos da proposta contam da data de emissão.** O resumo diz que deslizam se a adjudicação for posterior. A aplicação não regista a aceitação da proposta.
- `remediationSummary` não tem `protectionRatio`. Somava faturação (um valor), sobrecusto de spread (um custo anual) e dividia por honorários (um custo único), o que dava um múltiplo sem significado.
- A tarefa de TISAX/NIS2 em moldes automóvel tem prazo de 60 dias, e não os 75 dos outros setores, porque aí entra na Fase 1 (0 a 60 dias). É um compromisso do parceiro de segurança e convém confirmá-lo com ele.
- Alguns nomes diferem entre ecrãs porque a especificação os fixou assim: «Carteira comercial exposta» e «Penalização bancária anual» no plano, «Faturação comercial em risco» e «Sobrecusto bancário anual» no simulador e no resumo impresso.
- O perfil «Indústria de processo» dá os mesmos resultados que «Indústria transformadora geral»: o catálogo não tem pesos próprios para ele.
- Um refresh token copiado continua a valer até a pessoa sair, mudar a palavra-passe ou passarem os 30 dias. Não há deteção de reutilização.
- Sem serviço de email, não há recuperação de palavra-passe pelo próprio utilizador. Tem de pedir um link à equipa P4S.
- A sessão fica no `localStorage` do browser, para sobreviver a uma recarga durante a reunião.
- As palavras-passe usam `bcryptjs` (bcrypt em JavaScript puro), para não depender de compilação nativa na instalação.
- O resumo executivo é gerado no browser («Guardar como PDF» na janela de impressão). Não há geração de PDF no servidor.
- `npm audit` está limpo nas dependências de produção. Nas de desenvolvimento resta um aviso do `picomatch` (usado pelo Vite, pelo Vitest e pelo Tailwind), que à data não tem versão corrigida publicada.
- Os `package-lock.json` devem ser mantidos. Gerá-los do zero com npm 10.9 falha por um defeito do npm a resolver as dependências do Vitest 4. Com os ficheiros presentes, ou com npm 11, instala sem problemas.
- O ambiente de Codespaces foi escrito a partir do modelo oficial. Os scripts de preparação e de arranque e o percurso de browser foram testados fora do contentor, numa cópia limpa. O contentor em si não foi corrido.
