import { createManagedDatabase } from '@digital-life/core';
import { migrateRuntimeState } from '@digital-life/orchestrator';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run digital-life migrations.');
}

const { database, pool } = createManagedDatabase(databaseUrl);

try {
  await migrateRuntimeState(database);
  console.log('digital-life database migrations applied.');
} finally {
  await pool.end();
}
