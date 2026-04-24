import type { DenseMemClient, DigitalLifeConfig } from '@digital-life/core';
import { describe, expect, it, vi } from 'vitest';

import { createInMemoryRuntimeStateRepository } from '../src/repositories/runtime-state-repository';
import { createRuntime } from '../src/runtime/create-runtime';
import { createTestConfig } from '../src/testing/create-test-runtime';

describe('LearningService', () => {
  it('runs baseline, incremental, and resync learning modes with dense-mem writes', async () => {
    const mcpWrites: Record<string, unknown>[] = [];
    const denseMemClient: DenseMemClient = {
      healthCheck: vi.fn(async () => true),
    };
    const config: DigitalLifeConfig = {
      ...createTestConfig(),
      connectors: {
        ...createTestConfig().connectors,
        'dense-memory': {
          enabled: true,
          hardDeny: [],
          headers: {},
          kind: 'mcp',
          transport: {
            headers: { authorization: 'Bearer test-api-key' },
            type: 'streamable-http',
            url: 'http://dense-mem.local/mcp',
          },
        },
      },
    };
    const repository = createInMemoryRuntimeStateRepository();
    const runtime = await createRuntime({
      bridgeFactory: async () => ({
        async close() {
          return undefined;
        },
        async startupCheck() {
          return { ok: true, messages: [] };
        },
        async callTool(toolName, input) {
          if (toolName === 'save_memory') {
            mcpWrites.push(input);
          }
          return { id: `memory-${mcpWrites.length}`, status: 'created' };
        },
        async listTools() {
          return [
            {
              description: 'Persist memory',
              inputSchema: { type: 'object' },
              name: 'save_memory',
            },
          ];
        },
      }),
      config,
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
    expect(mcpWrites.length).toBeGreaterThan(0);
    expect(mcpWrites[0]).toMatchObject({
      source: 'digital-life',
      source_type: 'observation',
    });
    expect(cursorWindows.some((window) => window.metadata.mode === 'incremental')).toBe(true);
    expect(baselineEvents.some((event) => event.type === 'progress')).toBe(true);
    expect(
      (baselineRun.details.totals as { fragmentsWritten: number }).fragmentsWritten,
    ).toBeGreaterThan(0);
  });
});
