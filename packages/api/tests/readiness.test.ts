import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkRuntimeReadiness } from '../src/runtime/readiness';

describe('checkRuntimeReadiness', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('passes when optional dependencies are not configured', async () => {
    await expect(checkRuntimeReadiness({})).resolves.toEqual({
      checks: [
        {
          detail: 'DATABASE_URL not set.',
          name: 'database',
          ok: true,
        },
        {
          detail: 'dense-mem URL not set.',
          name: 'dense-mem',
          ok: true,
        },
      ],
      ok: true,
    });
  });

  it('checks dense-mem health through its HTTP endpoint', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;

    const readiness = await checkRuntimeReadiness({
      denseMemUrl: 'http://dense-mem:8080',
    });

    expect(readiness.ok).toBe(true);
    expect(readiness.checks[1]).toMatchObject({
      name: 'dense-mem',
      ok: true,
    });
  });

  it('reports failed dense-mem and database checks', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('{}', { status: 503 }),
    ) as unknown as typeof fetch;

    const readiness = await checkRuntimeReadiness({
      databaseUrl: 'postgres://user:pass@127.0.0.1:1/db',
      denseMemUrl: 'http://dense-mem:8080',
    });

    expect(readiness.ok).toBe(false);
    expect(readiness.checks[0]).toMatchObject({
      name: 'database',
      ok: false,
    });
    expect(readiness.checks[1]).toMatchObject({
      name: 'dense-mem',
      ok: false,
    });
  });
});
