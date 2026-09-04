import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { databasePool } from './pool.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(currentDirectory, '../../../database/migrations');

export async function runMigrations(): Promise<string[]> {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename varchar(255) PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const appliedResult = await databasePool.query<{ filename: string }>(
    'SELECT filename FROM public.schema_migrations'
  );
  const applied = new Set(appliedResult.rows.map((row: { filename: string }) => row.filename));
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  const executed: string[] = [];

  for (const filename of files) {
    if (applied.has(filename)) {
      continue;
    }

    const sql = await readFile(path.join(migrationsDirectory, filename), 'utf8');
    const client = await databasePool.connect();

    try {
      await client.query(sql);
      await client.query('INSERT INTO public.schema_migrations (filename) VALUES ($1)', [filename]);
      executed.push(filename);
    } finally {
      client.release();
    }
  }

  return executed;
}
