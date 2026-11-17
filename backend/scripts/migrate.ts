// Aplica por ordem os ficheiros de db/migrations que ainda não foram aplicados.
// Cada migração corre numa transação própria e fica registada em schema_migrations.
// Uso: npm run db:migrate

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type pg from 'pg';

export const MIGRATIONS_DIR = path.resolve(process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), 'db', 'migrations'));

/** Migrações que existem em disco e ainda não foram aplicadas a esta base de dados. */
export async function pendingMigrations(pool: pg.Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  const { rows } = await pool.query<{ exists: boolean }>(`SELECT to_regclass('schema_migrations') IS NOT NULL AS exists`);
  if (!rows[0]?.exists) return files;
  const applied = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  const done = new Set(applied.rows.map((row) => row.filename));
  return files.filter((file) => !done.has(file));
}

export async function runMigrations(pool: pg.Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const files = (await readdir(dir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.filename));

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      newlyApplied.push(file);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(`Falhou a migração ${file}: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  return newlyApplied;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { pool } = await import('../src/config/database.js');
  try {
    const applied = await runMigrations(pool);
    console.log(applied.length ? `Migrações aplicadas: ${applied.join(', ')}` : 'Base de dados já atualizada.');
  } finally {
    await pool.end();
  }
}
