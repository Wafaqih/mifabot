import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import { env } from '../../config/env.js';
import { logger } from '../logger/logger.js';

export const databasePool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

databasePool.on('error', (error: Error) => {
  logger.error({ error }, 'Koneksi PostgreSQL idle mengalami error.');
});

export async function query<Row extends QueryResultRow>(sql: string, values: unknown[] = []) {
  return databasePool.query<Row>(sql, values);
}

export async function withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await databasePool.connect();

  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabaseConnection(): Promise<{ database: string; serverTime: Date }> {
  const result = await query<{ database: string; server_time: Date }>(
    'SELECT current_database() AS database, now() AS server_time'
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error('PostgreSQL tidak mengembalikan hasil pemeriksaan koneksi.');
  }

  return { database: row.database, serverTime: row.server_time };
}

export async function closeDatabasePool(): Promise<void> {
  await databasePool.end();
}
