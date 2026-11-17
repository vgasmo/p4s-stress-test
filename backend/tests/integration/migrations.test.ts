// As migrações 004 a 006 correm sobre dados gravados pela versão anterior e deixam-nos coerentes.
//
// Os dados são inseridos como essa versão os gravava: o diagnóstico e as tarefas que ele gera
// na mesma transação (mesma data de criação), com a linha «Exigido por» no fim da descrição,
// e depois editados como o painel de então permitia (título, descrição, executor).

import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from '../../scripts/migrate.js';
import { pool } from '../../src/config/database.js';
import type { AssessmentSnapshot } from '../../src/models/api.types.js';
import { taskModel } from '../../src/models/task.model.js';
import { gapLines } from '../../src/services/plan-coverage.js';

afterAll(async () => {
  await pool.end();
});

/** Aplica as migrações até à indicada (inclusive), sem apagar o que lá está. */
async function migrateUpTo(lastPrefix: string): Promise<string[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'p4s-migrations-'));
  try {
    for (const file of (await readdir(MIGRATIONS_DIR)).filter((name) => name.slice(0, 3) <= lastPrefix)) {
      await cp(path.join(MIGRATIONS_DIR, file), path.join(dir, file));
    }
    return await runMigrations(pool, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function recreateUpTo(lastPrefix: string): Promise<void> {
  const { rows } = await pool.query<{ name: string }>('SELECT current_database() AS name');
  if (!rows[0]?.name.endsWith('_test')) throw new Error('Só em bases de dados terminadas em _test.');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrateUpTo(lastPrefix);
}

const NEW_MIGRATIONS = [
  '004_user_management.sql',
  '005_task_origin_and_proposal_issue.sql',
  '006_one_deliverable_per_requirement.sql',
];

const CATALOG = {
  ecovadis: { title: 'Preparação e Submissão do Dossier EcoVadis', domain: 'ecovadis', phase: 'phase_1_urgent', by: 'Cliente industrial' },
  carbon_scope_1_2: { title: 'Inventário de Emissões GEE (Âmbitos 1 e 2)', domain: 'carbon_footprint', phase: 'phase_1_urgent', by: 'Cliente industrial' },
  carbon_scope_3: { title: 'Auditoria de Emissões da Cadeia de Fornecimento (Âmbito 3)', domain: 'carbon_footprint', phase: 'phase_2_structural', by: 'Cliente industrial' },
  banking_esg: { title: 'Dossier de Sustentabilidade para Indexação de Spread Bancário', domain: 'banking_esg', phase: 'phase_1_urgent', by: 'Banco' },
  information_security: { title: 'Auditoria de Segurança da Informação e Conformidade NIS2/TISAX', domain: 'information_security', phase: 'phase_1_urgent', by: 'Cliente industrial / Diretiva NIS2' },
} as const;
type Code = keyof typeof CATALOG;
const CODES = Object.keys(CATALOG) as Code[];

const scope = (code: Code) => `Âmbito do entregável ${code}.`;
const generatedDescription = (code: Code) => `${scope(code)}\n\nExigido por: ${CATALOG[code].by}.`;

let nifCounter = 500_000_000;
async function insertCompany(name: string): Promise<string> {
  nifCounter += 1;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, nif, cae) VALUES ($1, $2, '25734') RETURNING id`,
    [name, String(nifCounter)],
  );
  return rows[0]?.id as string;
}

/** Um diagnóstico como a versão anterior o gravava: a fotografia com as lacunas e uma tarefa por lacuna, tudo com a mesma data. */
async function insertAssessment(companyId: string, createdAt: string, gaps: readonly Code[]): Promise<string> {
  const requirements = CODES.map((code) => ({
    code,
    label: code,
    status: gaps.includes(code) ? 'gap' : 'compliant',
    channel: code === 'banking_esg' ? 'financial' : 'commercial',
    weightPoints: 30,
    requiredBy: ['industrial_client'],
    requiredByLabel: CATALOG[code].by,
    solution: {
      title: CATALOG[code].title,
      phase: CATALOG[code].phase,
      priority: 'high',
      executorType: 'p4s',
      estimatedCost: 1000,
      deadlineDays: 60,
    },
  }));
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO assessments (company_id, status, sector_profile, raw_responses, completed_at, created_at)
     VALUES ($1, 'completed', 'automotive_molds', $2, $3, $3) RETURNING id`,
    [companyId, JSON.stringify({ engineVersion: '2.0.0', baseDate: createdAt.slice(0, 10), requirements }), createdAt],
  );
  const assessmentId = rows[0]?.id as string;
  for (const code of gaps) {
    await insertTask(companyId, assessmentId, createdAt, {
      title: CATALOG[code].title,
      description: generatedDescription(code),
      domain: CATALOG[code].domain,
      phase: CATALOG[code].phase,
    });
  }
  return assessmentId;
}

