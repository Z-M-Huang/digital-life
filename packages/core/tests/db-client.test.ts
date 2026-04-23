import { describe, expect, it } from 'vitest';

import { createDatabasePool, createManagedDatabase } from '../src/db/client';

describe('database client helpers', () => {
  it('creates a managed database and exposes the backing pool', async () => {
    const managed = createManagedDatabase('postgres://user:pass@localhost:5432/db');

    expect(managed.database).toBeDefined();
    expect(managed.pool).toBeDefined();

    await managed.pool.end();
  });

  it('creates pools with caller-provided options', async () => {
    const pool = createDatabasePool('postgres://user:pass@localhost:5432/db', {
      max: 1,
    });

    expect(pool.options.max).toBe(1);

    await pool.end();
  });
});
