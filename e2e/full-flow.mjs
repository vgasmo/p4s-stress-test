// Percurso ponta a ponta no browser: simulação anónima, login, criação rápida de empresa,
// plano, configurador (otimista + reversão), painel lateral, kanban, impressão, estados
// de erro/loading/vazio, permissões da empresa e telemóvel.
//
// Precisa da app a correr e da base de dados com o seed de demonstração (SEED_DEMO=true).
// Uso (ver README):
//   E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… E2E_COMPANY_PASSWORD=… node full-flow.mjs [pasta-de-capturas]
// Opcionais: E2E_BASE_URL (http://localhost:5173), E2E_COMPANY_EMAIL, E2E_SCALE (1),
// E2E_FAKE_AI=on (a aplicação arrancou ligada a fake-ai.mjs: corre também a análise de documentos).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`Falta a variável ${name}. Ver a secção «Testes» do README.`);
    process.exit(2);
  }
  return value;
};
const ADMIN_EMAIL = required('E2E_ADMIN_EMAIL');
const ADMIN_PASSWORD = required('E2E_ADMIN_PASSWORD');
const COMPANY_EMAIL = process.env.E2E_COMPANY_EMAIL ?? 'gestao@moldes-exemplo.test';
const COMPANY_PASSWORD = required('E2E_COMPANY_PASSWORD');

/** A aplicação está ligada ao servidor que faz de API de IA (fake-ai.mjs): corre o percurso dos documentos. */
const FAKE_AI = process.env.E2E_FAKE_AI === 'on';
const EXAMPLE_QUESTIONNAIRE = fileURLToPath(new URL('../exemplos/questionario-fornecedor-exemplo.pdf', import.meta.url));

const OUT = process.argv[2] ?? 'capturas';
const SCALE = Number(process.env.E2E_SCALE ?? 1);
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });

const nbsp = ' ';
const eur = (text) => `${text}${nbsp}€`;
/** Os valores formatados usam espaços que não partem linha: «≈ 2,8 M €» → com U+00A0. */
const nb = (text) => text.replaceAll(' ', nbsp);
let failures = 0;
const log = (...args) => console.log('·', ...args);
const fail = (message) => {
  failures += 1;
  console.error('FALHOU:', message);
};
const expectEq = (label, actual, expected) =>
  actual === expected ? log(`${label}: ${actual}`) : fail(`${label}: esperado «${expected}», obtido «${actual}»`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: SCALE, locale: 'pt-PT' });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (msg) => msg.type() === 'error' && consoleErrors.push(msg.text()));
page.on('pageerror', (err) => consoleErrors.push(String(err)));

// Pedidos à API em curso e respostas de erro (com URL, para se saber de onde vêm).
const inFlight = new Set();
const httpErrors = [];
const isApi = (request) => request.url().includes('/api/');
page.on('request', (request) => {
  // Uma navegação para outro documento abandona os pedidos do anterior, sem os dar por falhados.
  if (request.isNavigationRequest() && request.frame() === page.mainFrame()) inFlight.clear();
  if (isApi(request)) inFlight.add(request);
});
// O documento anterior ainda pode lançar um pedido de leitura depois de a navegação ter começado
// (por exemplo ao redesenhar o ecrã de entrada). Esse pedido morre com o documento e nunca é dado
// por terminado: quando o documento novo fica pronto, as leituras que vinham de trás saem da conta.
page.on('domcontentloaded', () => {
  for (const request of inFlight) if (request.method() === 'GET') inFlight.delete(request);
});
page.on('requestfinished', (request) => inFlight.delete(request));
page.on('requestfailed', (request) => inFlight.delete(request));
page.on('response', (response) => {
  if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
});

