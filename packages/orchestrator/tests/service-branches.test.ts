import { createDemoConnector, createUnifiedToolRegistry } from '@digital-life/connectors';
import type { DenseMemClient } from '@digital-life/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createInMemoryKnowledgeRepository } from '../src/repositories/knowledge-repository';
import { createInMemoryRuntimeStateRepository } from '../src/repositories/runtime-state-repository';
import { createRuntime } from '../src/runtime/create-runtime';
import { ConnectorService } from '../src/services/connector-service';
import { KnowledgeService } from '../src/services/knowledge-service';
import { LearningService } from '../src/services/learning-service';
import { ReadinessService } from '../src/services/readiness-service';
import { StartupService } from '../src/services/startup-service';
import {
  createTestConfig,
  createTestDenseMemClient,
  createTestRuntime,
} from '../src/testing/create-test-runtime';

describe('service edge cases', () => {
  it('handles startup errors, missing connectors, explicit learning runs, and readiness transitions', async () => {
    const runtime = await createRuntime({
      config: createTestConfig(),
      repository: createInMemoryRuntimeStateRepository(),
    });
    const repository = createInMemoryRuntimeStateRepository();
    const quietConnector = {
      id: 'quiet',
      displayName: 'Quiet',
      kind: 'builtin' as const,
      async startupCheck() {
        return {
          ok: false,
          messages: [{ level: 'error' as const, message: 'connector failed' }],
        };
      },
      async listTools() {
        return [];
      },
    };
    const startupService = new StartupService(createTestConfig(), [quietConnector], repository, {});
    const startup = await startupService.validate();
    const connectorService = new ConnectorService(
      createTestConfig(),
      [quietConnector],
      runtime.registry,
      repository,
    );
    const learningConnector = createDemoConnector({
      connectorId: 'demo',
      config: { repositories: [], inboxWindows: [] },
    });
    const registry = await createUnifiedToolRegistry({
      connectors: [learningConnector],
    });
    const knowledgeService = new KnowledgeService(createInMemoryKnowledgeRepository());
    const learningService = new LearningService(
      createTestConfig(),
      [learningConnector],
      registry,
      repository,
      createTestDenseMemClient(),
      knowledgeService,
      async () => undefined,
    );
    const run = await learningService.createRun({
      mode: 'incremental',
      connectorIds: ['demo'],
      details: { cursor: '1' },
    });
    await repository.saveBootstrapState({
      persona: { name: 'Digital Life' },
      baselineRunId: run.id,
      status: 'in_progress',
    });
    await repository.saveConnectorScope('demo', [
      { id: 'repo-1', label: 'digital-life', metadata: { kind: 'repository' } },
    ]);
    const readinessService = new ReadinessService([quietConnector], runtime.registry, repository);

    expect(startup.ok).toBe(false);
    await expect(connectorService.getConnector('missing')).rejects.toThrow('Unknown connector');
    await expect(connectorService.getScopeOptions('quiet')).resolves.toEqual([]);
    expect((await learningService.getRun(run.id))?.details.cursor).toBe('1');
    expect((await learningService.listRuns())[0]?.id).toBe(run.id);

    const blockedReadiness = await readinessService.getReadiness();
    expect(blockedReadiness.status).toBe('blocked');

    await repository.replaceStartupLogs([]);
    const partialReadiness = await readinessService.getReadiness();
    expect(partialReadiness.status).toBe('partial');
  });

  it('fails a learning run when dense-mem is unavailable', async () => {
    const repository = createInMemoryRuntimeStateRepository();
    const denseMemClient: DenseMemClient = {
      healthCheck: vi.fn(async () => false),
      writeFragments: vi.fn(async () => undefined),
    };
    const connector = {
      id: 'demo',
      displayName: 'Demo',
      kind: 'builtin' as const,
      learning: {
        enumerateToolIds: [] as const,
        fetchToolIds: ['demo.fetch'],
        defaultMode: 'baseline' as const,
        supportedModes: ['baseline', 'incremental', 'resync'] as const,
      },
      async startupCheck() {
        return { ok: true, messages: [] };
      },
      async listTools() {
        return [
          {
            id: 'demo.fetch',
            description: 'Fetch',
            capability: 'read' as const,
            role: 'fetch' as const,
            phases: ['learning'] as const,
            inputSchema: z.object({ repositoryId: z.string() }),
            outputSchema: z.object({ facts: z.array(z.string()) }),
            async execute() {
              return { facts: ['hello world'] };
            },
          },
        ];
      },
    };
    await repository.saveConnectorScope('demo', [
      { id: 'repo-1', label: 'digital-life', metadata: { kind: 'repository' } },
    ]);
    const registry = await createUnifiedToolRegistry({ connectors: [connector] });
    const knowledgeService = new KnowledgeService(createInMemoryKnowledgeRepository());
    const learningService = new LearningService(
      createTestConfig(),
      [connector],
      registry,
      repository,
      denseMemClient,
      knowledgeService,
      async () => undefined,
    );

    const run = await learningService.createRun({
      mode: 'baseline',
      connectorIds: ['demo'],
    });
    const events = await learningService.getRunEvents(run.id);

    expect(run.status).toBe('failed');
    expect(events.at(-1)?.type).toBe('error');
  });

  it('guards live non-read tool enablement and recomputes reflection items', async () => {
    const runtime = await createTestRuntime();

    await runtime.startupService.validate();
    const initialReflection = await runtime.reflectionService.recompute();
    await runtime.connectorService.setScope('demo', [
      { id: 'repo-1', label: 'digital-life', metadata: { kind: 'repository' } },
    ]);
    await runtime.bootstrapService.savePersona({ name: 'Digital Life' });
    await runtime.bootstrapService.startBaselineRun();
    const updatedReflection = await runtime.reflectionService.recompute();

    expect(initialReflection.some((item: { category: string }) => item.category === 'scope')).toBe(
      true,
    );
    expect(
      updatedReflection.some((item: { category: string }) => item.category === 'maintenance'),
    ).toBe(true);

    const writeConnector = {
      id: 'writer',
      displayName: 'Writer',
      kind: 'builtin' as const,
      async startupCheck() {
        return { ok: true, messages: [] };
      },
      async listTools() {
        return [
          {
            id: 'writer.send',
            description: 'Send a message',
            capability: 'write' as const,
            role: 'action' as const,
            phases: ['live', 'maintenance'] as const,
            inputSchema: z.object({ value: z.string() }),
            outputSchema: z.object({ ok: z.boolean() }),
            async execute() {
              return { ok: true };
            },
          },
        ];
      },
    };
    const registry = await createUnifiedToolRegistry({ connectors: [writeConnector] });
    const guardedService = new ConnectorService(
      createTestConfig(),
      [writeConnector],
      registry,
      createInMemoryRuntimeStateRepository(),
      async () => ({
        status: 'partial',
        score: 70,
        blockers: [],
        warnings: ['baseline pending'],
        updatedAt: new Date(),
      }),
    );

    await expect(guardedService.patchToolPolicy('writer.send', 'live', true)).rejects.toThrow(
      'operator reason',
    );
    await expect(
      guardedService.patchToolPolicy('writer.send', 'live', true, 'operator approved'),
    ).rejects.toThrow('readiness status ready');

    const readyService = new ConnectorService(
      createTestConfig(),
      [writeConnector],
      registry,
      createInMemoryRuntimeStateRepository(),
      async () => ({
        status: 'ready',
        score: 100,
        blockers: [],
        warnings: [],
        updatedAt: new Date(),
      }),
    );
    const policy = await readyService.patchToolPolicy(
      'writer.send',
      'live',
      true,
      'operator approved',
    );

    expect(policy.enabled).toBe(true);
  });
});
