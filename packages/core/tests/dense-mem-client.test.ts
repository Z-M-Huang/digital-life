import { describe, expect, it, vi } from 'vitest';
import { createDatabasePool, schema } from '../src/db/client';
import { createDenseMemClient } from '../src/dense-mem/client';

describe('createDenseMemClient', () => {
  it('checks health and writes fragments', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    const client = createDenseMemClient({
      baseUrl: 'http://dense-mem.local',
      fetcher,
      timeoutMs: 1000,
    });

    await expect(client.healthCheck()).resolves.toBe(true);
    await expect(
      client.writeFragments({
        namespace: 'digital-life',
        fragments: [{ id: 'fact-1', content: 'hello', provenance: { source: 'test' } }],
      }),
    ).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('exposes the schema and creates a pg pool', () => {
    const pool = createDatabasePool('postgres://user:pass@localhost:5432/db');

    expect(pool.options.connectionString).toContain('postgres://user:pass@localhost:5432/db');
    expect(schema.bootstrapStateTable).toBeDefined();

    pool.end();
  });
});
