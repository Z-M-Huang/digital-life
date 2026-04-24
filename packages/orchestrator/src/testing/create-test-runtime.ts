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
    reflectionRepository: createInMemoryReflectionRepository(),
    repository: createInMemoryRuntimeStateRepository(),
  });
};

export const createTestDenseMemClient = (): DenseMemClient => ({
  async healthCheck() {
    return true;
  },
});