const kpi = (id) => page.getByTestId(id).innerText();
/** Espera que não haja pedidos à API em curso durante 150 ms seguidos (no máximo 10 s). */
const settle = async () => {
  const started = Date.now();
  for (let quiet = 0; quiet < 3; ) {
    await page.waitForTimeout(50);
    quiet = inFlight.size === 0 ? quiet + 1 : 0;
    if (Date.now() - started > 10_000) {
      const stuck = [...inFlight].map((r) => `${r.method()} ${new URL(r.url()).pathname}`);
      inFlight.clear();
      // Uma escrita sem resposta é uma falha. Uma leitura pode ter sido abandonada por uma navegação.
      if (stuck.some((entry) => !entry.startsWith('GET '))) fail(`pedidos sem resposta ao fim de 10 s: ${stuck.join(', ')}`);
      else log(`(leituras abandonadas, sem resposta ao fim de 10 s: ${stuck.join(', ')})`);
      return;
    }
  }
};
/** Espera que o indicador mostre exatamente o texto (comparação exata, não por substring). */
const expectText = async (label, testId, expected, timeout = 4000) => {
  const started = Date.now();
  try {
    await page.waitForFunction(
      ([id, text]) => document.querySelector(`[data-testid="${id}"]`)?.innerText === text,
      [testId, expected],
      { timeout, polling: 10 },
    );
    log(`${label}: ${expected} (${Date.now() - started} ms)`);
  } catch {
    fail(`${label}: esperado «${expected}», obtido «${await kpi(testId)}» ao fim de ${timeout} ms`);
  }
};
const loginAs = async (email, password) => {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Palavra-passe').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
};
/** «Sair» termina a sessão no servidor: espera pela resposta antes de continuar. */
const logout = async () => {
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/logout')),
    page.getByRole('button', { name: /Terminar sessão/ }).click(),
  ]);
};
const storedSession = () => page.evaluate(() => JSON.parse(window.localStorage.getItem('p4s.session') ?? 'null'));
const apiStatus = async (path, token) =>
  (await page.request.get(`${BASE}/api/v1${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })).status();
const serverError = { status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente.' } }) };

// ── 1. Simulação anónima ────────────────────────────────────────────────────────────
await page.goto(BASE + '/');
await page.getByRole('radio', { name: 'Moldes e componentes automóvel' }).click();
await page.getByRole('button', { name: '10M €' }).first().click();
await page.getByRole('switch', { name: /EcoVadis/ }).click();
await page.getByRole('switch', { name: /âmbitos 1 e 2/ }).click();
// Sem sessão o servidor devolve só o escalão. 10M × 60% = 6M; falta âmbito 3 e TISAX,
// com piso de bloqueio: cai no escalão 60–80% → 3,6 M € a 4,8 M €.
await expectText('sem sessão: escalão em vez do valor', 'preview-revenue-at-risk', `${nb('3,6 M €')} a ${nb('4,8 M €')}`);
await page.getByText('Bloqueio setorial').waitFor();
await page.getByRole('switch', { name: /Refinanciamento bancário/ }).click();
await page.getByText('agravamento de spread').waitFor();
await settle();
const publicText = await page.locator('body').innerText();
expectEq('sem sessão: a página não mostra preços', /\d\.\d{3}\s€(?!\/ano)/.test(publicText.split('O que falta')[1] ?? ''), false);
expectEq('sem sessão: a página não mostra pesos', /na exposição|bps|% ao ano/.test(publicText), false);
expectEq('sem sessão: o catálogo não é servido', (await page.request.get(`${BASE}/api/v1/catalog`)).status(), 401);
await page.screenshot({ path: `${OUT}/01-wizard-anonimo.png`, fullPage: true });

// ── 2. Entrar como empresa: a simulação mantém-se, sempre por escalões e sem gravar ──
await page.getByRole('link', { name: 'Já tenho conta' }).click();
await loginAs(COMPANY_EMAIL, COMPANY_PASSWORD);
await page.waitForURL(/\/$/);
await page.getByText('Simulação para Moldes Exemplo, Lda (demonstração)').waitFor();
// A conta de uma empresa vê o mesmo que um visitante: os pesos e os preços são da equipa P4S.
await expectText('empresa: a simulação mantém-se, por escalões', 'preview-revenue-at-risk', `${nb('3,6 M €')} a ${nb('4,8 M €')}`);
await settle();
const companySession = await storedSession();
expectEq('empresa: o catálogo não é servido', await apiStatus('/catalog', companySession.accessToken), 403);
expectEq('empresa: a página não mostra pesos', /na exposição|bps|% ao ano/.test(await page.locator('body').innerText()), false);
expectEq('empresa: não grava diagnósticos', await page.getByRole('button', { name: /Guardar Diagnóstico/ }).count(), 0);
await page.getByRole('link', { name: 'Abrir o plano de ação da empresa' }).waitFor();
await logout();
await page.getByText('Sem registo, vê a ordem de grandeza').waitFor();
expectEq('sair termina a sessão no servidor', await apiStatus('/auth/me', companySession.accessToken), 401);
// Rascunho de origem (5M, 60%, nada conforme): escalão 80–100% de 3M.
await expectText('rascunho limpo ao sair (não mostra dados do cliente)', 'preview-revenue-at-risk', `${nb('2,4 M €')} a ${nb('3 M €')}`);

// ── 3. Equipa P4S sem empresa: escolher a empresa abre o plano, «sem empresa» volta ──
await page.goto(BASE + '/entrar');
await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
await page.waitForURL(/\/plano$/);
await page.getByText('Escolha a empresa cliente').waitFor();
const demoValue = await page.getByLabel('Empresa cliente').locator('option', { hasText: 'Moldes Exemplo' }).getAttribute('value');
await page.getByLabel('Empresa cliente').selectOption(demoValue);
await page.getByRole('heading', { name: 'Moldes Exemplo, Lda (demonstração)' }).waitFor();
log('P4S sem empresa → escolher a empresa abre o plano dela');
await page.getByLabel('Empresa cliente').selectOption('');
await page.waitForURL(/\/$/);
await page.getByLabel('NIF').waitFor();
await expectText('P4S → «sem empresa» volta ao stress test com rascunho limpo', 'preview-revenue-at-risk', nb('≈ 3 M €'));
expectEq('P4S: valor calculado disponível', await page.getByTestId('preview-revenue-at-risk').getAttribute('title'), `Valor calculado: ${eur('3.000.000')}`);

// ── 3b. Criação rápida de empresa por NIF + nome e gravação ─────────────────────────
await page.getByLabel('Nome').fill('Embalagens Reunião E2E, Lda');
await page.getByRole('button', { name: /Guardar Diagnóstico/ }).click();
await page.getByText('NIF inválido').waitFor();
log('validação: NIF em falta bloqueia a gravação');
await page.getByLabel('NIF').fill('503456782'); // dígito de controlo errado
await page.getByText('NIF inválido').waitFor();
// Um NIF colado de uma fatura, com prefixo e espaços, fica com os 9 algarismos.
await page.getByLabel('NIF').fill('PT503 456 780');
expectEq('NIF colado com «PT» e espaços', await page.getByLabel('NIF').inputValue(), '503456780');
await page.getByRole('radio', { name: 'Embalagem agroalimentar' }).click();
// Um valor que não se percebe («7.2» pode ser 7,2 ou 7.200) não é gravado como outra coisa.
const posts = [];
const countPosts = (request) => request.method() === 'POST' && request.url().endsWith('/api/v1/assessments') && posts.push(request.url());
page.on('request', countPosts);
await page.getByLabel('Faturação anual').fill('7.2');
await page.getByRole('button', { name: /Guardar Diagnóstico/ }).click();
await page.getByText('Corrija o valor assinalado antes de guardar.').waitFor();
expectEq('valor ambíguo: não grava', posts.length, 0);
page.off('request', countPosts);
// Escrito por extenso, como se diz numa reunião.
await page.getByLabel('Faturação anual').fill('2M');
await page.getByLabel('Faturação anual').blur();
expectEq('«2M» fica como 2.000.000 €', (await page.getByLabel('Faturação anual').inputValue()).replace(/\s/g, ''), '2.000.000');
await page.getByRole('switch', { name: /âmbitos 1 e 2/ }).click();
await page.getByRole('switch', { name: /Segurança da informação/ }).click();
// 2M × 60% = 1,2M; EcoVadis 45 + âmbito 3 20 = 65 (piso agro 65) → 780.000 €
await expectText('preview agro', 'preview-revenue-at-risk', nb('≈ 780 mil €'));
await page.getByRole('button', { name: /Guardar Diagnóstico/ }).click();
await page.waitForURL(/\/plano\/[0-9a-f-]{36}$/);
await page.getByTestId('kpi-total').waitFor();
await expectText('plano gravado: carteira exposta', 'kpi-commercial-risk', nb('≈ 780 mil €'));
await expectText('plano gravado: total', 'kpi-total', eur('7.300')); // EcoVadis 3.500 + âmbito 3 3.800
await page.getByRole('heading', { name: 'Embalagens Reunião E2E, Lda' }).waitFor();
log('sessão passou para a empresa criada');

// ── 3c. Corrigir os dados da empresa (nome mal escrito na reunião) ───────────────────
await page.getByRole('button', { name: 'Editar dados da empresa' }).click();
await page.getByRole('dialog').waitFor();
await page.getByLabel('Nome').fill('Embalagens Reunião E2E, SA');
await page.getByLabel('CAE').fill('22220');
await page.getByRole('button', { name: 'Guardar alterações' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
await page.getByRole('heading', { name: 'Embalagens Reunião E2E, SA' }).waitFor();
await page.emulateMedia({ media: 'print' });
expectEq('nome corrigido chega à linha «Aceite por» do resumo', (await page.getByTestId('executive-print-view').innerText()).includes('Aceite por Embalagens Reunião E2E, SA'), true);
await page.emulateMedia({ media: 'screen' });
await page.getByRole('button', { name: 'Editar dados da empresa' }).click();
await page.getByLabel('Nome').fill('Embalagens Reunião E2E, Lda');
await page.getByRole('button', { name: 'Guardar alterações' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
await page.getByRole('heading', { name: 'Embalagens Reunião E2E, Lda' }).waitFor();
log('dados da empresa corrigidos e repostos');

// ── 3d. Eliminar o diagnóstico: diz o que se perde, e só elimina ao segundo clique ───
const createdUrl = page.url();
const createdId = createdUrl.split('/').pop();
await page.getByRole('button', { name: 'Eliminar este diagnóstico' }).click();
const deleteConfirmation = page.getByTestId('delete-assessment-confirmation');
await deleteConfirmation.waitFor();
expectEq('eliminar: a confirmação diz o que se perde', (await deleteConfirmation.innerText()).includes('as 2 tarefas do plano deixam de existir'), true);
await deleteConfirmation.getByRole('button', { name: 'Cancelar' }).click();
await deleteConfirmation.waitFor({ state: 'detached' });
await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Eliminar este diagnóstico', null, { timeout: 2000 }).then(
  () => log('eliminar: cancelar devolve o foco ao botão'),
  () => fail('eliminar: cancelar não devolveu o foco ao botão'),
);
expectEq('eliminar: cancelar não elimina', page.url(), createdUrl);
await page.getByRole('button', { name: 'Eliminar este diagnóstico' }).click();
await deleteConfirmation.getByRole('button', { name: 'Eliminar diagnóstico e tarefas' }).click();
await page.waitForURL((url) => !url.pathname.endsWith(createdId));
await settle();
expectEq('eliminar: o diagnóstico deixa de existir', await apiStatus(`/assessments/${createdId}`, (await storedSession()).accessToken), 404);

// ── 3e. O diagnóstico grava, mas a troca para a empresa dele falha: não se dá como perdido ──
await page.getByLabel('Empresa cliente').selectOption('');
await page.waitForURL(/\/$/);
await page.getByLabel('NIF').waitFor();
await page.getByLabel('Nome').fill('Embalagens Reunião E2E, Lda');
await page.getByLabel('NIF').fill('503456780');
let refreshFailures = 1;
const failRefreshOnce = (route) => (refreshFailures-- > 0 ? route.fulfill({ ...serverError, status: 503 }) : route.continue());
await page.route('**/api/v1/auth/refresh', failRefreshOnce);
const errorsBeforeSwitchFailure = { http: httpErrors.length, console: consoleErrors.length };
await page.getByRole('button', { name: /Guardar Diagnóstico/ }).click();
const savedNotOpened = page.getByTestId('saved-not-opened');
await savedNotOpened.waitFor();
expectEq('troca falhada: diz que ficou guardado', (await savedNotOpened.innerText()).includes('O diagnóstico ficou guardado. Falta abrir o plano.'), true);
expectEq('troca falhada: não diz que não foi guardado', (await page.locator('main').innerText()).includes('não foi guardado'), false);
await page.unroute('**/api/v1/auth/refresh', failRefreshOnce);
// O 503 foi forçado pelo teste.
httpErrors.splice(errorsBeforeSwitchFailure.http);
consoleErrors.splice(errorsBeforeSwitchFailure.console);
await savedNotOpened.getByRole('button', { name: 'Abrir o plano' }).click();
await page.waitForURL(/\/plano\/[0-9a-f-]{36}$/);
await page.getByRole('heading', { name: 'Embalagens Reunião E2E, Lda' }).waitFor();
await settle();
const reopenedId = page.url().split('/').pop();
const sameCompanyAssessments = await (await page.request.get(`${BASE}/api/v1/assessments`, { headers: { Authorization: `Bearer ${(await storedSession()).accessToken}` } })).json();
// Só os desta corrida: a empresa pode ter diagnósticos de corridas anteriores.
expectEq('troca falhada: ficou um só diagnóstico', sameCompanyAssessments.filter((entry) => Date.now() - new Date(entry.createdAt).getTime() < 60_000).length, 1);
expectEq('troca falhada: «Abrir o plano» abre o que ficou guardado', sameCompanyAssessments[0].id, reopenedId);
await page.getByRole('button', { name: 'Eliminar este diagnóstico' }).click();
await page.getByTestId('delete-assessment-confirmation').getByRole('button', { name: 'Eliminar diagnóstico e tarefas' }).click();
await page.waitForURL((url) => !url.pathname.endsWith(reopenedId));
await settle();

// ── 4. Empresa de demonstração: indicadores ─────────────────────────────────────────
await page.getByLabel('Empresa cliente').selectOption(demoValue);
await page.getByRole('heading', { name: 'Moldes Exemplo, Lda (demonstração)' }).waitFor();
await page.getByTestId('kpi-total').waitFor();
await expectText('KPI carteira exposta', 'kpi-commercial-risk', nb('≈ 2,8 M €'));
await expectText('KPI spread', 'kpi-spread', nb('≈ +10 mil €/ano'));
expectEq('sem múltiplo de «proteção» no ecrã', /protege|proteção \d/.test(await page.locator('main').innerText()), false);
await page.getByText('De onde vêm os números').click();
await page.getByText('Carteira comercial exposta (faturação comercial em risco): faturação nos 3 maiores clientes × peso usado').waitFor();
log('as contas e os pressupostos estão à vista no plano');
await page.getByText('O que é cada requisito').click();
expectEq('matriz: os requisitos estão explicados', /usada no setor automóvel[\s\S]*só abrange parte das empresas/.test(await page.getByTestId('requirement-glossary').innerText()), true);
await expectText('KPI fase 1', 'kpi-phase1', eur('6.300'));
await expectText('KPI total', 'kpi-total', eur('10.100'));
await settle();
await page.screenshot({ path: `${OUT}/02-plano.png`, fullPage: true });
const planUrl = page.url();

// ── 5. Configurador: otimista com o servidor atrasado 2 s ───────────────────────────
const slowPut = async (route) => {
  if (route.request().method() === 'PUT') await new Promise((r) => setTimeout(r, 2000));
  await route.continue();
};
await page.route('**/api/v1/tasks/*', slowPut);
const quickly = (label, testId, text) => expectText(`${label} (servidor ainda sem responder)`, testId, text, 300);
const bankSwitch = page.getByRole('switch', { name: /Incluir «Dossier de Sustentabilidade/ });
const tisaxExecutor = page.getByRole('radiogroup', { name: /Executor de «Auditoria de Segurança/ });
await bankSwitch.click();
await quickly('fase 1 sem banca', 'kpi-phase1', eur('4.500'));
await tisaxExecutor.getByRole('radio', { name: 'Interno' }).click();
await quickly('fase 1 sem banca nem TISAX', 'kpi-phase1', eur('0'));
await expectText('total', 'kpi-total', eur('3.800'));
await settle();
// A matriz de conformidade diz o mesmo que o configurador, e não a solução-tipo do diagnóstico.
const gapRow = (code) => page.getByTestId(`gap-${code}`).innerText();
expectEq('matriz: entregável desligado aparece fora da proposta', /Fora da proposta/.test(await gapRow('banking_esg')), true);
expectEq('matriz: entregável passado a interno', /Interno/.test(await gapRow('information_security')) && !/4\.500/.test(await gapRow('information_security')), true);
await page.unroute('**/api/v1/tasks/*', slowPut);
await page.reload();
await page.getByTestId('kpi-total').waitFor();
await settle();
await expectText('total depois de recarregar (persistido)', 'kpi-total', eur('3.800'));
await page.screenshot({ path: `${OUT}/03-configurador-alterado.png`, fullPage: true });

// ── 6. Falha do servidor: a alteração é revertida e pode repetir-se ─────────────────
const failPut = (route) => (route.request().method() === 'PUT' ? route.fulfill(serverError) : route.continue());
await page.route('**/api/v1/tasks/*', failPut);
await bankSwitch.click();
await page.getByText('A alteração não foi guardada e foi revertida.').waitFor();
await expectText('total revertido depois da falha', 'kpi-total', eur('3.800'));
await page.unroute('**/api/v1/tasks/*', failPut);
await page.getByRole('button', { name: 'Tentar novamente' }).click();
await expectText('tentar novamente aplica a alteração', 'kpi-total', eur('5.600'));
await tisaxExecutor.getByRole('radio', { name: 'Parceiro' }).click();
await settle();
await expectText('total reposto', 'kpi-total', eur('10.100'));

// ── 6b. Exportar com uma alteração ainda por gravar: o resumo espera e sai com o que ficou ──
await page.evaluate(() => {
  window.__printed = [];
  window.print = () => window.__printed.push(document.querySelector('[data-testid="executive-print-view"]').innerText);
});
const slowFailingPut = async (route) => {
  if (route.request().method() !== 'PUT') return route.continue();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return route.fulfill(serverError);
};
await page.route('**/api/v1/tasks/*', slowFailingPut);
const errorsBeforeSlowPut = { http: httpErrors.length, console: consoleErrors.length };
await bankSwitch.click();
await expectText('otimista antes de exportar', 'kpi-total', eur('8.300'));
await page.getByTestId('export-summary').click();
expectEq('exportar: espera pelas alterações por gravar', await page.getByTestId('export-summary').innerText(), 'A gravar alterações…');
expectEq('exportar: ainda não imprimiu', await page.evaluate(() => window.__printed.length), 0);
await page.waitForFunction(() => window.__printed.length === 1, null, { timeout: 8000 });
const printedAfterFailure = await page.evaluate(() => window.__printed[0]);
// A alteração falhou e foi desfeita: o resumo leva os 10.100 € que estão gravados, e não os 8.300 € do ecrã otimista.
expectEq('exportar: o resumo sai com o que está gravado', printedAfterFailure.includes(eur('10.100')) && !printedAfterFailure.includes(eur('8.300')), true);
await page.unroute('**/api/v1/tasks/*', slowFailingPut);
httpErrors.splice(errorsBeforeSlowPut.http);
consoleErrors.splice(errorsBeforeSlowPut.console);
await page.getByText('A alteração não foi guardada e foi revertida.').waitFor();
await page.getByRole('button', { name: 'Fechar', exact: true }).click();
await settle();
await expectText('total depois da exportação', 'kpi-total', eur('10.100'));

// ── 7. Painel lateral ───────────────────────────────────────────────────────────────
await page.getByRole('button', { name: /Editar «Auditoria de Emissões/ }).click();
await page.getByRole('dialog').waitFor();
await page.waitForTimeout(350);
await page.screenshot({ path: `${OUT}/04-sheet.png` });
await page.getByLabel('Honorários fixos').fill('3600');
await page.getByRole('button', { name: 'Guardar alterações' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
await expectText('total com Âmbito 3 a 3.600', 'kpi-total', eur('9.900'));
expectEq('matriz: honorários renegociados', (await page.getByTestId('gap-carbon_scope_3').innerText()).includes(eur('3.600')), true);
await page.getByRole('button', { name: /Editar «Auditoria de Emissões/ }).click();
await page.getByLabel('Honorários fixos').fill('3800');
await page.getByRole('button', { name: 'Guardar alterações' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });

// Tarefa extra: criar, ver no orçamento, eliminar
await page.getByRole('button', { name: 'Nova tarefa' }).click();
await page.getByLabel('Título').fill('Formação da equipa de compras (teste)');
await page.getByLabel('Honorários fixos').fill('900');
await page.getByRole('button', { name: 'Criar tarefa' }).click();
// Um entregável da P4S incluído na proposta tem prazo fechado: sem prazo não se cria.
await page.getByRole('dialog').getByText('Indique o prazo.').waitFor();
await page.getByRole('dialog').getByLabel('Prazo', { exact: true }).fill('2027-01-15');
await page.getByRole('button', { name: 'Criar tarefa' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
await expectText('tarefa extra criada', 'kpi-total', eur('11.000'));
await page.getByRole('button', { name: /Editar «Formação da equipa/ }).click();
await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
await page.getByRole('button', { name: 'Confirmar eliminação' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
await expectText('tarefa extra eliminada', 'kpi-total', eur('10.100'));

// Fechar o painel com alterações por guardar pede confirmação, em vez de as perder em silêncio.
await page.getByRole('button', { name: /Editar «Auditoria de Emissões/ }).click();
await page.getByRole('dialog').getByLabel('Honorários fixos').fill('1234');
await page.keyboard.press('Escape');
await page.getByText('Tem alterações por guardar.').waitFor();
await page.getByRole('button', { name: 'Descartar alterações' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
await expectText('alteração descartada não chega ao total', 'kpi-total', eur('10.100'));

// Eliminar um entregável do diagnóstico não esconde a lacuna, e a P4S consegue repô-lo.
const criticalText = () => page.getByTestId('kpi-phase1').locator('xpath=..').innerText();
expectEq('lacunas críticas antes de eliminar', /1 lacuna crítica em aberto/.test(await criticalText()), true);
await page.getByRole('button', { name: /Editar «Auditoria de Segurança/ }).click();
await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
await page.getByRole('button', { name: 'Confirmar eliminação' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
await expectText('entregável eliminado', 'kpi-total', eur('5.600'));
expectEq('matriz: lacuna sem entregável no plano', /Sem entregável no plano/.test(await page.getByTestId('gap-information_security').innerText()), true);
expectEq('a lacuna crítica continua em aberto', /1 lacuna crítica em aberto/.test(await criticalText()), true);
await page.getByTestId('gap-information_security').getByRole('button', { name: 'Repor' }).click();
await expectText('entregável reposto com os termos do diagnóstico', 'kpi-total', eur('10.100'));
await settle();
expectEq('andamento do plano à vista', /0 de 3 tarefas concluídas/.test(await page.getByTestId('plan-progress').innerText()), true);

// ── 8. Filtros e kanban ─────────────────────────────────────────────────────────────
await page.getByLabel('Executor', { exact: true }).selectOption('partner');
await page.getByText('1/3 tarefas').waitFor();
await expectText('filtros não mexem nos totais', 'kpi-total', eur('10.100'));
await page.getByLabel('Prioridade', { exact: true }).selectOption('low');
await page.getByText('Nenhuma tarefa corresponde aos filtros').waitFor();
await page.getByRole('button', { name: 'Limpar filtros' }).click();
await page.getByText('3/3 tarefas').waitFor();
await page.getByRole('tab', { name: /Acompanhamento de execução/ }).click();
await page.getByLabel(/Mover «Dossier de Sustentabilidade/).selectOption('in_progress');
await page.getByRole('region', { name: 'Em Curso' }).getByText('Dossier de Sustentabilidade').waitFor();
await settle();
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${OUT}/05-kanban.png`, fullPage: true });
await page.getByLabel(/Mover «Dossier de Sustentabilidade/).selectOption('backlog');
await settle();
await page.getByRole('tab', { name: /Configurador/ }).click();

