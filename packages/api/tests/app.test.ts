import {
  type ConsolidationAgent,
  createCannedLearnerClient,
  createConsolidationAgent,
  createDefaultLearners,
  createPassthroughLearnerClient,
  createQueryAgent,
  type LLMClient,
  loadBuiltinPrompts,
  type PromptBundle,
} from '@digital-life/agents';
import { createUnifiedToolRegistry } from '@digital-life/connectors';
import {
  BootstrapService,
  ChatService,
  ConnectorService,
  createInMemoryKnowledgeRepository,
  createInMemoryReflectionRepository,
  createInMemoryRuntimeStateRepository,
  createInMemoryToolLearningRepository,
  createScheduler,
  createTestConfig,
  createTestDenseMemClient,
  createTestRuntime,
  type DigitalLifeRuntime,
  GapService,
  KnowledgeService,
  LearningService,
  MaintenanceService,
  ReadinessService,
  ReflectionService,
  StartupService,
  ToolLearningService,
} from '@digital-life/orchestrator';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const buildTestPrompts = async (): Promise<PromptBundle> => ({
  ...(await loadBuiltinPrompts()),
  promptVersion: '1.test',
});

const buildTestLearners = async (client: LLMClient = createCannedLearnerClient()) =>
  createDefaultLearners({ client, prompts: await buildTestPrompts() });

import { createApp } from '../src/create-app';

const createGuardedRuntime = async (): Promise<DigitalLifeRuntime> => {
  const config = createTestConfig();
  const connectors = [
    {
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
    },
  ];
  const repository = createInMemoryRuntimeStateRepository();
  const knowledgeRepository = createInMemoryKnowledgeRepository();
  const reflectionRepository = createInMemoryReflectionRepository();
  const registry = await createUnifiedToolRegistry({ connectors });
  const knowledgeService = new KnowledgeService(knowledgeRepository);
  const readinessService = new ReadinessService(connectors, registry, repository);
  const reflectionService = new ReflectionService(
    connectors,
    registry,
    reflectionRepository,
    repository,
  );
  const llmClient = createPassthroughLearnerClient();
  const prompts = await buildTestPrompts();
  const learners = await buildTestLearners(llmClient);
  const learningService = new LearningService(
    config,
    connectors,
    registry,
    repository,
    createTestDenseMemClient(),
    knowledgeService,
    learners,
    undefined,
    async () => {
      await readinessService.recompute();
      await reflectionService.recompute();
    },
  );
  const bootstrapService = new BootstrapService(connectors, repository, learningService);
  const startupService = new StartupService(config, connectors, repository, {}, async () => {
    await readinessService.recompute();
    await reflectionService.recompute();
  });
  const connectorService = new ConnectorService(
    config,
    connectors,
    registry,
    repository,
    () => readinessService.getReadiness(),
    () => reflectionService.recompute(),
  );
  const queryAgent = createQueryAgent({ client: llmClient, prompts });
  const consolidationAgent: ConsolidationAgent = createConsolidationAgent({
    client: llmClient,
    prompts,
  });
  const chatService = new ChatService(knowledgeService, knowledgeRepository, queryAgent, llmClient);
  const maintenanceService = new MaintenanceService({
    connectors,
    denseMemClient: createTestDenseMemClient(),
    learningService,
    reflectionService,
    readinessService,
  });
  const scheduler = createScheduler({
    config: config.maintenance,
    task: async () => {
      await maintenanceService.runCycle();
    },
  });
  const toolLearningRepository = createInMemoryToolLearningRepository();
  const gapService = new GapService(toolLearningRepository, reflectionService);
  const toolLearningService = new ToolLearningService(toolLearningRepository);

  return {
    bootstrapService,
    chatService,
    config,
    connectorService,
    connectors,
    consolidationAgent,
    gapService,
    knowledgeRepository,
    knowledgeService,
    llmClient,
    maintenanceService,
    prompts,
    queryAgent,
    reflectionRepository,
    reflectionService,
    learningService,
    promptOverrides: {},
    readinessService,
    registry,
    repository,
    scheduler,
    startupService,
    toolLearningRepository,
    toolLearningService,
  };
};

