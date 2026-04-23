import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema';

export type DigitalLifeDatabase = NodePgDatabase<typeof schema>;
export type ManagedDigitalLifeDatabase = {
  database: DigitalLifeDatabase;
  pool: Pool;
};

export const createDatabasePool = (
  connectionString: string,
  options: Omit<PoolConfig, 'connectionString'> = {},
): Pool =>
  new Pool({
    connectionString,
    ...options,
  });

export const createManagedDatabase = (connectionString: string): ManagedDigitalLifeDatabase => {
  const pool = createDatabasePool(connectionString);
  return {
    database: drizzle(pool, { schema }),
    pool,
  };
};

export const createDatabase = (connectionString: string): DigitalLifeDatabase =>
  createManagedDatabase(connectionString).database;

export { schema };
