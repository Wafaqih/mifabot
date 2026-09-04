import { runMigrations } from '../core/database/migrate.js';
import { closeDatabasePool } from '../core/database/pool.js';
import { logger } from '../core/logger/logger.js';

try {
  const executed = await runMigrations();
  logger.info({ executed }, executed.length ? 'Migration PostgreSQL selesai.' : 'Database sudah versi terbaru.');
} catch (error) {
  logger.error({ error }, 'Migration PostgreSQL gagal.');
  process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