// ── 9. Impressão: uma página A4 só com o resumo ─────────────────────────────────────
await page.emulateMedia({ media: 'print' });
expectEq('navegação visível na impressão', await page.getByRole('navigation', { name: 'Principal' }).isVisible(), false);
expectEq('resumo executivo visível na impressão', await page.getByTestId('executive-print-view').isVisible(), true);
const printed = await page.getByTestId('executive-print-view').innerText();
expectEq('resumo: explica como ler os números', printed.includes('Como ler estes números'), true);
expectEq('resumo: NIS2 só se a empresa estiver abrangida', printed.includes('NIS2 (se a empresa estiver abrangida)'), true);
expectEq('resumo: fases com a janela de dias', printed.includes('Fase 1 · Desbloqueio imediato (0–60 dias)'), true);
expectEq('resumo: sem múltiplo de «proteção»', /proteção \d|protege/.test(printed), false);
// A validade vem da data de emissão guardada no servidor, igual à que o plano mostra no ecrã.
const validUntil = (await page.getByTestId('proposal-dates').textContent()).match(/\d{2}\/\d{2}\/\d{4}/)?.[0];
expectEq('resumo: validade igual à do plano', (await page.getByTestId('proposal-validity').innerText()).includes(`válida por 30 dias (até ${validUntil})`), true);
expectEq('resumo: diz de quando contam os prazos', printed.includes('Prazos calculados para adjudicação na data de emissão'), true);
expectEq('resumo: remetente lido do requisito, não da descrição', /Exigido por:/.test(printed), false);
expectEq('resumo: dados de partida do cálculo', /6\.500\.000\s€/.test(await page.getByTestId('print-inputs').innerText()) && /58%/.test(await page.getByTestId('print-inputs').innerText()), true);
expectEq('resumo: lacunas com a resposta atual do plano', /resposta no plano/i.test(printed), true);
const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
expectEq('páginas do PDF', (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length, 1);
writeFileSync(`${OUT}/resumo-executivo.pdf`, pdf);
await page.emulateMedia({ media: 'screen' });

// ── 10. Estados: erro, loading e vazio ──────────────────────────────────────────────
const failList = (route) => route.fulfill(serverError);
await page.route('**/api/v1/tasks?**', failList);
await page.goto(planUrl);
await page.getByText('Não foi possível carregar as tarefas.').waitFor();
await expectText('indicadores visíveis mesmo sem a lista de tarefas', 'kpi-total', eur('10.100'));
await page.screenshot({ path: `${OUT}/07-erro-tarefas.png`, fullPage: true });
await page.unroute('**/api/v1/tasks?**', failList);
await page.getByRole('button', { name: 'Tentar novamente' }).click();
await page.getByRole('switch', { name: /Incluir «Dossier/ }).waitFor();
log('erro → tentar novamente recupera');

const slowDetail = async (route) => {
  await new Promise((r) => setTimeout(r, 1500));
  await route.fallback();
};
await page.route('**/api/v1/assessments/*', slowDetail);
await page.goto(planUrl);
await page.getByLabel('A carregar plano de ação').waitFor();
await page.screenshot({ path: `${OUT}/08-loading.png`, fullPage: true });
await page.getByTestId('kpi-total').waitFor();
await page.unroute('**/api/v1/assessments/*', slowDetail);

const emptyList = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
await page.route('**/api/v1/assessments', emptyList);
await page.goto(BASE + '/plano');
await page.getByText('Ainda não há diagnósticos para esta empresa').waitFor();
await page.getByRole('link', { name: 'Iniciar Primeiro Stress Test' }).waitFor();
await page.screenshot({ path: `${OUT}/09-vazio.png` });
await page.unroute('**/api/v1/assessments', emptyList);

// Um diagnóstico que a versão atual não consegue abrir e um erro inesperado no ecrã têm saída.
// Os erros deste bloco são provocados de propósito: ficam fora da contagem final.
const forcedFrom = { http: httpErrors.length, console: consoleErrors.length };
const notOpenable = (route) =>
  route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'ASSESSMENT_NOT_OPENABLE', message: 'Este diagnóstico foi gravado por uma versão anterior e não pode ser aberto.' } }),
  });
