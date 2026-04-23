import { describe, expect, it } from 'vitest';

import { createPostgresReflectionRepository } from '../src/repositories/postgres-reflection-repository';
import { createPostgresTestDatabase } from './helpers/create-postgres-test-database';

describe('createPostgresReflectionRepository', () => {
  it('stores and replaces reflection items in Postgres', async () => {
    const { database, dispose } = await createPostgresTestDatabase();

    try {
      const repository = createPostgresReflectionRepository({ database });
      const firstSet = await repository.replaceReflectionItems([
        {
          category: 'scope',
          connectorId: 'demo',
          detail: 'Connector Demo has no selected scope.',
          metadata: { connectorId: 'demo' },
          runId: null,
          severity: 'warning',
          status: 'open',
          title: 'Missing connector scope',
        },
      ]);
      const secondSet = await repository.replaceReflectionItems([
        {
          category: 'maintenance',
          connectorId: null,
          detail: 'No incremental run exists yet.',
          metadata: {},
          runId: null,
          severity: 'info',
          status: 'open',
          title: 'Maintenance run recommended',
        },
      ]);

      expect(firstSet[0]?.category).toBe('scope');
      expect((await repository.listReflectionItems()).map((item) => item.category)).toEqual([
        'maintenance',
      ]);
      expect(secondSet[0]?.title).toBe('Maintenance run recommended');
    } finally {
      await dispose();
    }
  });
});
