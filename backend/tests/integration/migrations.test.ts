// A migração 005 corre sobre dados gravados pela versão anterior e deixa-os coerentes.

import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from '../../scripts/migrate.js';
import { pool } from '../../src/config/database.js';

afterAll(async () => {
  await pool.end();
});

async function recreateUpTo(lastPrefix: string): Promise<void> {
  const { rows } = await pool.query<{ name: string }>('SELECT current_database() AS name');
  if (!rows[0]?.name.endsWith('_test')) throw new Error('Só em bases de dados terminadas em _test.');
  const dir = await mkdtemp(path.join(tmpdir(), 'p4s-migrations-'));
  try {
    for (const file of (await readdir(MIGRATIONS_DIR)).filter((name) => name.slice(0, 3) <= lastPrefix)) {
      await cp(path.join(MIGRATIONS_DIR, file), path.join(dir, file));
    }
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(pool, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('migração 005 sobre dados da versão anterior', () => {
  it('liga as tarefas geradas ao requisito, tira a linha «Exigido por» e dá uma data de emissão à proposta', async () => {
    await recreateUpTo('004');

    const company = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, nif, cae) VALUES ('Fábrica Antiga, Lda', '500000000', '25734') RETURNING id`,
    );
    const companyId = company.rows[0]?.id as string;
    const assessment = await pool.query<{ id: string }>(
      `INSERT INTO assessments (company_id, status, completed_at, created_at)
       VALUES ($1, 'completed', '2026-10-01T10:00:00Z', '2026-10-01T09:00:00Z') RETURNING id`,
      [companyId],
    );
    const assessmentId = assessment.rows[0]?.id as string;
    const insertTask = (title: string, description: string | null, executor: string) =>
      pool.query(
        `INSERT INTO tasks (assessment_id, company_id, title, description, domain, executor_type)
         VALUES ($1, $2, $3, $4, 'ecovadis', $5)`,
        [assessmentId, companyId, title, description, executor],
      );
    await insertTask(
      'Preparação e Submissão do Dossier EcoVadis',
      'Recolha de políticas e evidências.\n\nExigido por: Cliente industrial.',
      'p4s',
    );
    await insertTask(
      'Auditoria de Segurança da Informação e Conformidade NIS2/TISAX',
      'Auditoria por parceiro.\n\nExigido por: Cliente industrial / NIS2 (se a empresa estiver abrangida).',
      'internal', // o consultor tinha-a passado a Interno: continua a ser do diagnóstico
    );
    await insertTask('Dossier EcoVadis com âmbito alterado à mão', 'Texto livre.\n\nExigido por: Cliente industrial.', 'p4s');
    await insertTask('Recolher faturas de energia', null, 'internal');
    await insertTask('Workshop extra', 'Sessão de trabalho com a direção.', 'p4s');

    expect(await runMigrations(pool)).toEqual(['005_task_origin_and_proposal_issue.sql']);

    const tasks = await pool.query<{ title: string; requirement_code: string | null; origin: string; description: string | null }>(
      'SELECT title, requirement_code, origin, description FROM tasks ORDER BY title',
    );
    expect(tasks.rows).toEqual([
      {
        title: 'Auditoria de Segurança da Informação e Conformidade NIS2/TISAX',
        requirement_code: 'information_security',
        origin: 'assessment',
        description: 'Auditoria por parceiro.',
      },
      {
        title: 'Dossier EcoVadis com âmbito alterado à mão',
        requirement_code: null,
        origin: 'p4s',
        description: 'Texto livre.\n\nExigido por: Cliente industrial.',
      },
      {
        title: 'Preparação e Submissão do Dossier EcoVadis',
        requirement_code: 'ecovadis',
        origin: 'assessment',
        description: 'Recolha de políticas e evidências.',
      },
      { title: 'Recolher faturas de energia', requirement_code: null, origin: 'company', description: null },
      { title: 'Workshop extra', requirement_code: null, origin: 'p4s', description: 'Sessão de trabalho com a direção.' },
    ]);

    const issued = await pool.query<{ issued: Date }>('SELECT proposal_issued_at AS issued FROM assessments');
    expect(issued.rows[0]?.issued.toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });
});
