import { createPassthroughLearnerClient } from '@digital-life/agents';
import type { DenseMemClient, DigitalLifeConfig } from '@digital-life/core';

import { createInMemoryKnowledgeRepository } from '../repositories/knowledge-repository';
import { createInMemoryReflectionRepository } from '../repositories/reflection-repository';
import { createInMemoryRuntimeStateRepository } from '../repositories/runtime-state-repository';
import { createRuntime } from '../runtime/create-runtime';

export const createTestConfig = (): DigitalLifeConfig => ({
  persona: {
    id: 'primary',
    displayName: 'Digital Life',
  },
  ai: {
    model: 'gpt-test',
    temperature: 0.2,
    promptOverrides: {},
    maxConcurrency: 4,
  },
  safety: {
    defaults: {
      read: 'allow',
      write: 'deny',
      execute: 'deny',
    },
    hardDeny: [],
  },
  denseMem: {
    apiKey: 'test-api-key',
    baseUrl: 'http://localhost:8080',
    namespace: 'digital-life',
    timeoutMs: 5000,
  },
  maintenance: {
    enabled: false,
    timezone: 'UTC',
    intervalMs: 21_600_000,
  },
  connectors: {
    demo: {
      kind: 'builtin',
      enabled: true,
      source: 'demo',
      config: {
        repositories: [{ id: 'repo-1', label: 'digital-life' }],
        inboxWindows: [{ id: 'inbox-7d', label: 'Last 7 days' }],
      },
      headers: {},
      hardDeny: [],
    },
  },
});

export const createTestRuntime = () => {
  const config = createTestConfig();
  return createRuntime({
    bridgeFactory: async () => ({
      async close() {
        return undefined;
      },
      async startupCheck() {
        return { ok: true, messages: [] };
      },
      async callTool() {
        return { id: 'test-memory', status: 'created' };
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
    config: {
      ...config,
      connectors: {
        ...config.connectors,
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
    },
    denseMemClient: createTestDenseMemClient(),
    knowledgeRepository: createInMemoryKnowledgeRepository(),
    llmClient: createPassthroughLearnerClient(),
    reflectionRepository: createInMemoryReflectionRepository(),
    repository: createInMemoryRuntimeStateRepository(),
  });
};

export const createTestDenseMemClient = (
  overrides: Partial<DenseMemClient> = {},
): DenseMemClient => {
  const claims = new Map<string, { id: string; status: 'candidate' | 'validated' | 'promoted' }>();
  return {
    async healthCheck() {
      return true;
    },
    async postFragment({ idempotencyKey }) {
      return { id: `fragment-${idempotencyKey ?? Math.random().toString(36).slice(2)}` };
    },
    async postClaim(input) {
      const id = `claim-${claims.size + 1}`;
      claims.set(id, { id, status: 'candidate' });
      return {
        id,
        status: 'candidate',
        subject: input.subject,
        predicate: input.predicate,
        ...(input.object !== undefined ? { object: input.object } : {}),
        content: input.content,
        confidence: input.confidence,
      };
    },
    async verifyClaim(claimId) {
      const existing = claims.get(claimId) ?? { id: claimId, status: 'validated' as const };
      claims.set(claimId, { ...existing, status: 'validated' });
      return { id: claimId, status: 'validated', content: '' };
    },
    async promoteClaim(claimId) {
      claims.set(claimId, { id: claimId, status: 'promoted' });
      return { id: `fact-${claimId}`, content: '' };
    },
    async retractFragment() {
      return undefined;
    },
    async recall() {
      return [];
    },
    async searchSemantic() {
      return [];
    },
    async getFact() {
      return null;
    },
    async listFacts() {
      return [];
    },
    async listCommunities() {
      return [];
    },
    async getCommunitySummary() {
      return null;
    },
    ...overrides,
  };
};
