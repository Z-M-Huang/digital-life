import { describe, expect, it, vi } from 'vitest';
import { createDatabasePool, schema } from '../src/db/client';
import { createDenseMemClient } from '../src/dense-mem/client';

describe('createDenseMemClient', () => {
  it('checks health', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const client = createDenseMemClient({
      baseUrl: 'http://dense-mem.local',
      fetcher,
      timeoutMs: 1000,
    });

    await expect(client.healthCheck()).resolves.toBe(true);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'http://dense-mem.local/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('exposes the schema and creates a pg pool', () => {
    const pool = createDatabasePool('postgres://user:pass@localhost:5432/db');

    expect(pool.options.connectionString).toContain('postgres://user:pass@localhost:5432/db');
    expect(schema.bootstrapStateTable).toBeDefined();

    pool.end();
  });
});