await page.route('**/api/v1/assessments/*', notOpenable);
await page.goto(planUrl);
await page.getByText('Este diagnóstico não se consegue abrir').waitFor();
await page.unroute('**/api/v1/assessments/*', notOpenable);
const brokenDetail = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"x"}' });
await page.route('**/api/v1/assessments/*', brokenDetail);
await page.goto(planUrl);
await page.getByText('Este ecrã não conseguiu abrir.').waitFor();
expectEq('erro inesperado: a moldura da aplicação mantém-se', await page.getByRole('navigation', { name: 'Principal' }).isVisible(), true);
await page.unroute('**/api/v1/assessments/*', brokenDetail);
log('diagnóstico que não abre e erro de ecrã mostram mensagem com saída');
await settle();
httpErrors.splice(forcedFrom.http);
consoleErrors.splice(forcedFrom.console);

// Endereços construídos à mão não saem da aplicação nem a deixam em branco.
await page.goto(`${BASE}/plano/..%2Ftasks`);
await page.waitForURL(/\/plano\/[0-9a-f-]{36}$/);
await page.goto(`${BASE}/entrar?next=/%09/example.com`);
await page.waitForURL(/\/plano\/[0-9a-f-]{36}$/);
await page.getByTestId('kpi-total').waitFor();
log('endereços construídos à mão voltam ao plano');

