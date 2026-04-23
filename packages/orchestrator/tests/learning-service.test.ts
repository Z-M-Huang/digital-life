import type { DenseMemClient, DenseMemWriteRequest } from '@digital-life/core';
import { describe, expect, it, vi } from 'vitest';

import { createInMemoryRuntimeStateRepository } from '../src/repositories/runtime-state-repository';
import { createRuntime } from '../src/runtime/create-runtime';
import { createTestConfig } from '../src/testing/create-test-runtime';

describe('LearningService', () => {
  it('runs baseline, incremental, and resync learning modes with dense-mem writes', async () => {
    const writes: DenseMemWriteRequest[] = [];
    const denseMemClient: DenseMemClient = {
      healthCheck: vi.fn(async () => true),
      writeFragments: vi.fn(async (request) => {
        writes.push(request);
      }),
    };
    const repository = createInMemoryRuntimeStateRepository();
    const runtime = await createRuntime({
      config: createTestConfig(),
      denseMemClient,
      repository,
    });

    await runtime.connectorService.setScope('demo', [
      { id: 'repo-1', label: 'digital-life', metadata: { kind: 'repository' } },
    ]);

    const baselineRun = await runtime.learningService.createRun({
      mode: 'baseline',
      connectorIds: ['demo'],
    });
    const incrementalRun = await runtime.learningService.createRun({
      mode: 'incremental',
      connectorIds: ['demo'],
    });
    const resyncRun = await runtime.learningService.createRun({
      mode: 'resync',
      connectorIds: ['demo'],
    });
    const baselineEvents = await runtime.learningService.getRunEvents(baselineRun.id);
    const cursorWindows = await repository.listCursorWindows('demo');

    expect(baselineRun.status).toBe('completed');
    expect(incrementalRun.status).toBe('completed');
    expect(resyncRun.status).toBe('completed');
    expect(writes).toHaveLength(3);
    expect(writes[0]?.namespace).toBe('digital-life');
    expect(cursorWindows.some((window) => window.metadata.mode === 'incremental')).toBe(true);
    expect(baselineEvents.some((event) => event.type === 'progress')).toBe(true);
    expect(
      (baselineRun.details.totals as { fragmentsWritten: number }).fragmentsWritten,
    ).toBeGreaterThan(0);
  });
});