describe('API app', () => {
  it('serves startup, connector, bootstrap, learning, reflection, readiness, knowledge, and chat routes', async () => {
    const runtime = await createTestRuntime();
    const app = createApp(runtime);

    const healthResponse = await app.request('/health');
    const startupResponse = await app.request('/api/startup');
    const validateResponse = await app.request('/api/startup/validate', { method: 'POST' });
    const reflectionResponse = await app.request('/api/reflection');
    const connectorsResponse = await app.request('/api/connectors');
    const scopeOptionsResponse = await app.request('/api/connectors/demo/scope-options');
    const setScopeResponse = await app.request('/api/connectors/demo/scope', {
      method: 'PUT',
      body: JSON.stringify([
        { id: 'repo-1', label: 'digital-life', metadata: { kind: 'repository' } },
      ]),
      headers: { 'content-type': 'application/json' },
    });
    const toolPolicyResponse = await app.request('/api/tools/demo.fetchRepository/policy', {
      method: 'PATCH',
      body: JSON.stringify({ phase: 'live', enabled: false, reason: 'operator choice' }),
      headers: { 'content-type': 'application/json' },
    });
    const personaResponse = await app.request('/api/bootstrap/persona', {
      method: 'POST',
      body: JSON.stringify({ name: 'Digital Life' }),
      headers: { 'content-type': 'application/json' },
    });
    const manualContextResponse = await app.request('/api/bootstrap/manual-context', {
      method: 'POST',
      body: JSON.stringify([{ source: 'operator', text: 'Track repositories.' }]),
      headers: { 'content-type': 'application/json' },
    });
    const baselineResponse = await app.request('/api/bootstrap/start', { method: 'POST' });
    const baselineRun = (await baselineResponse.json()) as { runId: string };
    const learningRunsResponse = await app.request('/api/learning/runs');
    const baselineRunResponse = await app.request(`/api/learning/runs/${baselineRun.runId}`);
    const learningLogsResponse = await app.request(`/api/learning/runs/${baselineRun.runId}/logs`);
    const learningStreamResponse = await app.request(
      `/api/learning/runs/${baselineRun.runId}/stream`,
    );
    const reflectionRecomputeResponse = await app.request('/api/reflection/recompute', {
      method: 'POST',
    });
    const readinessResponse = await app.request('/api/readiness');
    const dashboardResponse = await app.request('/api/dashboard');
    const knowledgeResponse = await app.request('/api/knowledge/search?q=baseline');
    const knowledgeResults = (await knowledgeResponse.json()) as Array<{
      id: string;
      content: string;
    }>;
    const factResponse = await app.request(
      `/api/evidence/facts/${knowledgeResults[0]?.id ?? 'missing'}`,
    );
    const communitiesResponse = await app.request('/api/evidence/communities');
    const chatResponse = await app.request('/api/chat/query', {
      method: 'POST',
      body: JSON.stringify({ query: 'What did we learn about the baseline source?' }),
      headers: { 'content-type': 'application/json' },
    });
    const chatStreamResponse = await app.request('/api/chat/query', {
      method: 'POST',
      body: JSON.stringify({ query: 'What did we learn about the baseline source?' }),
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
    });

    expect(healthResponse.status).toBe(200);
    expect((await startupResponse.json()).connectorCount).toBe(2);
    expect((await validateResponse.json()).ok).toBe(true);
    expect(
      ((await reflectionResponse.json()) as Array<{ category: string }>).some(
        (item) => item.category === 'scope',
      ),
    ).toBe(true);
    expect(await connectorsResponse.json()).toHaveLength(2);
    expect(await scopeOptionsResponse.json()).toHaveLength(2);
    expect(setScopeResponse.status).toBe(200);
    expect((await toolPolicyResponse.json()).enabled).toBe(false);
    expect((await personaResponse.json()).status).toBe('in_progress');
    expect((await manualContextResponse.json()).manualContext).toHaveLength(1);
    expect((await learningRunsResponse.json()).length).toBeGreaterThan(0);
    expect((await baselineRunResponse.json()).status).toBe('completed');
    expect((await learningLogsResponse.json()).length).toBeGreaterThan(1);
    expect(await learningStreamResponse.text()).toContain('done');
    expect(
      ((await reflectionRecomputeResponse.json()) as Array<{ category: string }>).some(
        (item) => item.category === 'maintenance',
      ),
    ).toBe(true);
    expect((await readinessResponse.json()).status).toBe('ready');
    expect((await dashboardResponse.json()).connectors).toBe(2);
    expect(knowledgeResponse.status).toBe(200);
    expect(knowledgeResults[0]?.content).toContain('baseline learning source');
    expect((await factResponse.json()).id).toBe(knowledgeResults[0]?.id);
    expect((await communitiesResponse.json()).length).toBeGreaterThan(0);
    expect((await chatResponse.json()).answer).toContain('Grounded answer');
    expect(await chatStreamResponse.text()).toContain('event: text_delta');
  });

  it('covers the route branches for missing resources and explicit placeholders', async () => {
    const runtime = await createTestRuntime();
    const app = createApp(runtime);

    const connectorResponse = await app.request('/api/connectors/demo');
    const scopeResponse = await app.request('/api/connectors/demo/scope');
    const toolResponse = await app.request('/api/tools/demo.fetchRepository');
    const missingToolResponse = await app.request('/api/tools/missing');
    const learningCreateResponse = await app.request('/api/learning/runs', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'incremental',
        connectorIds: ['demo'],
        details: { cursor: '1' },
      }),
      headers: { 'content-type': 'application/json' },
    });
    const createdRun = (await learningCreateResponse.json()) as { id: string };
    const learningRunResponse = await app.request(`/api/learning/runs/${createdRun.id}`);
    const learningLogsResponse = await app.request(`/api/learning/runs/${createdRun.id}/logs`);
    const missingRunResponse = await app.request('/api/learning/runs/missing');
    const knowledgeResponse = await app.request('/api/knowledge/search?q=missing');
    const factResponse = await app.request('/api/evidence/facts/fact-1');
    const communitiesResponse = await app.request('/api/evidence/communities');
    const chatResponse = await app.request('/api/chat/query', {
      method: 'POST',
      body: JSON.stringify({ query: 'Tell me about a missing system' }),
      headers: { 'content-type': 'application/json' },
    });
    const conversationResponse = await app.request('/api/chat/conversations/convo-1');

    expect((await connectorResponse.json()).id).toBe('demo');
    expect(await scopeResponse.json()).toEqual([]);
    expect((await toolResponse.json()).id).toBe('demo.fetchRepository');
    expect(missingToolResponse.status).toBe(404);
    expect((await learningRunResponse.json()).status).toBe('completed');
    expect((await learningLogsResponse.json()).length).toBeGreaterThan(1);
    expect(missingRunResponse.status).toBe(404);
    expect(await knowledgeResponse.json()).toEqual([]);
    expect(factResponse.status).toBe(404);
    expect((await communitiesResponse.json()).length).toBeGreaterThan(0);
    expect((await chatResponse.json()).clarificationRequest).toContain(
      'No grounded evidence matched',
    );
    expect(conversationResponse.status).toBe(404);
  });

  it('returns 400 when live write policies are enabled without satisfying governance rules', async () => {
    const app = createApp(await createGuardedRuntime());

    const response = await app.request('/api/tools/writer.send/policy', {
      method: 'PATCH',
      body: JSON.stringify({
        enabled: true,
        phase: 'live',
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('operator reason');
  });
});