// ── 10b. Utilizadores: convite, link de uso único e desativação ─────────────────────
await page.goto(BASE + '/utilizadores');
await page.getByRole('heading', { name: /Utilizadores de Moldes Exemplo/ }).waitFor();
const invitedEmail = `e2e.${Date.now()}@moldes-exemplo.test`;
await page.getByRole('button', { name: 'Convidar utilizador' }).first().click();
await page.getByLabel('Nome').fill('Pessoa Convidada E2E');
await page.getByLabel('Email').fill(invitedEmail);
await page.getByRole('button', { name: 'Criar conta e gerar link' }).click();
await page.getByText('Convite criado para Pessoa Convidada E2E').waitFor();
const inviteUrl = await page.getByLabel('Link para definir a palavra-passe').inputValue();
expectEq('convite: token no fragmento do endereço', /\/definir-palavra-passe#token=[\w-]{40,}$/.test(inviteUrl), true);
await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).last().click();
await page.getByRole('dialog').waitFor({ state: 'detached' });

const guestContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-PT' });
const guest = await guestContext.newPage();
await guest.goto(inviteUrl);
await guest.getByRole('heading', { name: 'Bem-vindo, Pessoa Convidada E2E' }).waitFor();
await guest.getByLabel('Nova palavra-passe').fill('Frase comprida de fábrica 2026');
await guest.getByLabel('Repetir a palavra-passe').fill('Frase comprida de fábrica 2026');
await guest.getByRole('button', { name: 'Definir palavra-passe e entrar' }).click();
await guest.waitForURL(/\/plano\/[0-9a-f-]{36}$/);
await guest.getByTestId('kpi-total').waitFor();
expectEq('convidada entra no plano da sua empresa', await guest.getByRole('heading', { level: 1 }).innerText(), 'Moldes Exemplo, Lda (demonstração)');
await guest.goto(inviteUrl);
await guest.reload();
await guest.getByText('Este link já não é válido').waitFor();
log('o link de convite só funciona uma vez');
await guestContext.close();

