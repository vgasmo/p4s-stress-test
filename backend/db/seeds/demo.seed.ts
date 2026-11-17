// Seed: administrador P4S e, com SEED_DEMO=true, uma PME de moldes da região de Leiria
// com um diagnóstico completo para demonstração. Dados fictícios.
// Idempotente: não duplica o que já existe. Uso: npm run db:seed

import { randomBytes } from 'node:crypto';
import { pool } from '../../src/config/database.js';
import { companyModel } from '../../src/models/company.model.js';
import type { User } from '../../src/models/domain.js';
import { userModel } from '../../src/models/user.model.js';
import { assessmentService } from '../../src/services/assessment.service.js';
import { hashPassword } from '../../src/services/auth.service.js';
import { formatEUR } from '../../src/utils/currency.js';

/** NIF com dígito de controlo válido a partir de 8 dígitos. */
function nifFrom(prefix: string): string {
  const sum = [...prefix].reduce((acc, digit, index) => acc + Number(digit) * (9 - index), 0) % 11;
  return `${prefix}${sum < 2 ? 0 : 11 - sum}`;
}

const generatedPassword = () => randomBytes(12).toString('base64url');

async function ensureUser(
  email: string,
  fullName: string,
  role: User['role'],
  companyId: string | null,
  password: string | undefined,
): Promise<User> {
  const existing = await userModel.findByEmail(pool, email);
  if (existing) {
    console.log(`= ${email} já existe`);
    return existing;
  }
  const plain = password || generatedPassword();
  const user = await userModel.insert(pool, { email, fullName, role, companyId, passwordHash: await hashPassword(plain) });
  console.log(`+ ${role} ${email}${password ? '' : `  (palavra-passe gerada: ${plain})`}`);
  return user;
}

async function main(): Promise<void> {
  const admin = await ensureUser(
    process.env.SEED_ADMIN_EMAIL ?? 'admin@plan4sustain.pt',
    process.env.SEED_ADMIN_NAME ?? 'Administrador P4S',
    'admin',
    null,
    process.env.SEED_ADMIN_PASSWORD,
  );

  if (process.env.SEED_DEMO !== 'true') return;

  const nif = nifFrom('51874230');
  let company = await companyModel.findByNif(pool, nif);
  if (company) {
    console.log(`= empresa de demonstração já existe (NIF ${nif})`);
  } else {
    company = await companyModel.insert(pool, {
      name: 'Moldes Exemplo, Lda (demonstração)',
      nif,
      cae: '25734', // fabricação de moldes metálicos
      sectorProfile: 'automotive_molds',
      annualRevenue: 6_500_000,
      exportPercentage: 70,
    });
    console.log(`+ empresa ${company.name}, NIF ${nif}`);
  }

  await ensureUser(
    'gestao@moldes-exemplo.test',
    'Direção Industrial (demo)',
    'company_user',
    company.id,
    process.env.SEED_DEMO_PASSWORD,
  );

  const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM assessments WHERE company_id = $1', [
    company.id,
  ]);
  if (Number(rows[0]?.n) > 0) {
    console.log('= diagnóstico de demonstração já existe');
    return;
  }

  // Fornecedor tier-2 automóvel: já tem EcoVadis e pegada 1-2 (pedidos pelo cliente principal),
  // falta âmbito 3 e TISAX, e tem 2,5M € de crédito a renovar sem rácios ESG.
  const detail = await assessmentService.create(
    { userId: admin.id, companyId: company.id, role: 'admin' },
    {
      topClientsShare: 58,
      creditLineToRefinance: 2_500_000,
      ecovadis: true,
      carbonFootprintScope12: true,
      carbonFootprintScope3: false,
      bankingEsgMetrics: false,
      tisaxOrNis2: false,
    },
  );
  console.log(
    `+ diagnóstico: score ${detail.riskScore}, faturação comercial em risco ${formatEUR(detail.commercialRevenueAtRisk)}, ` +
      `penalização bancária ${formatEUR(detail.estimatedSpreadPenalty)}/ano, ${detail.tasks.length} tarefas, ` +
      `investimento ${formatEUR(detail.remediationSummary.totalInvestment)}`,
  );
}

try {
  await main();
} finally {
  await pool.end();
}
