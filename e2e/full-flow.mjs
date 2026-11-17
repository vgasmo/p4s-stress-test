// Percurso ponta a ponta no browser: simulação anónima, login, criação rápida de empresa,
// plano, configurador (otimista + reversão), painel lateral, kanban, impressão, estados
// de erro/loading/vazio, permissões da empresa e telemóvel.
//
// Precisa da app a correr e da base de dados com o seed de demonstração (SEED_DEMO=true).
// Uso (ver README):
//   E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… E2E_COMPANY_PASSWORD=… node full-flow.mjs [pasta-de-capturas]
// Opcionais: E2E_BASE_URL (http://localhost:5173), E2E_COMPANY_EMAIL, E2E_SCALE (1).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
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

const OUT = process.argv[2] ?? 'capturas';
const SCALE = Number(process.env.E2E_SCALE ?? 1);
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });

const nbsp = ' ';
const eur = (text) => `${text}${nbsp}€`;
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
let pending = 0;
const httpErrors = [];
const isApi = (request) => request.url().includes('/api/');
page.on('request', (request) => isApi(request) && pending++);
page.on('requestfinished', (request) => isApi(request) && pending--);
page.on('requestfailed', (request) => isApi(request) && pending--);
page.on('response', (response) => {
  if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
});

const kpi = (id) => page.getByTestId(id).innerText();
/** Espera que não haja pedidos à API em curso durante 150 ms seguidos. */
const settle = async () => {
  for (let quiet = 0; quiet < 3; ) {
    await page.waitForTimeout(50);
    quiet = pending === 0 ? quiet + 1 : 0;
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
const logout = () => page.getByRole('button', { name: /Terminar sessão/ }).click();
const serverError = { status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente.' } }) };

// ── 1. Simulação anónima ────────────────────────────────────────────────────────────
await page.goto(BASE + '/');
await page.getByRole('radio', { name: 'Moldes e componentes automóvel' }).click();
await page.getByRole('button', { name: '10M €' }).first().click();
await page.getByRole('switch', { name: /EcoVadis/ }).click();
await page.getByRole('switch', { name: /âmbitos 1 e 2/ }).click();
// 10M × 60% = 6M; falta âmbito 3 (30) + TISAX (35) = 65 → piso 75 → 4.500.000 €
await expectText('preview automóvel com piso', 'preview-revenue-at-risk', eur('4.500.000'));
await page.getByText('Bloqueio setorial').waitFor();
await page.getByRole('switch', { name: /Refinanciamento bancário/ }).click();
await page.getByText('+8.000').waitFor();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/01-wizard-anonimo.png`, fullPage: true });

// ── 2. Entrar como empresa: a simulação feita antes mantém-se ───────────────────────
await page.getByRole('link', { name: /Entrar para guardar/ }).click();
await loginAs(COMPANY_EMAIL, COMPANY_PASSWORD);
await page.waitForURL(/\/$/);
await page.getByText('Moldes Exemplo, Lda (demonstração)').first().waitFor();
await expectText('simulação mantida depois de entrar (empresa)', 'preview-revenue-at-risk', eur('4.500.000'));
await logout();
await page.getByText('Modo reunião').waitFor();
await expectText('rascunho limpo ao sair (não mostra dados do cliente)', 'preview-revenue-at-risk', eur('3.000.000'));

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
await expectText('P4S → «sem empresa» volta ao stress test com rascunho limpo', 'preview-revenue-at-risk', eur('3.000.000'));

// ── 3b. Criação rápida de empresa por NIF + nome e gravação ─────────────────────────
await page.getByLabel('Nome').fill('Embalagens Reunião E2E, Lda');
await page.getByRole('button', { name: /Guardar Diagnóstico/ }).click();
await page.getByText('NIF inválido').waitFor();
log('validação: NIF em falta bloqueia a gravação');
await page.getByLabel('NIF').fill('503456782'); // dígito de controlo errado
await page.getByText('NIF inválido').waitFor();
await page.getByLabel('NIF').fill('503456780');
await page.getByRole('radio', { name: 'Embalagem agroalimentar' }).click();
await page.getByRole('button', { name: '2M €' }).first().click();
await page.getByRole('switch', { name: /âmbitos 1 e 2/ }).click();
await page.getByRole('switch', { name: /Segurança da informação/ }).click();
// 2M × 60% = 1,2M; EcoVadis 45 + âmbito 3 20 = 65 (piso agro 65) → 780.000 €
await expectText('preview agro', 'preview-revenue-at-risk', eur('780.000'));
await page.getByRole('button', { name: /Guardar Diagnóstico/ }).click();
await page.waitForURL(/\/plano\/[0-9a-f-]{36}$/);
await page.getByTestId('kpi-total').waitFor();
await expectText('plano gravado: carteira exposta', 'kpi-commercial-risk', eur('780.000'));
await expectText('plano gravado: total', 'kpi-total', eur('7.300')); // EcoVadis 3.500 + âmbito 3 3.800
await page.getByRole('heading', { name: 'Embalagens Reunião E2E, Lda' }).waitFor();
log('sessão passou para a empresa criada');

// ── 4. Empresa de demonstração: indicadores ─────────────────────────────────────────
await page.getByLabel('Empresa cliente').selectOption(demoValue);
await page.getByRole('heading', { name: 'Moldes Exemplo, Lda (demonstração)' }).waitFor();
await page.getByTestId('kpi-total').waitFor();
await expectText('KPI carteira exposta', 'kpi-commercial-risk', eur('2.827.500'));
await expectText('KPI spread', 'kpi-spread', `+10.000${nbsp}€/ano`);
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

// ── 7. Painel lateral ───────────────────────────────────────────────────────────────
await page.getByRole('button', { name: /Editar «Auditoria de Emissões/ }).click();
await page.getByRole('dialog').waitFor();
await page.waitForTimeout(350);
await page.screenshot({ path: `${OUT}/04-sheet.png` });
await page.getByLabel('Honorários fixos').fill('3600');
await page.getByRole('button', { name: 'Guardar alterações' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
await expectText('total com Âmbito 3 a 3.600', 'kpi-total', eur('9.900'));
await page.getByRole('button', { name: /Editar «Auditoria de Emissões/ }).click();
await page.getByLabel('Honorários fixos').fill('3800');
await page.getByRole('button', { name: 'Guardar alterações' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });

// Tarefa extra: criar, ver no orçamento, eliminar
await page.getByRole('button', { name: 'Nova tarefa' }).click();
await page.getByLabel('Título').fill('Formação da equipa de compras (teste)');
await page.getByLabel('Honorários fixos').fill('900');
await page.getByRole('button', { name: 'Criar tarefa' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
await expectText('tarefa extra criada', 'kpi-total', eur('11.000'));
await page.getByRole('button', { name: /Editar «Formação da equipa/ }).click();
await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
await page.getByRole('button', { name: 'Confirmar eliminação' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
await expectText('tarefa extra eliminada', 'kpi-total', eur('10.100'));

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

// ── 11. Utilizador da empresa: termos da P4S bloqueados ─────────────────────────────
await logout();
await page.goto(BASE + '/entrar?next=/plano');
await loginAs(COMPANY_EMAIL, COMPANY_PASSWORD);
await page.waitForURL(/\/plano\/[0-9a-f-]{36}$/);
await page.getByRole('switch', { name: /Incluir «Dossier/ }).waitFor();
expectEq('empresa: inclusão bloqueada', await page.getByRole('switch', { name: /Incluir «Dossier/ }).isDisabled(), true);
expectEq('empresa: executor bloqueado', await tisaxExecutor.getByRole('radio', { name: 'Interno' }).isDisabled(), true);
expectEq('empresa: sem seletor de empresas', await page.getByLabel('Empresa cliente').count(), 0);
await page.getByLabel(/Estado de «Dossier de Sustentabilidade/).selectOption('review');
await settle();
expectEq('empresa: pode mudar o estado', await page.getByLabel(/Estado de «Dossier de Sustentabilidade/).inputValue(), 'review');
await page.getByLabel(/Estado de «Dossier de Sustentabilidade/).selectOption('backlog');
await settle();
await page.getByRole('button', { name: /Editar «Auditoria de Emissões/ }).click();
await page.getByRole('dialog').waitFor();
expectEq('empresa: honorários bloqueados no painel', await page.getByLabel('Honorários fixos').isDisabled(), true);
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
await page.screenshot({ path: `${OUT}/11-telemovel-plano.png`, fullPage: true });
await page.goto(BASE + '/');
await page.getByTestId('preview-revenue-at-risk').waitFor();
await page.getByText('Plano sugerido').waitFor();
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
