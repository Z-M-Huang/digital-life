import { describe, expect, it } from 'vitest';

import { migrateRuntimeState } from '../src/runtime/migrate-runtime-state';
import { createPostgresTestDatabase } from './helpers/create-postgres-test-database';

describe('migrateRuntimeState', () => {
  it('re-applies the runtime schema without error', async () => {
    const { database, dispose } = await createPostgresTestDatabase();

    try {
      await expect(migrateRuntimeState(database)).resolves.toBeUndefined();
    } finally {
      await dispose();
    }
  });
});
