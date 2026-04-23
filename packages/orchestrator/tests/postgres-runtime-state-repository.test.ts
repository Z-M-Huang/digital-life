import { describe, expect, it, vi } from 'vitest';

import { createPostgresRuntimeStateRepository } from '../src/repositories/postgres-runtime-state-repository';
import { createRuntime } from '../src/runtime/create-runtime';
import { createTestConfig, createTestDenseMemClient } from '../src/testing/create-test-runtime';
import { createPostgresTestDatabase } from './helpers/create-postgres-test-database';

describe('createPostgresRuntimeStateRepository', () => {
  const missingRunId = '00000000-0000-4000-8000-000000000000';

  it('stores and retrieves runtime state records in Postgres', async () => {
    const { database, dispose } = await createPostgresTestDatabase();

    try {
      const repository = createPostgresRuntimeStateRepository({
        database,
        personaId: 'primary',
      });
      const initialBootstrap = await repository.getBootstrapState();

      expect(initialBootstrap.status).toBe('not_started');
      expect(await repository.getConnectorScope('demo')).toEqual([]);
      expect(await repository.listCursorWindows()).toEqual([]);
      expect(await repository.getLearningRun(missingRunId)).toBeNull();

      const bootstrap = await repository.saveBootstrapState({
        persona: { name: 'Digital Life' },
        recommendedConnectors: ['demo'],
        status: 'in_progress',
      });
      await repository.saveConnectorScope('demo', [
        { id: 'repo-1', label: 'digital-life', metadata: { kind: 'repository' } },
      ]);
      const policy = await repository.upsertToolPolicy({
        toolId: 'demo.fetchRepository',
        phase: 'live',
        enabled: false,
        reason: 'operator choice',
      });
      const run = await repository.createLearningRun({
        connectorIds: ['demo'],
        details: { mode: 'test' },
        mode: 'baseline',
        status: 'queued',
      });
      await repository.appendLearningRunEvent({
        runId: run.id,
        type: 'log',
        payload: { message: 'queued' },
        createdAt: new Date('2026-01-03T00:00:00Z'),
      });
      await repository.saveCursorWindow({
        runId: run.id,
        connectorId: 'demo',
        cursorKey: 'demo.fetchRepository',
        cursorValue: 'repo-1',
        windowStart: new Date('2026-01-01T00:00:00Z'),
        windowEnd: new Date('2026-01-02T00:00:00Z'),
        metadata: { mode: 'baseline' },
      });
      await repository.replaceStartupLogs([
        {
          connectorId: 'demo',
          createdAt: new Date('2026-01-04T00:00:00Z'),
          level: 'info',
          message: 'loaded',
        },
      ]);
      await repository.saveReadinessState({
        status: 'partial',
        score: 75,
        blockers: [],
        warnings: ['baseline pending'],
        updatedAt: new Date('2026-01-05T00:00:00Z'),
      });
      const updatedRun = await repository.updateLearningRun(run.id, {
        status: 'completed',
      });

      expect(bootstrap.persona.name).toBe('Digital Life');
      expect((await repository.listConnectorScopes()).demo).toHaveLength(1);
      expect((await repository.listToolPolicies())[0]).toMatchObject(policy);
      expect((await repository.listLearningRuns())[0]?.status).toBe('completed');
      expect((await repository.listLearningRunEvents(run.id))[0]?.payload.message).toBe('queued');
      expect((await repository.listCursorWindows('demo'))[0]?.cursorValue).toBe('repo-1');
      expect((await repository.listStartupLogs())[0]?.message).toBe('loaded');
      expect((await repository.getReadinessState()).score).toBe(75);
      expect(updatedRun.status).toBe('completed');
    } finally {
      await dispose();
    }
  });

  it('throws when updating a missing learning run', async () => {
    const { database, dispose } = await createPostgresTestDatabase();

    try {
      const repository = createPostgresRuntimeStateRepository({
        database,
        personaId: 'primary',
      });

      await expect(repository.updateLearningRun(missingRunId, {})).rejects.toThrow(
        'Unknown learning run',
      );
    } finally {
      await dispose();
    }
  });

  it('creates a runtime backed by Postgres when a database is supplied', async () => {
    const { database, dispose } = await createPostgresTestDatabase();

    try {
      const runtime = await createRuntime({
        config: createTestConfig(),
        database,
        denseMemClient: createTestDenseMemClient(),
      });

      await runtime.connectorService.setScope('demo', [
        { id: 'repo-1', label: 'digital-life', metadata: { kind: 'repository' } },
      ]);
      await runtime.bootstrapService.savePersona({ name: 'Digital Life' });

      expect(await runtime.repository.getConnectorScope('demo')).toHaveLength(1);
      expect((await runtime.repository.getBootstrapState()).persona.name).toBe('Digital Life');
    } finally {
      await dispose();
    }
  });

  it('falls back to the in-memory repository when no database is configured', async () => {
    vi.stubEnv('DATABASE_URL', '');

    try {
      const runtime = await createRuntime({
        config: createTestConfig(),
        denseMemClient: createTestDenseMemClient(),
      });

      await runtime.connectorService.setScope('demo', [
        { id: 'repo-1', label: 'digital-life', metadata: { kind: 'repository' } },
      ]);

      expect(await runtime.repository.getConnectorScope('demo')).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
