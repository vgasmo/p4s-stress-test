import pg from 'pg';
import { env } from './env.js';

// NUMERIC chega como string. Os valores cabem em double (NUMERIC(15, 2) ≤ 1e13).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => Number(value));
// DATE fica como 'YYYY-MM-DD', sem conversão para fuso horário.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (error) => {
  console.error('[db] erro num cliente inativo do pool', error);
});

/** Pool ou cliente de transação. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}

/** Executa fn numa transação BEGIN…COMMIT, com ROLLBACK em caso de erro. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
