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
      fail(`pedidos sem resposta ao fim de 10 s: ${[...inFlight].map((r) => `${r.method()} ${new URL(r.url()).pathname}`).join(', ')}`);
      inFlight.clear();
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
expectEq('sem sessão: a página não mostra pesos', /na exposição|bps/.test(publicText), false);
expectEq('sem sessão: o catálogo não é servido', (await page.request.get(`${BASE}/api/v1/catalog`)).status(), 401);
await page.screenshot({ path: `${OUT}/01-wizard-anonimo.png`, fullPage: true });

// ── 2. Entrar como empresa: a simulação mantém-se, sempre por escalões e sem gravar ──
await page.getByRole('link', { name: /Entrar para guardar/ }).click();
await loginAs(COMPANY_EMAIL, COMPANY_PASSWORD);
await page.waitForURL(/\/$/);
await page.getByText('Simulação para Moldes Exemplo, Lda (demonstração)').waitFor();
// A conta de uma empresa vê o mesmo que um visitante: os pesos e os preços são da equipa P4S.
await expectText('empresa: a simulação mantém-se, por escalões', 'preview-revenue-at-risk', `${nb('3,6 M €')} a ${nb('4,8 M €')}`);
await settle();
const companySession = await storedSession();
expectEq('empresa: o catálogo não é servido', await apiStatus('/catalog', companySession.accessToken), 403);
expectEq('empresa: a página não mostra pesos', /na exposição|bps/.test(await page.locator('body').innerText()), false);
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
await page.getByLabel('NIF').fill('503456780');
await page.getByRole('radio', { name: 'Embalagem agroalimentar' }).click();
await page.getByRole('button', { name: '2M €' }).first().click();
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

// ── 4. Empresa de demonstração: indicadores ─────────────────────────────────────────
await page.getByLabel('Empresa cliente').selectOption(demoValue);
await page.getByRole('heading', { name: 'Moldes Exemplo, Lda (demonstração)' }).waitFor();
await page.getByTestId('kpi-total').waitFor();
await expectText('KPI carteira exposta', 'kpi-commercial-risk', nb('≈ 2,8 M €'));
await expectText('KPI spread', 'kpi-spread', nb('≈ +10 mil €/ano'));
expectEq('sem múltiplo de «proteção» no ecrã', /protege|proteção \d/.test(await page.locator('main').innerText()), false);
await page.getByText('De onde vêm os números').click();
await page.getByText('Faturação comercial em risco: base exposta × peso usado').waitFor();
log('as contas e os pressupostos estão à vista no plano');
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
