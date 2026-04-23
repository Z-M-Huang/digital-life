import { describe, expect, it } from 'vitest';

import { createInMemoryRuntimeStateRepository } from '../src/repositories/runtime-state-repository';

describe('createInMemoryRuntimeStateRepository', () => {
  it('stores and retrieves runtime state records', async () => {
    const repository = createInMemoryRuntimeStateRepository();
    const initialBootstrap = await repository.getBootstrapState();

    expect(initialBootstrap.status).toBe('not_started');
    expect(await repository.getConnectorScope('demo')).toEqual([]);
    expect(await repository.listCursorWindows()).toEqual([]);
    expect(await repository.getLearningRun('missing')).toBeNull();

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
      createdAt: new Date(),
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
        createdAt: new Date(),
        level: 'info',
        message: 'loaded',
      },
    ]);
    await repository.saveReadinessState({
      status: 'partial',
      score: 75,
      blockers: [],
      warnings: ['baseline pending'],
      updatedAt: new Date(),
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
  });

  it('throws when updating a missing learning run', async () => {
    const repository = createInMemoryRuntimeStateRepository();

    await expect(repository.updateLearningRun('missing', {})).rejects.toThrow(
      'Unknown learning run',
    );
  });
});
