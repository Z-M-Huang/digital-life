import { createDatabasePool, createDenseMemClient } from '@digital-life/core';

type ReadinessCheck = {
  detail?: string;
  name: string;
  ok: boolean;
};

export type ReadinessStatus = {
  checks: ReadinessCheck[];
  ok: boolean;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown readiness error';

const checkDatabase = async (databaseUrl?: string): Promise<ReadinessCheck> => {
  if (!databaseUrl) {
    return {
      detail: 'DATABASE_URL not set.',
      name: 'database',
      ok: true,
    };
  }

  const pool = createDatabasePool(databaseUrl, {
    connectionTimeoutMillis: 1500,
    idleTimeoutMillis: 1500,
    max: 1,
  });

  try {
    await pool.query('select 1');
    return {
      name: 'database',
      ok: true,
    };
  } catch (error) {
    return {
      detail: getErrorMessage(error),
      name: 'database',
      ok: false,
    };
  } finally {
    await pool.end();
  }
};

const checkDenseMem = async (baseUrl?: string): Promise<ReadinessCheck> => {
  if (!baseUrl) {
    return {
      detail: 'dense-mem URL not set.',
      name: 'dense-mem',
      ok: true,
    };
  }

  try {
    const client = createDenseMemClient({
      baseUrl,
      timeoutMs: 1500,
    });
    const ok = await client.healthCheck();

    return {
      name: 'dense-mem',
      ok,
      ...(ok ? {} : { detail: 'Health endpoint returned a non-success status.' }),
    };
  } catch (error) {
    return {
      detail: getErrorMessage(error),
      name: 'dense-mem',
      ok: false,
    };
  }
};

export const checkRuntimeReadiness = async ({
  databaseUrl,
  denseMemUrl,
}: {
  databaseUrl?: string;
  denseMemUrl?: string;
}): Promise<ReadinessStatus> => {
  const checks = await Promise.all([checkDatabase(databaseUrl), checkDenseMem(denseMemUrl)]);
  return {
    checks,
    ok: checks.every((check) => check.ok),
  };
};