await page.reload();
const invitedRow = page.getByRole('row', { name: new RegExp(invitedEmail.replaceAll('.', '\\.')) });
await invitedRow.getByText('Ativa', { exact: true }).waitFor();
await invitedRow.getByRole('button', { name: 'Desativar' }).click();
await invitedRow.getByText('Desativada', { exact: true }).waitFor();
log('conta de teste desativada');
await page.goto(planUrl);
await page.getByTestId('kpi-total').waitFor();

// ── 10c. Documentos: levantamento com IA, citações verificadas e evidência no plano ──
// Com E2E_FAKE_AI=on a aplicação está ligada ao servidor fake-ai.mjs (não há chamadas reais).
await page.getByRole('link', { name: 'Documentos' }).click();
await page.getByRole('heading', { name: 'Documentos', exact: true }).waitFor();
if (!FAKE_AI) {
  await page.getByTestId('ai-not-configured').waitFor();
  expectEq('documentos sem chave de IA: não se pode carregar', await page.getByRole('button', { name: 'Escolher ficheiro' }).isDisabled(), true);
  log('documentos: sem ANTHROPIC_API_KEY a análise aparece desligada (percurso com IA simulada não corrido)');
} else {
  // Execuções anteriores contra a mesma base de dados: o mesmo ficheiro não se analisa duas vezes.
  const staffAuth = { Authorization: `Bearer ${(await storedSession()).accessToken}` };
  for (const analysis of (await (await page.request.get(`${BASE}/api/v1/documents`, { headers: staffAuth })).json()).analyses) {
    await page.request.delete(`${BASE}/api/v1/documents/${analysis.id}`, { headers: staffAuth });
  }
  await page.reload();
  await page.getByText('Comece pelo questionário do cliente').waitFor();
  expectEq('documentos: sem confirmar que pode enviar, não carrega', await page.getByRole('button', { name: 'Escolher ficheiro' }).isDisabled(), true);
  await page.getByLabel(/Confirmo que posso enviar/).check();
  await page.getByTestId('document-file-input').setInputFiles(EXAMPLE_QUESTIONNAIRE);
  await page.getByText('A IA está a ler o documento').waitFor();
  log('documentos: o carregamento responde logo e a análise fica em curso');
  await expectText('documentos: levantamento pronto', 'finding-counts', '6 exigências · 6 por rever', 20_000);
  await page.waitForURL(/\/documentos\/[0-9a-f-]{36}$/);
  const findings = page.getByTestId('finding');
  expectEq('documentos: citações encontradas no documento', await page.locator('[data-testid="finding"][data-verified="true"]').count(), 5);
  // A IA (simulada) indicou a página 1; a citação está na página 2, e é isso que o servidor diz.
  expectEq('documentos: a página vem do servidor, não da IA', (await findings.nth(1).innerText()).includes('Citação encontrada no documento, na página 2.'), true);
  const invented = findings.nth(5);
  expectEq('documentos: a citação inventada é assinalada', (await invented.innerText()).includes('não foi encontrada no texto do documento'), true);
  expectEq('documentos: a citação inventada não se pode confirmar', await invented.getByRole('button', { name: 'Confirmar' }).isDisabled(), true);
  await page.getByTestId('unverified-warning').waitFor();
  // Confirmar a EcoVadis e o TISAX, rejeitar o código de conduta e a exigência inventada.
  for (const index of [0, 3]) {
    await findings.nth(index).getByRole('button', { name: 'Confirmar' }).click();
    await findings.nth(index).getByText('Confirmada', { exact: true }).waitFor();
  }
  for (const index of [4, 5]) {
    await findings.nth(index).getByRole('button', { name: 'Rejeitar' }).click();
    await findings.nth(index).getByText('Rejeitada', { exact: true }).waitFor();
  }
  await expectText('documentos: contagens depois da revisão', 'finding-counts', '6 exigências · 2 confirmadas · 2 por rever · 2 rejeitadas');
  // Reclassificar: o âmbito 3 passa para «fora dos requisitos» e volta.
  const scope3 = findings.nth(2).getByLabel('Requisito do stress test');
  await scope3.selectOption('other');
  await findings.nth(2).getByText('Reclassificada pelo consultor.').waitFor();
  await scope3.selectOption('carbon_scope_3');
  await settle();
  expectEq('documentos: reclassificação reposta', await scope3.inputValue(), 'carbon_scope_3');
  await page.screenshot({ path: `${OUT}/13-documentos.png`, fullPage: true });

  // O que foi confirmado aparece no plano, ao lado do requisito, com a citação.
  await page.goto(planUrl);
  await page.getByTestId('kpi-total').waitFor();
  const tisaxEvidence = page.locator('[data-testid="evidence-information_security"]:visible');
  await tisaxEvidence.waitFor();
  expectEq('plano: evidência do TISAX com quem pede e o prazo', (await tisaxEvidence.locator('summary').innerText()).startsWith('Exigido por escrito por Nordwerk Automotive Systems GmbH, até 01/01/2027'), true);
  await tisaxEvidence.locator('summary').click();
  expectEq('plano: a citação vem com a página', /«must hold a valid TISAX label at Assessment Level 2[\s\S]*questionario-fornecedor-exemplo\.pdf, p\. 2/.test(await tisaxEvidence.innerText()), true);
  expectEq('plano: o que ficou por rever não aparece', await page.locator('[data-testid="evidence-carbon_scope_3"]').count(), 0);
  await page.screenshot({ path: `${OUT}/14-plano-com-evidencia.png`, fullPage: true });
  await page.emulateMedia({ media: 'print' });
  const printedEvidence = await page.getByTestId('print-evidence').innerText();
  expectEq('resumo: exigência documentada com citação e fonte', printedEvidence.includes('«must hold a valid TISAX label at Assessment Level 2') && printedEvidence.includes('p. 2; prazo 01/01/2027'), true);
  const pdfWithEvidence = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  expectEq('páginas do PDF com evidência', (pdfWithEvidence.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length, 1);
  await page.emulateMedia({ media: 'screen' });
}
await page.goto(planUrl);
await page.getByTestId('kpi-total').waitFor();

// ── 11. Utilizador da empresa: termos da P4S bloqueados ─────────────────────────────
await logout();
await page.goto(BASE + '/entrar?next=/plano');
await loginAs(COMPANY_EMAIL, COMPANY_PASSWORD);
await page.waitForURL(/\/plano\/[0-9a-f-]{36}$/);
await page.getByTestId('kpi-total').waitFor();
await page.getByText('Pode atualizar o estado e o responsável de cada tarefa').waitFor();
// Para a empresa não há controlos bloqueados: o plano diz o que é, e o que ela pode fazer.
expectEq('empresa: sem interruptores de inclusão', await page.getByRole('switch', { name: /Incluir «/ }).count(), 0);
expectEq('empresa: sem seletor de executor', await page.getByRole('radiogroup', { name: /Executor de «/ }).count(), 0);
expectEq('empresa: sem seletor de empresas', await page.getByLabel('Empresa cliente').count(), 0);
expectEq('empresa: sem «Novo diagnóstico»', await page.getByRole('link', { name: 'Novo diagnóstico' }).count(), 0);
expectEq('empresa: não elimina diagnósticos', await page.getByRole('button', { name: 'Eliminar este diagnóstico' }).count(), 0);
expectEq('empresa: não edita os dados da empresa', await page.getByRole('button', { name: 'Editar dados da empresa' }).count(), 0);
// A análise de documentos é uma ferramenta da equipa P4S. A empresa vê só o que foi confirmado, no plano.
expectEq('empresa: sem ecrã de documentos', await page.getByRole('link', { name: 'Documentos' }).count(), 0);
const companyToken = (await storedSession()).accessToken;
expectEq('empresa: a API não lhe mostra os documentos', await apiStatus('/documents', companyToken), 403);
expectEq('empresa: a API mostra-lhe a evidência confirmada', await apiStatus('/documents/evidence', companyToken), 200);
if (FAKE_AI) {
  await page.locator('[data-testid="evidence-information_security"]:visible').waitFor();
  log('empresa: vê no plano a exigência confirmada pelo consultor');
}
// As contas mostram à empresa o resultado e o peso usado, mas não o peso de cada lacuna, que é do catálogo.
await page.getByText('De onde vêm os números').click();
const companyAssumptions = await page.locator('details', { hasText: 'De onde vêm os números' }).innerText();
expectEq('empresa: as contas não mostram o peso de cada lacuna', /Sem (EcoVadis|Pegada|Segurança)/.test(companyAssumptions), false);
expectEq('empresa: as contas mostram o peso usado e o resultado', companyAssumptions.includes('Peso usado (parte dessa faturação considerada em risco)') && companyAssumptions.includes('Carteira comercial exposta'), true);
const companyDetail = await page.request.get(`${BASE}/api/v1/assessments/${page.url().split('/').pop()}`, { headers: { Authorization: `Bearer ${(await storedSession()).accessToken}` } });
const companySnapshot = (await companyDetail.json()).snapshot;
expectEq('empresa: a API não lhe entrega pesos nem preços de catálogo', companySnapshot.commercialGapPoints === null && companySnapshot.requirements.every((r) => r.weightPoints === null && r.solution.estimatedCost === null && r.solution.deadlineDays === null), true);
await page.getByLabel(/Estado de «Dossier de Sustentabilidade/).selectOption('review');
await settle();
expectEq('empresa: pode mudar o estado', await page.getByLabel(/Estado de «Dossier de Sustentabilidade/).inputValue(), 'review');
await page.getByLabel(/Estado de «Dossier de Sustentabilidade/).selectOption('backlog');
await settle();
await page.getByRole('button', { name: /Editar «Auditoria de Emissões/ }).click();
await page.getByRole('dialog').waitFor();
expectEq('empresa: honorários bloqueados no painel', await page.getByLabel('Honorários fixos').isDisabled(), true);
// O âmbito e o prazo de um entregável são da P4S: a empresa acompanha (estado e responsável).
const sheet = page.getByRole('dialog');
await sheet.getByText('Esta tarefa foi definida pela P4S.').waitFor();
expectEq('empresa: título bloqueado', await sheet.getByLabel('Título').isDisabled(), true);
expectEq('empresa: prazo bloqueado', await sheet.getByLabel('Prazo', { exact: true }).isDisabled(), true);
expectEq('empresa: descrição bloqueada', await sheet.getByLabel('Descrição').isDisabled(), true);
expectEq('empresa: estado e responsável editáveis', (await sheet.getByLabel('Estado', { exact: true }).isEnabled()) && (await sheet.getByLabel('Responsável').isEnabled()), true);
expectEq('empresa: responsáveis sem emails', /@/.test(await sheet.getByLabel('Responsável').innerText()), false);
expectEq('empresa: sem botão de eliminar', await page.getByRole('button', { name: 'Eliminar', exact: true }).count(), 0);
await page.waitForTimeout(350);
await page.screenshot({ path: `${OUT}/10-empresa-sheet.png` });
await page.keyboard.press('Escape');
await page.getByRole('dialog').waitFor({ state: 'detached' });

// ── 12. Telemóvel (390 px): sem scroll horizontal, medido com o conteúdo carregado ──
await page.setViewportSize({ width: 390, height: 844 });
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await page.getByTestId('kpi-total').waitFor();
expectEq('telemóvel, plano: scroll horizontal (px)', await overflow(), 0);
// No telemóvel a matriz é uma lista: prazo e honorários leem-se sem deslizar para o lado.
const phoneGap = page.getByTestId('gap-card-banking_esg');
await phoneGap.scrollIntoViewIfNeeded();
expectEq('telemóvel, matriz: prazo e honorários à vista', /Prazo \d{2}\/\d{2}\/\d{4}[\s\S]*Honorários/.test(await phoneGap.innerText()), true);
expectEq('telemóvel, matriz: a linha cabe no ecrã', await phoneGap.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth && el.scrollWidth <= el.clientWidth), true);
expectEq('telemóvel, matriz: a tabela larga não aparece', await page.getByTestId('gap-banking_esg').isVisible(), false);
await page.screenshot({ path: `${OUT}/11-telemovel-plano.png`, fullPage: true });
await page.goto(BASE + '/');
await page.getByTestId('preview-revenue-at-risk').waitFor();
await page.getByText('O que falta').waitFor();
expectEq('telemóvel, stress test: scroll horizontal (px)', await overflow(), 0);
await page.screenshot({ path: `${OUT}/12-telemovel-wizard.png`, fullPage: true });

// Os 500 são forçados pelos testes de erro. Qualquer outro 4xx/5xx é falha.
const unexpectedHttp = httpErrors.filter((entry) => !entry.startsWith('500 '));
if (unexpectedHttp.length) fail(`respostas de erro inesperadas:\n${unexpectedHttp.join('\n')}`);
else log(`sem respostas de erro inesperadas (${httpErrors.length} forçadas pelo teste)`);
const unexpected = consoleErrors.filter((text) => !text.includes('status of 500'));
if (unexpected.length) fail(`erros na consola:\n${unexpected.join('\n')}`);
else log('sem erros inesperados na consola');

await browser.close();
console.log(failures === 0 ? '\nTUDO OK' : `\n${failures} FALHA(S)`);
process.exitCode = failures === 0 ? 0 : 1;