interface OldTask {
  title: string;
  description?: string | null;
  domain?: string;
  phase?: string;
  executor?: string;
}

async function insertTask(companyId: string, assessmentId: string, createdAt: string, task: OldTask): Promise<void> {
  await pool.query(
    `INSERT INTO tasks (assessment_id, company_id, title, description, domain, phase, executor_type, estimated_cost, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1000, $8)`,
    [
      assessmentId,
      companyId,
      task.title,
      task.description ?? null,
      task.domain ?? 'ecovadis',
      task.phase ?? 'phase_1_urgent',
      task.executor ?? 'p4s',
      createdAt,
    ],
  );
}

/** Edição feita mais tarde no painel da versão anterior. */
const edit = (assessmentId: string, title: string, changes: string, values: unknown[]) =>
  pool.query(`UPDATE tasks SET ${changes} WHERE assessment_id = $1 AND title = $2`, [assessmentId, title, ...values]);

interface MigratedTask {
  title: string;
  requirement_code: string | null;
  origin: string;
  description: string | null;
}
async function tasksOf(assessmentId: string): Promise<Map<string, MigratedTask>> {
  const { rows } = await pool.query<MigratedTask>(
    'SELECT title, requirement_code, origin, description FROM tasks WHERE assessment_id = $1',
    [assessmentId],
  );
  return new Map(rows.map((row) => [row.title, row]));
}

