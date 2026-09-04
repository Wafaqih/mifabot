import { checkDatabaseConnection, closeDatabasePool } from '../core/database/pool.js';
import { logger } from '../core/logger/logger.js';

try {
  const connection = await checkDatabaseConnection();
  logger.info(connection, 'PostgreSQL tersambung.');
} catch (error) {
  logger.error({ error }, 'Gagal tersambung ke PostgreSQL. Periksa DATABASE_URL di .env.');
  process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
