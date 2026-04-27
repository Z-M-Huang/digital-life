import { describe, expect, it, vi } from 'vitest';
import { createDatabasePool, schema } from '../src/db/client';
import { createDenseMemClient } from '../src/dense-mem/client';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

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

  it('returns false from health checks when the request fails', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline'));
    const client = createDenseMemClient({
      baseUrl: 'http://dense-mem.local',
      fetcher,
      timeoutMs: 1000,
    });

    await expect(client.healthCheck()).resolves.toBe(false);
  });

  it('posts fragments and claims with normalized payloads and idempotency headers', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ fragment_id: 'fragment-1' }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'claim-1',
          status: 'validated',
          content: 'digital-life is active',
          confidence: 0.9,
        }),
      );

    const client = createDenseMemClient({
      apiKey: 'secret',
      baseUrl: 'http://dense-mem.local',
      fetcher,
      timeoutMs: 1000,
    });

    await expect(
      client.postFragment({
        content: 'Repository baseline established.',
        authority: 'connector:demo',
        classification: 'factual',
        idempotencyKey: 'fragment-key',
      }),
    ).resolves.toEqual({ id: 'fragment-1' });
    await expect(
      client.postClaim({
        fragmentIds: ['fragment-1'],
        subject: 'digital-life',
        predicate: 'status',
        object: 'active',
        content: 'digital-life is active',
        confidence: 0.9,
        authority: 'connector:demo',
        metadata: { source: 'demo' },
        idempotencyKey: 'claim-key',
      }),
    ).resolves.toMatchObject({ id: 'claim-1', status: 'validated' });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://dense-mem.local/api/v1/fragments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer secret',
          'content-type': 'application/json',
          'idempotency-key': 'fragment-key',
        }),
        body: JSON.stringify({
          content: 'Repository baseline established.',
          authority: 'connector:demo',
          classification: 'factual',
          metadata: {},
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://dense-mem.local/api/v1/claims',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer secret',
          'content-type': 'application/json',
          'idempotency-key': 'claim-key',
        }),
        body: JSON.stringify({
          subject: 'digital-life',
          predicate: 'status',
          object: 'active',
          content: 'digital-life is active',
          confidence: 0.9,
          authority: 'connector:demo',
          supported_by: ['fragment-1'],
          metadata: { source: 'demo' },
        }),
      }),
    );
  });

  it('verifies, promotes, retracts, recalls, and lists dense-mem resources', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'claim-1',
          status: 'validated',
          content: 'digital-life is active',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'fact-1',
          content: 'digital-life is active',
          truthScore: 0.95,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: 'fact-1', tier: '1', content: 'digital-life is active', score: 0.99 }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: 'fact-2', tier: '2', content: 'repository summary', score: 0.8 }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'fact-1', content: 'digital-life is active' }))
      .mockResolvedValueOnce(
        jsonResponse({ facts: [{ id: 'fact-1', content: 'digital-life is active' }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ communities: [{ id: 'community-1', summary: 'Repository facts' }] }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'community-1', summary: 'Repository facts' }));

    const client = createDenseMemClient({
      baseUrl: 'http://dense-mem.local',
      fetcher,
      timeoutMs: 1000,
    });

    await expect(client.verifyClaim('claim-1')).resolves.toMatchObject({ status: 'validated' });
    await expect(client.promoteClaim('claim-1')).resolves.toMatchObject({ id: 'fact-1' });
    await expect(client.retractFragment('fragment-1')).resolves.toBeUndefined();
    await expect(client.recall('baseline source', { limit: 3 })).resolves.toEqual([
      { id: 'fact-1', tier: '1', content: 'digital-life is active', score: 0.99 },
    ]);
    await expect(client.searchSemantic('repository summary', { limit: 2 })).resolves.toEqual([
      { id: 'fact-2', tier: '2', content: 'repository summary', score: 0.8 },
    ]);
    await expect(client.getFact('fact-1')).resolves.toEqual({
      id: 'fact-1',
      content: 'digital-life is active',
    });
    await expect(client.listFacts({ limit: 1 })).resolves.toEqual([
      { id: 'fact-1', content: 'digital-life is active' },
    ]);
    await expect(client.listCommunities()).resolves.toEqual([
      { id: 'community-1', summary: 'Repository facts' },
    ]);
    await expect(client.getCommunitySummary('community-1')).resolves.toEqual({
      id: 'community-1',
      summary: 'Repository facts',
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      'http://dense-mem.local/api/v1/recall?q=baseline%20source&limit=3',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      5,
      'http://dense-mem.local/api/v1/tools/semantic-search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ query: 'repository summary', limit: 2 }),
      }),
    );
  });

  it('returns null for missing facts and communities', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }));
    const client = createDenseMemClient({
      baseUrl: 'http://dense-mem.local',
      fetcher,
      timeoutMs: 1000,
    });

    await expect(client.getFact('missing')).resolves.toBeNull();
    await expect(client.getCommunitySummary('missing')).resolves.toBeNull();
  });

  it('translates API failures and missing fragment identifiers into structured errors', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(new Response('dense-mem exploded', { status: 500 }));
    const client = createDenseMemClient({
      baseUrl: 'http://dense-mem.local',
      fetcher,
      timeoutMs: 1000,
    });

    await expect(client.postFragment({ content: 'Missing id response' })).rejects.toMatchObject({
      body: {},
      message: 'postFragment returned no id',
      status: 200,
    });
    await expect(client.listFacts()).rejects.toMatchObject({
      body: 'dense-mem exploded',
      message: 'listFacts failed (500)',
      status: 500,
    });
  });

  it('exposes the schema and creates a pg pool', () => {
    const pool = createDatabasePool('postgres://user:pass@localhost:5432/db');

    expect(pool.options.connectionString).toContain('postgres://user:pass@localhost:5432/db');
    expect(schema.bootstrapStateTable).toBeDefined();

    pool.end();
  });
});