describe('migrações 004 a 006 sobre dados da versão anterior', () => {
  it('ligam cada entregável gerado à sua lacuna, mesmo depois de editado, e não perdem texto', async () => {
    await recreateUpTo('003');
    const companyId = await insertCompany('Fábrica Antiga, Lda');
    const created = '2026-10-01T09:00:00Z';
    const later = '2026-10-03T15:30:00Z';
    const assessmentId = await insertAssessment(companyId, created, CODES);

    // O que o painel da versão anterior deixava fazer a um entregável gerado.
    await edit(assessmentId, CATALOG.ecovadis.title, 'title = $3', ['Preparação e Submissão do Dossier EcoVadis (inclui formação interna)']);
    await edit(assessmentId, CATALOG.information_security.title, 'description = $3', ['Auditoria TISAX AL2 pelo parceiro, com pré-auditoria em dezembro.']);
    await edit(assessmentId, CATALOG.carbon_scope_3.title, 'description = $3', [
      `${generatedDescription('carbon_scope_3')}\nRecolher dados dos 10 maiores fornecedores.`,
    ]);
    await edit(assessmentId, CATALOG.carbon_scope_1_2.title, 'description = $3', [
      `${generatedDescription('carbon_scope_1_2')} Falar com a Eng.ª Marta (qualidade) antes de dia 5.`,
    ]);
    await edit(assessmentId, CATALOG.banking_esg.title, `executor_type = 'internal'`, []);

    // Tarefas criadas à mão, mais tarde.
    await insertTask(companyId, assessmentId, later, { title: 'Workshop com a direção', description: 'Sessão de trabalho.' });
    await insertTask(companyId, assessmentId, later, { title: 'Recolher faturas de energia', executor: 'internal' });
    // Um entregável repetido para uma segunda unidade, com o título e a descrição copiados.
    await insertTask(companyId, assessmentId, later, {
      title: CATALOG.carbon_scope_1_2.title,
      description: generatedDescription('carbon_scope_1_2'),
      domain: 'carbon_footprint',
    });

    expect(await runMigrations(pool)).toEqual(NEW_MIGRATIONS);

    const { rows } = await pool.query<MigratedTask & { created_with_assessment: boolean }>(
      `SELECT t.title, t.requirement_code, t.origin, t.description, t.created_at = a.created_at AS created_with_assessment
       FROM tasks t JOIN assessments a ON a.id = t.assessment_id ORDER BY t.title, t.created_at`,
    );
    expect(rows).toEqual([
      // Nota acrescentada numa linha a seguir à frase gerada: fica.
      {
        title: CATALOG.carbon_scope_3.title,
        requirement_code: 'carbon_scope_3',
        origin: 'assessment',
        description: `${scope('carbon_scope_3')}\n\nRecolher dados dos 10 maiores fornecedores.`,
        created_with_assessment: true,
      },
      // Descrição reescrita: fica como está.
      {
        title: CATALOG.information_security.title,
        requirement_code: 'information_security',
        origin: 'assessment',
        description: 'Auditoria TISAX AL2 pelo parceiro, com pré-auditoria em dezembro.',
        created_with_assessment: true,
      },
      // Passado a Interno pelo consultor: continua a ser do diagnóstico, e não da empresa.
      {
        title: CATALOG.banking_esg.title,
        requirement_code: 'banking_esg',
        origin: 'assessment',
        description: scope('banking_esg'),
        created_with_assessment: true,
      },
      // Nota escrita na mesma linha da frase gerada: sai só a frase.
      {
        title: CATALOG.carbon_scope_1_2.title,
        requirement_code: 'carbon_scope_1_2',
        origin: 'assessment',
        description: `${scope('carbon_scope_1_2')}\n\nFalar com a Eng.ª Marta (qualidade) antes de dia 5.`,
        created_with_assessment: true,
      },
      // A cópia feita à mão não é o entregável da lacuna: fica como tarefa da P4S, com o texto que tinha.
      {
        title: CATALOG.carbon_scope_1_2.title,
        requirement_code: null,
        origin: 'p4s',
        description: generatedDescription('carbon_scope_1_2'),
        created_with_assessment: false,
      },
      // Título alterado: liga-se pelo domínio.
      {
        title: 'Preparação e Submissão do Dossier EcoVadis (inclui formação interna)',
        requirement_code: 'ecovadis',
        origin: 'assessment',
        description: scope('ecovadis'),
        created_with_assessment: true,
      },
      { title: 'Recolher faturas de energia', requirement_code: null, origin: 'company', description: null, created_with_assessment: false },
      { title: 'Workshop com a direção', requirement_code: null, origin: 'p4s', description: 'Sessão de trabalho.', created_with_assessment: false },
    ]);

    // É isto que a matriz e o resumo impresso leem: nenhuma lacuna fica «sem entregável no plano».
    const snapshot = (await pool.query<{ raw_responses: AssessmentSnapshot }>('SELECT raw_responses FROM assessments')).rows[0]
      ?.raw_responses as AssessmentSnapshot;
    const lines = gapLines(snapshot, await taskModel.list(pool, companyId, { assessmentId }));
    expect(lines).toHaveLength(5);
    expect(lines.filter((line) => line.task === null)).toEqual([]);

    const issued = await pool.query<{ issued: Date }>('SELECT proposal_issued_at AS issued FROM assessments');
    expect(issued.rows[0]?.issued.toISOString()).toBe('2026-10-01T09:00:00.000Z');
  });

  it('com os dois entregáveis de carbono renomeados, distingue-os pela fase, e deixa por ligar o que não consegue distinguir', async () => {
    await recreateUpTo('003');
    const companyId = await insertCompany('Fábrica dos Títulos Alterados, Lda');

    const clear = await insertAssessment(companyId, '2026-09-10T10:00:00Z', ['carbon_scope_1_2', 'carbon_scope_3']);
    await edit(clear, CATALOG.carbon_scope_1_2.title, 'title = $3', ['Inventário de emissões da fábrica de Leiria']);
    await edit(clear, CATALOG.carbon_scope_3.title, 'title = $3', ['Emissões dos fornecedores']);

    // Aqui também a fase foi alterada: as duas ficaram na Fase 1 e já não se sabe qual é qual.
    const ambiguous = await insertAssessment(companyId, '2026-09-20T10:00:00Z', ['carbon_scope_1_2', 'carbon_scope_3']);
    await edit(ambiguous, CATALOG.carbon_scope_1_2.title, `title = $3, executor_type = 'internal'`, ['Carbono A']);
    await edit(ambiguous, CATALOG.carbon_scope_3.title, `title = $3, phase = 'phase_1_urgent'`, ['Carbono B']);

    await runMigrations(pool);

    const linked = await tasksOf(clear);
    expect(linked.get('Inventário de emissões da fábrica de Leiria')).toMatchObject({ requirement_code: 'carbon_scope_1_2', origin: 'assessment' });
    expect(linked.get('Emissões dos fornecedores')).toMatchObject({ requirement_code: 'carbon_scope_3', origin: 'assessment' });

    const unlinked = await tasksOf(ambiguous);
    // Não se adivinha. Mas foram geradas por um diagnóstico: nenhuma passa a ser «da empresa»,
    // nem a que estava a cargo dela, para a empresa não ficar a poder mexer nos termos.
    expect(unlinked.get('Carbono A')).toMatchObject({ requirement_code: null, origin: 'p4s' });
    expect(unlinked.get('Carbono B')).toMatchObject({ requirement_code: null, origin: 'p4s' });
  });

  it('dados carregados sem a data de criação em comum ligam-se pelo título e pela linha «Exigido por»', async () => {
    await recreateUpTo('003');
    const companyId = await insertCompany('Fábrica Importada, Lda');
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO assessments (company_id, status, completed_at, created_at)
       VALUES ($1, 'completed', '2026-10-01T10:00:00Z', '2026-10-01T09:00:00Z') RETURNING id`,
      [companyId],
    );
    const assessmentId = rows[0]?.id as string;
    const at = '2026-10-01T09:00:05Z';
    await insertTask(companyId, assessmentId, at, { title: CATALOG.ecovadis.title, description: generatedDescription('ecovadis') });
    await insertTask(companyId, assessmentId, at, {
      title: CATALOG.information_security.title,
      description: `${scope('information_security')}\n\nExigido por: Cliente industrial / NIS2 (se a empresa estiver abrangida).`,
      executor: 'internal',
    });
    await insertTask(companyId, assessmentId, at, { title: 'Dossier EcoVadis com âmbito alterado à mão', description: 'Texto livre.\n\nExigido por: Cliente industrial.' });
    await insertTask(companyId, assessmentId, at, { title: 'Recolher faturas de energia', executor: 'internal' });

    await runMigrations(pool);

    const tasks = await tasksOf(assessmentId);
    expect(tasks.get(CATALOG.ecovadis.title)).toMatchObject({ requirement_code: 'ecovadis', origin: 'assessment', description: scope('ecovadis') });
    expect(tasks.get(CATALOG.information_security.title)).toMatchObject({
      requirement_code: 'information_security',
      origin: 'assessment',
      description: scope('information_security'),
    });
    expect(tasks.get('Dossier EcoVadis com âmbito alterado à mão')).toMatchObject({
      requirement_code: null,
      origin: 'p4s',
      description: 'Texto livre.\n\nExigido por: Cliente industrial.',
    });
    expect(tasks.get('Recolher faturas de energia')).toMatchObject({ requirement_code: null, origin: 'company' });
    // A emissão da proposta fica na data em que o diagnóstico foi concluído.
    const issued = await pool.query<{ issued: Date }>('SELECT proposal_issued_at AS issued FROM assessments');
    expect(issued.rows[0]?.issued.toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });

  it('se mesmo assim houver dois entregáveis para a mesma lacuna, a 006 fica com o do diagnóstico em vez de falhar a meio', async () => {
    await recreateUpTo('003');
    const companyId = await insertCompany('Fábrica com Dados Ligados à Mão, Lda');
    const assessmentId = await insertAssessment(companyId, '2026-10-01T09:00:00Z', ['ecovadis', 'banking_esg']);
    await insertTask(companyId, assessmentId, '2026-10-05T09:00:00Z', { title: 'Segundo dossier EcoVadis' });
    expect(await migrateUpTo('005')).toEqual(NEW_MIGRATIONS.slice(0, 2));
    // Alguém ligou a segunda tarefa à mesma lacuna, diretamente na base de dados.
    await pool.query(`UPDATE tasks SET requirement_code = 'ecovadis', origin = 'assessment' WHERE title = 'Segundo dossier EcoVadis'`);

    expect(await runMigrations(pool)).toEqual(NEW_MIGRATIONS.slice(2));

    const tasks = await tasksOf(assessmentId);
    expect(tasks.get(CATALOG.ecovadis.title)).toMatchObject({ requirement_code: 'ecovadis', origin: 'assessment' });
    expect(tasks.get('Segundo dossier EcoVadis')).toMatchObject({ requirement_code: null, origin: 'p4s' });
    expect(tasks.get(CATALOG.banking_esg.title)).toMatchObject({ requirement_code: 'banking_esg', origin: 'assessment' });
  });

  it('com duas contas cujo email só difere nas maiúsculas, param e dizem quais são, sem deixar a base a meio', async () => {
    await recreateUpTo('003');
    const companyId = await insertCompany('Fábrica dos Emails, Lda');
    for (const email of ['Gestor@Fabrica.test', 'gestor@fabrica.test', 'outra.pessoa@fabrica.test']) {
      await pool.query(
        `INSERT INTO users (company_id, email, password_hash, full_name, role) VALUES ($1, $2, 'x', 'Pessoa', 'company_user')`,
        [companyId, email],
      );
    }

    await expect(runMigrations(pool)).rejects.toThrow(/005_task_origin.*Gestor@Fabrica\.test, gestor@fabrica\.test/s);
    // A 004 ficou aplicada e a 005 foi desfeita por inteiro.
    const applied = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename');
    expect(applied.rows.map((row) => row.filename).slice(-1)).toEqual(['004_user_management.sql']);
    const columns = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'origin'`);
    expect(columns.rowCount).toBe(0);

    // Corrigido o que o erro aponta, a migração passa.
    await pool.query(`DELETE FROM users WHERE email = 'Gestor@Fabrica.test'`);
    expect(await runMigrations(pool)).toEqual(NEW_MIGRATIONS.slice(1));
  });
});
